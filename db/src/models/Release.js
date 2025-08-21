import * as anchorSerum from '@project-serum/anchor';
import * as anchorCoral from '@coral-xyz/anchor';
import { Metaplex } from '@metaplex-foundation/js';
import { Model } from 'objection';
import { stripHtmlIfNeeded, tweetNewRelease }from '../utils/index.js';
import  Account from './Account.js';
import Exchange from './Exchange.js';
import Hub from './Hub.js';
import Post from './Post.js';
import Tag from './Tag.js';
import axios from 'axios';
import promiseRetry from 'promise-retry';
import { customAlphabet } from 'nanoid';
import { getTokenMetadata } from '@solana/spl-token';

const ensureHttps = (uri) => {
  if (!uri.startsWith("http://") && !uri.startsWith("https://")) {
    return `https://${uri}`;
  }
  return uri;
};

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const randomStringGenerator = customAlphabet(alphabet, 12);
export default class Release extends Model {
  static tableName = "releases";

  static idColumn = "id";
  static jsonSchema = {
    type: "object",
    required: ["metadata", "datetime", "slug", "price"],
    properties: {
      publicKey: { type: ["string"] },
      mint: { type: "string" },
      slug: { type: "string" },
      metadata: {
        type: "object",
        required: ["name", "symbol", "description", "image", "properties"],
        properties: {
          name: { type: "string" },
          symbol: { type: "string" },
          description: { type: "string" },
          properties: {
            type: "object",
            properties: {
              artist: { type: "string" },
              title: { type: "string" },
              date: { type: "string" },
              files: { type: "array" },
              category: { type: "string" },
              creators: { type: "array" }
            }
          }
        }
      },
      price: { type: 'string' },
      archived: { type: 'boolean' },
    },
  }
  
  static findOrCreate = async (publicKey, hubPublicKey=null, programId=process.env.NINA_PROGRAM_V2_ID, isLazy=false) => {
    try {
      console.log('Release.findOrCreate', publicKey, programId)
      let release = await Release.query().findOne({ publicKey });
      if (release) {
        console.log('release found', release)
        return release;
      }
  
      let anchor = programId === process.env.NINA_PROGRAM_V2_ID ? anchorCoral : anchorSerum;
      const connection = new anchor.web3.Connection(process.env.SOLANA_CLUSTER_URL);
      const provider = new anchor.AnchorProvider(connection, {}, {commitment: 'confirmed'})  
      const program = await anchor.Program.at(
        programId,
        provider,
      )
      const programModelName = programId === process.env.NINA_PROGRAM_V2_ID ? 'releaseV2' : 'release';
      const metaplex = new Metaplex(connection);
      let attempts = 0;
      const releaseAccount = await promiseRetry(
        async (retry) => {
          try {
            attempts += 1
            const result = await program.account[programModelName].fetch(new anchor.web3.PublicKey(publicKey), 'confirmed')
            return result
          } catch (error) {
            console.log("error fetching release account", error);
            retry(error);
          }
        },
        {
          retries: 50,
          minTimeout: 500,
          maxTimeout: 1500
        }
      )
  
      let metadataAccount
      if (programId === process.env.NINA_PROGRAM_V2_ID) {
        metadataAccount = await getTokenMetadata(connection, releaseAccount.mint, 'confirmed')
      } else {
        metadataAccount = (await metaplex.nfts().findAllByMintList({mints: [releaseAccount.releaseMint]}, { commitment: 'confirmed' }))[0];
      }
      if (!metadataAccount) {
        throw new Error(
          "No metadata account found for release - is not a complete release"
        );
      }
      let json;
      try {
        json = (
          await axios.get(
            ensureHttps(
              metadataAccount.uri
                .replace("www.", "")
                .replace("arweave.net", "gateway.irys.xyz")
            )
          )
        ).data;
      } catch (error) {
        json = (
          await axios.get(
            ensureHttps(
              metadataAccount.uri.replace("gateway.irys.xyz", "arweave.net")
            )
          )
        ).data;
      }

      const slug = await this.generateSlug(json);
      let publisher = await Account.findOrCreate(
        releaseAccount.authority.toBase58()
      );
      release = await this.createRelease({
        publicKey,
        mint: programId === process.env.NINA_PROGRAM_V2_ID ? releaseAccount.mint.toBase58() : releaseAccount.releaseMint.toBase58(),
        metadata: json,
        datetime: programId === process.env.NINA_PROGRAM_V2_ID ? new Date().toISOString() : new Date(releaseAccount.releaseDatetime.toNumber() * 1000).toISOString(),
        slug,
        publisherId: publisher.id,
        releaseAccount,
        programId,
        solanaAddress: isLazy ? null : publicKey,
      });

      if (hubPublicKey) {
        const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
        await release.$query().patch({ hubId: hub.id });
        await Hub.relatedQuery("releases")
          .for(hub.id)
          .patch({
            visible: true
          })
          .where({ id: release.id });
      }

      return release;
    } catch (error) {
      console.log("error finding or creating release: ", error);
      return null;
    }
  };

  static createRelease = async ({publicKey, mint, metadata, datetime, publisherId, releaseAccount, programId}) => {
    const slug = await this.generateSlug(metadata);
    const price =
      releaseAccount.account?.price?.toNumber() ||
      releaseAccount?.price?.toNumber() ||
      0;
    const paymentMint =
      releaseAccount.account?.paymentMint.toBase58() ||
      releaseAccount?.paymentMint.toBase58();
    const release = await Release.query().insertGraph({
      publicKey,
      mint,
      metadata,
      slug,
      datetime,
      publisherId,
      price: `${price}`,
      paymentMint,
      archived: false,
      programId,
    })
    if (metadata.properties.tags) {
      for await (let tag of metadata.properties.tags) {
        const tagRecord = await Tag.findOrCreate(tag);
        await Release.relatedQuery("tags")
          .for(release.id)
          .relate(tagRecord.id)
          .onConflict(["tagId", "releaseId"])
          .ignore();
      }
    }
    if (programId === process.env.NINA_PROGRAM_ID) {
      await this.processRevenueShares(releaseAccount, release);
    }
    tweetNewRelease(metadata, publisherId, slug);
    return release;
  };

  static processRevenueShares = async (releaseData, releaseRecord) => {
    const royaltyRecipients =
      releaseData.account?.royaltyRecipients || releaseData.royaltyRecipients;
    for await (let recipient of royaltyRecipients) {
      try {
        if (
          recipient.recipientAuthority.toBase58() !==
          "11111111111111111111111111111111"
        ) {
          const recipientAccount = await Account.findOrCreate(
            recipient.recipientAuthority.toBase58()
          );
          const revenueShares = (
            await recipientAccount.$relatedQuery("revenueShares")
          ).map((revenueShare) => revenueShare.id);
          if (
            !revenueShares.includes(releaseRecord.id) &&
            recipient.percentShare.toNumber() > 0
          ) {
            await Account.relatedQuery("revenueShares")
              .for(recipientAccount.id)
              .relate(releaseRecord.id);
          } else if (
            revenueShares.includes(releaseRecord.id) &&
            recipient.percentShare.toNumber() === 0
          ) {
            await Account.relatedQuery("revenueShares")
              .for(recipientAccount.id)
              .unrelate()
              .where("id", releaseRecord.id);
          }
        }
      } catch (error) {
        console.log("error processing royaltyRecipients: ", error);
      }
    }
  };

  static generateSlug = async (metadata) => {
    let string = metadata.name;
    if (string.length > 200) {
      string = string.substring(0, 200);
    }
    const slug = string
      .normalize("NFKD")
      .replace(/[\u0300-\u036F]/g, "") // remove accents and convert to closest ascii equivalent
      .toLowerCase() // convert to lowercase
      .replace("-", "") // remove hyphens
      .replace(/  +/g, " ") // remove spaces
      .replace(/ /g, "-") // replace spaces with hyphens
      .replace(/[^a-zA-Z0-9-]/g, "-") // replace non-alphanumeric characters with hyphens
      .replace(/-+/g, "-") // replace multiple hyphens with single hyphen
      .replace(/-$/, ""); // remove trailing hyphens

    const existingRelease = await Release.query().findOne({ slug });
    if (existingRelease) {
      return `${slug}-${randomStringGenerator()}`;
    }
    return slug;
  };

  format = async () => {
    const publisher = await this.$relatedQuery("publisher");
    const publishedThroughHub = await this.$relatedQuery("publishedThroughHub");
    if (publishedThroughHub) {
      this.publishedThroughHub = publishedThroughHub.publicKey;
      this.hub = publishedThroughHub;
      delete this.hub.id;
      const authority = await this.hub
        .$relatedQuery("authority")
        .select("publicKey");
      this.hub.authority = authority.publicKey;
      delete this.hub.authorityId;
    }
    await publisher.format();
    this.publisher = publisher.publicKey;
    this.publisherAccount = publisher;
    delete this.publisherId;
    delete this.hubId;
    delete this.id;

    stripHtmlIfNeeded(this.metadata, "description");
  };

  static relationMappings = () => ({
    publishedThroughHub: {
      relation: Model.BelongsToOneRelation,
      modelClass: Hub,
      join: {
        from: "releases.hubId",
        to: "hubs.id"
      }
    },
    publisher: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: "releases.publisherId",
        to: "accounts.id"
      }
    },
    collectors: {
      relation: Model.ManyToManyRelation,
      modelClass: Account,
      join: {
        from: "releases.id",
        through: {
          from: "releases_collected.releaseId",
          to: "releases_collected.accountId"
        },
        to: "accounts.id"
      }
    },
    exchanges: {
      relation: Model.HasManyRelation,
      modelClass: Exchange,
      join: {
        from: "releases.id",
        to: "exchanges.releaseId"
      }
    },
    hubs: {
      relation: Model.ManyToManyRelation,
      modelClass: Hub,
      join: {
        from: "releases.id",
        through: {
          from: "hubs_releases.releaseId",
          to: "hubs_releases.hubId",
          extra: ["hubReleasePublicKey"]
        },
        to: "hubs.id"
      }
    },
    posts: {
      relation: Model.ManyToManyRelation,
      modelClass: Post,
      join: {
        from: "releases.id",
        through: {
          from: "posts_releases.releaseId",
          to: "posts_releases.postId"
        },
        to: "posts.id"
      }
    },
    revenueShareRecipients: {
      relation: Model.ManyToManyRelation,
      modelClass: Account,
      join: {
        from: "releases.id",
        through: {
          from: "releases_revenue_share.releaseId",
          to: "releases_revenue_share.accountId"
        },
        to: "accounts.id"
      }
    },
    tags: {
      relation: Model.ManyToManyRelation,
      modelClass: Tag,
      join: {
        from: "releases.id",
        through: {
          from: "tags_releases.releaseId",
          to: "tags_releases.tagId"
        },
        to: "tags.id"
      }
    }
  });
}
