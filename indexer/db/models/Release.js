const { Model } = require('objection');
const { stripHtmlIfNeeded } = require('../../utils');
const Account = require('./Account');
const Exchange = require('./Exchange');
const Hub = require('./Hub');
const Post = require('./Post');
const NinaProcessor = require('../../processor');
const { tweetNewRelease } = require('../../utils');

class Release extends Model {
  static get tableName() {
    return 'releases';
  }
  static get idColumn() {
    return 'id';
  }
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['publicKey', 'mint', 'metadata', 'datetime'],
      properties: {
        publicKey: { type: 'string' },
        mint: { type: 'string' },
        metadata: {
          type: 'object',
          required: ['name', 'symbol', 'description', 'image', 'properties'],
          properties: {
            name: { type: 'string' },
            symbol: { type: 'string' },
            description: { type: 'string' },
            properties: {
              type: 'object',
              properties: {
                artist: { type: 'string' },
                title: { type: 'string' },
                date: { type: 'string' },
                files: { type: 'array' },
                category: { type: 'string' },
                creators: { type: 'array' },
              }
            }
          }
        },
      },
    };
  }

  static async findOrCreate(publicKey) {
    let release = await Release.query().findOne({ publicKey });
    if (release) {
      return release;
    }

    await NinaProcessor.init()
    const releaseAccount = await NinaProcessor.program.account.release.fetch(publicKey, 'confirmed')
    const metadataAccount = await NinaProcessor.metaplex.nfts().findByMint(releaseAccount.releaseMint, {commitment: "confirmed"}).run();
    let publisher = await Account.findOrCreate(releaseAccount.authority.toBase58());

    release = await this.createRelease({
      publicKey,
      mint: releaseAccount.releaseMint.toBase58(),
      metadata: metadataAccount.json,
      datetime: new Date(releaseAccount.releaseDatetime.toNumber() * 1000).toISOString(),
      publisherId: publisher.id,
      releaseAccount
    });
    return release;
  }

  static async createRelease({publicKey, mint, metadata, datetime, publisherId, releaseAccount}) {
    const release = await Release.query().insertGraph({
      publicKey,
      mint,
      metadata,
      datetime,
      publisherId,
    })
    await this.processRevenueShares(releaseAccount, release);
    await tweetNewRelease(metadata);
    console.log('Inserted Release: ', publicKey)
  }

  static async processRevenueShares (releaseData, releaseRecord) {
    const royaltyRecipients = releaseData.account?.royaltyRecipients || releaseData.royaltyRecipients
    for await (let recipient of royaltyRecipients) {
      try {
        if (recipient.recipientAuthority.toBase58() !== "11111111111111111111111111111111") {
          const recipientAccount = await Account.findOrCreate(recipient.recipientAuthority.toBase58());
          const revenueShares = (await recipientAccount.$relatedQuery('revenueShares')).map(revenueShare => revenueShare.id);
          if (!revenueShares.includes(releaseRecord.id)) {
            await Account.relatedQuery('revenueShares').for(recipientAccount.id).relate(releaseRecord.id);
          }
        }
      } catch (error) {
        console.log('error processing royaltyRecipients: ', error)
      }
    }
  }

  async format() {
    const publisher = await this.$relatedQuery('publisher').select('publicKey');
    const publishedThroughHub = await this.$relatedQuery('publishedThroughHub');
    if (publishedThroughHub) {
      this.publishedThroughHub = publishedThroughHub.publicKey;
    }
    this.publisher = publisher.publicKey;
    delete this.publisherId
    delete this.hubId
    delete this.id

    stripHtmlIfNeeded(this.metadata, 'description');
  }

  static relationMappings() {
    return {
      publishedThroughHub: {
        relation: Model.BelongsToOneRelation,
        modelClass: Hub,
        join: {
          from: 'releases.hubId',
          to: 'hubs.id',
        },
      },
      publisher: {
        relation: Model.HasOneRelation,
        modelClass: Account,
        join: {
          from: 'releases.publisherId',
          to: 'accounts.id',
        },
      },
      collectors: {
        relation: Model.ManyToManyRelation,
        modelClass: Account,
        join: {
          from: 'releases.id',
          through: {
            from: 'releases_collected.releaseId',
            to: 'releases_collected.accountId',
          },
          to: 'accounts.id',
        },
      },
      exchanges: {
        relation: Model.HasManyRelation,
        modelClass: Exchange,
        join: {
          from: 'releases.id',
          to: 'exchanges.releaseId',
        },
      },
      hubs: {
        relation: Model.ManyToManyRelation,
        modelClass: Hub,
        join: {
          from: 'releases.id',
          through : {
            from: 'hubs_releases.releaseId',
            to: 'hubs_releases.hubId',
            extra: ['hubReleasePublicKey'],
          },
          to: 'hubs.id',
        },
      },
      posts: {
        relation: Model.ManyToManyRelation,
        modelClass: Post,
        join: {
          from: 'releases.id',
          through : {
            from: 'posts_releases.releaseId',
            to: 'posts_releases.postId',
          },
          to: 'posts.id',
        },
      },
      revenueShareRecipients: {
        relation: Model.ManyToManyRelation,
        modelClass: Account,
        join: {
          from: 'releases.id',
          through: {
            from: 'releases_revenue_share.releaseId',
            to: 'releases_revenue_share.accountId',
          },
          to: 'accounts.id',
        },
      }
    };
  }
}

module.exports = Release;
