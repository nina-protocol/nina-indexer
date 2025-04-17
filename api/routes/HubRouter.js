import KoaRouter from "koa-router";
import {
  Account,
  Hub,
  Post,
  Release,
  Subscription
} from "@nina-protocol/nina-db";
import { ref } from "objection";
import * as anchor from "@project-serum/anchor";
import axios from "axios";

import { formatColumnForJsonFields, BIG_LIMIT } from "../utils.js";
import {
  decode,
  callRpcMethodWithRetry
} from "../../indexer/src/utils/index.js";
import { warmCache } from "../../indexer/src/utils/helpers.js";
import TransactionSyncer from "../../indexer/src/TransactionSyncer.js";

const router = new KoaRouter({
  prefix: "/hubs"
});

router.get("/", async (ctx) => {
  try {
    let {
      offset = 0,
      limit = 20,
      sort = "desc",
      column = "datetime",
      query = ""
    } = ctx.query;
    column = formatColumnForJsonFields(column, "data");
    const hubs = await Hub.query()
      .where("handle", "ilike", `%${query}%`)
      .orWhere(ref("data:displayName").castText(), "ilike", `%${query}%`)
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let hub of hubs.results) {
      await hub.format();
      hub.type = "hub";
    }

    ctx.body = {
      hubs: hubs.results,
      total: hubs.total,
      query
    };
  } catch (err) {
    ctx.status = 400;
    ctx.body = {
      message: "Error fetching hubs"
    };
  }
});

router.get("/sitemap", async (ctx) => {
  try {
    const hubs = await Hub.query().select("handle").orderBy("datetime", "desc");
    ctx.body = {
      slugs: hubs.map((hub) => hub.handle)
    };
  } catch (err) {
    console.log(err);
    ctx.status = 400;
    ctx.body = {
      message: "Error fetching hubs for sitemap"
    };
  }
});

router.get("/:publicKeyOrHandle", async (ctx) => {
  try {
    let hub = await hubForPublicKeyOrHandle(ctx);
    const { hubOnly } = ctx.query;
    if (!hub) {
      const publicKey = ctx.params.publicKeyOrHandle;
      const hubAccount = await callRpcMethodWithRetry(() =>
        TransactionSyncer.program.account.hub.fetch(
          new anchor.web3.PublicKey(publicKey),
          "confirmed"
        )
      );
      if (hubAccount) {
        const authorityPublicKey = hubAccount.authority.toBase58();
        const authority = await Account.findOrCreate(authorityPublicKey);
        const uri = decode(hubAccount.uri);
        let data;
        try {
          data = await axios.get(
            uri.replace("www.", "").replace("arweave.net", "gateway.irys.xyz")
          );
        } catch (error) {
          data = await axios.get(
            uri.replace("gateway.irys.xyz", "arweave.net")
          );
        }
        hub = await Hub.query().insertGraph({
          publicKey,
          handle: decode(hubAccount.handle),
          data: data.data,
          dataUri: uri,
          datetime: new Date(
            hubAccount.datetime.toNumber() * 1000
          ).toISOString(),
          updatedAt: new Date(
            hubAccount.datetime.toNumber() * 1000
          ).toISOString(),
          authorityId: authority.id
        });
        warmCache(data.data.image);

        const [hubCollaborator] =
          await anchor.web3.PublicKey.findProgramAddress(
            [
              Buffer.from(
                anchor.utils.bytes.utf8.encode("nina-hub-collaborator")
              ),
              new anchor.web3.PublicKey(publicKey).toBuffer(),
              new anchor.web3.PublicKey(authorityPublicKey).toBuffer()
            ],
            new anchor.web3.PublicKey(TransactionSyncer.program.programId)
          );
        await Hub.relatedQuery("collaborators").for(hub.id).relate({
          id: authority.id,
          hubCollaboratorPublicKey: hubCollaborator.toBase58()
        });
      }
    }

    let releases = await hub.$relatedQuery("releases").where("archived", false);

    if (hubOnly === "true") {
      await hub.format();
      ctx.body = {
        hub,
        total: releases.length
      };
      return;
    }

    const collaborators = await hub.$relatedQuery("collaborators");
    for (let release of releases) {
      await release.format();
    }

    const posts = await hub.$relatedQuery("posts");

    // if hub is less than five minutes old warm the cache
    if (
      hub.updatedAt &&
      new Date(hub.updatedAt).getTime() > new Date().getTime() - 300000
    ) {
      warmCache(hub.data.image);
    }

    for (let collaborator of collaborators) {
      await collaborator.format();
    }

    for await (let post of posts) {
      await post.format();
    }
    await hub.format();

    ctx.body = {
      hub,
      collaborators,
      releases,
      posts
    };
  } catch (err) {
    console.log(err);
    ctx.status = 404;
    ctx.body = {
      message: `Hub not found with publicKey: ${ctx.params.publicKeyOrHandle}`
    };
  }
});

router.get("/:publicKeyOrHandle/followers", async (ctx) => {
  try {
    let {
      offset = 0,
      limit = BIG_LIMIT,
      sort = "desc",
      column = "datetime"
    } = ctx.query;
    let hub = await hubForPublicKeyOrHandle(ctx);

    const subscriptions = await Subscription.query()
      .where("to", hub.publicKey)
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    const followers = [];
    const accounts = await Account.query().whereIn(
      "publicKey",
      subscriptions.results.map((subscription) => subscription.from)
    );
    for await (let account of accounts) {
      await account.format();
      const accountFollowers = await Subscription.query()
        .where("to", account.publicKey)
        .range(0, 0);
      followers.push({
        account,
        followers: Number(accountFollowers.total),
        subscription: subscriptions.results.find(
          (subscription) => subscription.from === account.publicKey
        )
      });
    }

    ctx.body = {
      followers,
      total: subscriptions.total
    };
  } catch (err) {
    console.log(err);
    ctx.status = 404;
    ctx.body = {
      message: `Hub not found with publicKey: ${ctx.params.publicKeyOrHandle}`
    };
  }
});

router.get("/:publicKeyOrHandle/tx/:txid", async (ctx) => {
  try {
    const { txid } = ctx.params;
    if (txid) {
      await TransactionSyncer.handleDomainProcessingForSingleTransaction(txid);
    }
    const hub = await hubForPublicKeyOrHandle(ctx);
    await hub.format();
    ctx.body = {
      hub
    };
  } catch (error) {
    ctx.status = 400;
    ctx.body = {
      message: "Error fetching hub"
    };
  }
});

router.get("/:publicKeyOrHandle/collaborators", async (ctx) => {
  try {
    const { offset = 0, limit = BIG_LIMIT } = ctx.query;
    const hub = await hubForPublicKeyOrHandle(ctx);
    const collaborators = await hub
      .$relatedQuery("collaborators")
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let account of collaborators.results) {
      await account.format();
    }
    ctx.body = {
      collaborators: collaborators.results,
      total: collaborators.total,
      publicKey: hub.publicKey
    };
  } catch (err) {
    console.log(err);
    hubNotFound(ctx);
  }
});

router.get("/:publicKeyOrHandle/all", async (ctx) => {
  try {
    let {
      offset = 0,
      limit = 20,
      sort = "desc",
      column = "datetime",
      query = ""
    } = ctx.query;
    const hub = await hubForPublicKeyOrHandle(ctx);
    const releases = await Release.query()
      .joinRelated("hubs")
      .where("hubs_join.hubId", hub.id)
      .where("hubs_join.visible", true)
      .where(ref("metadata:name").castText(), "ilike", `%${query}%`)
      .where("archived", false)
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    let posts = await hub
      .$relatedQuery("posts")
      .orderBy(formatColumnForJsonFields(column, "data"), sort)
      .where(ref("data:title").castText(), "ilike", `%${query}%`);

    for await (let post of posts) {
      post.type = "post";
      await post.format();
    }

    for (let release of releases.results) {
      release.type = "release";
      await release.format();
    }

    const all = [...releases.results, ...posts];
    if (sort === "desc") {
      all.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    } else {
      all.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    }

    ctx.body = {
      all: all.slice(0, Number(limit)),
      total: releases.total + posts.length,
      publicKey: hub.publicKey,
      query
    };
  } catch (err) {
    console.log(err);
    hubNotFound(ctx);
  }
});

router.get("/:publicKeyOrHandle/releases", async (ctx) => {
  try {
    let {
      offset = 0,
      limit = BIG_LIMIT,
      sort = "desc",
      column = "datetime",
      query = "",
      random = "false"
    } = ctx.query;
    column = formatColumnForJsonFields(column);
    const hub = await hubForPublicKeyOrHandle(ctx);

    let releases;
    if (random === "true") {
      const randomReleases = await Release.query()
        .joinRelated("hubs")
        .join("hubs_releases", function () {
          this.on("releases.id", "=", "hubs_releases.releaseId").andOn(
            "hubs_releases.hubId",
            "=",
            hub.id
          );
        })
        .where("hubs_join.hubId", hub.id)
        .where("hubs_join.visible", true)
        .select("releases.*", "hubs_releases.hubReleasePublicKey")
        .orderByRaw("random()")
        .limit(limit);

      releases = {
        results: randomReleases,
        total: randomReleases.length
      };
    } else {
      releases = await Release.query()
        .joinRelated("hubs")
        .join("hubs_releases", function () {
          this.on("releases.id", "=", "hubs_releases.releaseId").andOn(
            "hubs_releases.hubId",
            "=",
            hub.id
          );
        })
        .where("hubs_join.hubId", hub.id)
        .where("hubs_join.visible", true)
        .where(ref("metadata:name").castText(), "ilike", `%${query}%`)
        .where("archived", false)
        .select("releases.*", "hubs_releases.hubReleasePublicKey")
        .orderBy(column, sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);
    }

    if (sort === "desc") {
      releases.results.sort(
        (a, b) => new Date(b.datetime) - new Date(a.datetime)
      );
    } else {
      releases.results.sort(
        (a, b) => new Date(a.datetime) - new Date(b.datetime)
      );
    }

    for await (let release of releases.results) {
      await release.format();
    }

    ctx.body = {
      releases: releases.results,
      total: releases.total,
      publicKey: hub.publicKey,
      query
    };
  } catch (err) {
    console.log(err);
    hubNotFound(ctx);
  }
});

router.get("/:publicKeyOrHandle/releases/archived", async (ctx) => {
  try {
    let {
      offset = 0,
      limit = BIG_LIMIT,
      sort = "desc",
      column = "datetime",
      query = ""
    } = ctx.query;
    column = formatColumnForJsonFields(column);
    const hub = await hubForPublicKeyOrHandle(ctx);
    let releases;
    const archivedReleasesForHub = await Release.query()
      .joinRelated("hubs")
      .where("hubs_join.hubId", hub.id)
      .where("hubs_join.visible", false)
      .where(ref("metadata:name").castText(), "ilike", `%${query}%`)
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    releases = await Release.query().whereIn(
      "id",
      archivedReleasesForHub.results.map((release) => release.id)
    );

    for await (let release of releases) {
      await release.format();
    }

    releases = {
      results: releases,
      total: archivedReleasesForHub.total
    };

    const hubContentPublicKeys = [];
    for await (let release of releases.results) {
      const [hubContentPublicKey] =
        await anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode("nina-hub-content")),
            new anchor.web3.PublicKey(hub.publicKey).toBuffer(),
            new anchor.web3.PublicKey(release.publicKey).toBuffer()
          ],
          TransactionSyncer.program.programId
        );
      hubContentPublicKeys.push(hubContentPublicKey);
    }
    const hubContent = await callRpcMethodWithRetry(() =>
      TransactionSyncer.program.account.hubContent.fetchMultiple(
        hubContentPublicKeys,
        "confirmed"
      )
    );
    for await (let release of releases.results) {
      const releaseHubContent = hubContent.filter(
        (hc) => hc.child.toBase58() === release.hubReleasePublicKey
      )[0];
      if (releaseHubContent) {
        release.datetime = new Date(
          releaseHubContent.datetime.toNumber() * 1000
        ).toISOString();
      }
    }

    if (sort === "desc") {
      releases.results.sort(
        (a, b) => new Date(b.datetime) - new Date(a.datetime)
      );
    } else {
      releases.results.sort(
        (a, b) => new Date(a.datetime) - new Date(b.datetime)
      );
    }

    ctx.body = {
      releases: releases.results,
      total: releases.total,
      publicKey: hub.publicKey,
      query
    };
  } catch (err) {
    console.log(err);
    hubNotFound(ctx);
  }
});

router.get("/:publicKeyOrHandle/posts", async (ctx) => {
  try {
    let {
      offset = 0,
      limit = BIG_LIMIT,
      sort = "desc",
      column = "datetime",
      query = ""
    } = ctx.query;
    column = formatColumnForJsonFields(column, "data");
    const hub = await hubForPublicKeyOrHandle(ctx);
    let posts = await hub
      .$relatedQuery("posts")
      .where(ref("data:title").castText(), "ilike", `%${query}%`)
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let post of posts.results) {
      await post.format();
    }

    ctx.body = {
      posts: posts.results,
      total: posts.total,
      publicKey: hub.publicKey,
      query
    };
  } catch (err) {
    console.log(err);
    hubNotFound(ctx);
  }
});

router.get(
  "/:publicKeyOrHandle/hubRelease/:hubReleasePublicKey",
  async (ctx) => {
    try {
      const { txid } = ctx.query;
      const hub = await hubForPublicKeyOrHandle(ctx);
      const release = await Release.query()
        .joinRelated("hubs")
        .where("hubs_join.hubId", hub.id)
        .where("hubs_join.hubReleasePublicKey", ctx.params.hubReleasePublicKey)
        .first();

      if (hub && release) {
        const [hubContentPublicKey] =
          await anchor.web3.PublicKey.findProgramAddress(
            [
              Buffer.from(anchor.utils.bytes.utf8.encode("nina-hub-content")),
              new anchor.web3.PublicKey(hub.publicKey).toBuffer(),
              new anchor.web3.PublicKey(release.publicKey).toBuffer()
            ],
            TransactionSyncer.program.programId
          );
        const hubContent = await callRpcMethodWithRetry(() =>
          TransactionSyncer.program.account.hubContent.fetch(
            hubContentPublicKey,
            "confirmed"
          )
        );
        await Hub.relatedQuery("releases")
          .for(hub.id)
          .patch({
            visible: hubContent.visible
          })
          .where({ id: release.id });

        ctx.body = {
          release,
          hub
        };
      } else if (hub && txid) {
        //TODO: Probably want to clean this up - but for now should work same was as the old api
        const hubRelease = await callRpcMethodWithRetry(() =>
          TransactionSyncer.program.account.hubRelease.fetch(
            new anchor.web3.PublicKey(ctx.params.hubReleasePublicKey),
            "confirmed"
          )
        );
        if (hubRelease) {
          const releaseRecord = await Release.findOrCreate(
            hubRelease.release.toBase58()
          );
          const [hubContentPublicKey] =
            await anchor.web3.PublicKey.findProgramAddress(
              [
                Buffer.from(anchor.utils.bytes.utf8.encode("nina-hub-content")),
                hubRelease.hub.toBuffer(),
                hubRelease.release.toBuffer()
              ],
              TransactionSyncer.program.programId
            );
          const hubContent = await callRpcMethodWithRetry(() =>
            TransactionSyncer.program.account.hubContent.fetch(
              hubContentPublicKey,
              "confirmed"
            )
          );
          await Hub.relatedQuery("releases").for(hub.id).relate({
            id: releaseRecord.id,
            hubReleasePublicKey: ctx.params.hubReleasePublicKey
          });
          if (hubContent.publishedThroughHub) {
            await releaseRecord.$query().patch({ hubId: hub.id });
          }
          await hub.format();
          await releaseRecord.format();
          ctx.body = {
            release: releaseRecord,
            hub
          };
        } else {
          throw "Hub release not found";
        }
      } else {
        await hub.format();
        await release.format();
        ctx.body = {
          release,
          hub
        };
      }
    } catch (err) {
      console.log(err);
      ctx.status = 404;
      ctx.body = {
        message: `HubRelease not found with hub: ${ctx.params.publicKeyOrHandle} and HubRelease publicKey: ${ctx.params.hubReleasePublicKey}`
      };
    }
  }
);

router.get(
  "/:publicKeyOrHandle/collaborators/:hubCollaboratorPublicKey",
  async (ctx) => {
    try {
      const hub = await hubForPublicKeyOrHandle(ctx);
      if (hub) {
        const hubCollaborator = await lookupCollaborator(
          ctx.params.hubCollaboratorPublicKey
        );
        if (hubCollaborator) {
          const collaborator = await Account.findOrCreate(
            hubCollaborator.collaborator.toBase58()
          );
          const result = await Hub.relatedQuery("collaborators")
            .for(hub.id)
            .relate({
              id: collaborator.id,
              hubCollaboratorPublicKey: ctx.params.hubCollaboratorPublicKey
            });
          const account = await Hub.relatedQuery("collaborators")
            .for(hub.id)
            .where("accountId", collaborator.id)
            .first();
        } else {
          const collaborator = await Account.query()
            .joinRelated("hubs")
            .where("hubs_join.hubId", hub.id)
            .where(
              "hubs_join.hubCollaboratorPublicKey",
              ctx.params.hubCollaboratorPublicKey
            )
            .first();
          await Hub.relatedQuery("collaborators")
            .for(hub.id)
            .unrelate()
            .where("accountId", collaborator.id);
        }
        ctx.body = { success: true };
      }
    } catch (error) {
      ctx.body = { success: true };
    }
  }
);

router.get("/:publicKeyOrHandle/hubPosts/:hubPostPublicKey", async (ctx) => {
  try {
    const hub = await hubForPublicKeyOrHandle(ctx);
    let post = await Post.query()
      .joinRelated("hubs")
      .where("hubs_join.hubId", hub.id)
      .where("hubs_join.hubPostPublicKey", ctx.params.hubPostPublicKey)
      .first();
    if (!post) {
      const hubPostAccount = await callRpcMethodWithRetry(() =>
        TransactionSyncer.program.account.hubPost.fetch(
          new anchor.web3.PublicKey(ctx.params.hubPostPublicKey),
          "confirmed"
        )
      );
      const [hubContentPublicKey] =
        await anchor.web3.PublicKey.findProgramAddress(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode("nina-hub-content")),
            hubPostAccount.hub.toBuffer(),
            hubPostAccount.post.toBuffer()
          ],
          TransactionSyncer.program.programId
        );
      const hubContentAccount = await callRpcMethodWithRetry(() =>
        TransactionSyncer.program.account.hubContent.fetch(
          hubContentPublicKey,
          "confirmed"
        )
      );
      const postAccount = await callRpcMethodWithRetry(() =>
        TransactionSyncer.program.account.post.fetch(
          hubPostAccount.post,
          "confirmed"
        )
      );
      const uri = decode(postAccount.uri);
      let data;
      try {
        data = await axios.get(
          uri.replace("www.", "").replace("arweave.net", "gateway.irys.xyz")
        );
      } catch (error) {
        data = await axios.get(uri.replace("gateway.irys.xyz", "arweave.net"));
      }
      const publisher = await Account.findOrCreate(
        postAccount.author.toBase58()
      );
      post = await Post.query().insertGraph({
        publicKey: hubPostAccount.post.toBase58(),
        data: data.data,
        datetime: new Date(
          postAccount.createdAt.toNumber() * 1000
        ).toISOString(),
        publisherId: publisher.id
      });
      await Hub.relatedQuery("posts").for(hub.id).relate({
        id: post.id,
        hubPostPublicKey: ctx.params.hubPostPublicKey
      });
      if (hubContentAccount.publishedThroughHub) {
        await post.$query().patch({ hubId: hub.id });
      }
      if (hubPostAccount.referenceContent) {
        const release = await Release.query().findOne({
          publicKey: hubPostAccount.referenceContent.toBase58()
        });
        if (release) {
          const relatedRelease = await Post.relatedQuery("releases")
            .for(post.id)
            .where("releaseId", release.id)
            .first();
          if (!relatedRelease) {
            await Post.relatedQuery("releases").for(post.id).relate(release.id);
            console.log(
              "Related Release to Post:",
              release.publicKey,
              post.publicKey
            );
          }
        }
      }
    }
    await hub.format();
    await post.format();
    ctx.body = {
      post,
      hub
    };
  } catch (err) {
    console.log(err);
    hubPostNotFound(ctx);
  }
});

router.get("/:publicKeyOrHandle/subscriptions", async (ctx) => {
  try {
    let {
      offset = 0,
      limit = BIG_LIMIT,
      sort = "desc",
      column = "datetime"
    } = ctx.query;
    column = formatColumnForJsonFields(column);
    const hub = await hubForPublicKeyOrHandle(ctx);
    const subscriptions = await Subscription.query()
      .where("to", hub.publicKey)
      .where("subscriptionType", "hub")
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    for await (let subscription of subscriptions.results) {
      await subscription.format();
    }
    ctx.body = {
      subscriptions: subscriptions.results,
      total: subscriptions.total,
      publicKey: hub.publicKey
    };
  } catch (err) {
    console.log(err);
    hubNotFound(ctx);
  }
});

// helper functions
const lookupCollaborator = async (hubCollaboratorPublicKey) => {
  try {
    const hubCollaborator = await callRpcMethodWithRetry(() =>
      TransactionSyncer.program.account.hubCollaborator.fetch(
        new anchor.web3.PublicKey(hubCollaboratorPublicKey),
        "confirmed"
      )
    );
    return hubCollaborator;
  } catch (error) {
    return undefined;
  }
};

const hubForPublicKeyOrHandle = async (ctx) => {
  let hub = await Hub.query().findOne({
    publicKey: ctx.params.publicKeyOrHandle
  });

  if (!hub) {
    hub = await Hub.query().findOne({ handle: ctx.params.publicKeyOrHandle });
  }
  console.log("hub in hubForPublicKeyOrHandle :>> ", hub);
  return hub;
};

const hubNotFound = (ctx) => {
  ctx.status = 404;
  ctx.body = {
    message: `Hub not found with publicKey: ${ctx.params.publicKey}`
  };
};

const hubPostNotFound = (ctx) => {
  ctx.status = 404;
  ctx.body = {
    message: `HubPost not found with hub: ${ctx.params.publicKeyOrHandle} and HubPost publicKey: ${ctx.params.hubPostPublicKey}`
  };
};

export default router;
