import KoaRouter from 'koa-router'
import { 
  Hub,
  Post,
  Release,
} from '@nina-protocol/nina-db';
import { ref } from 'objection'
import * as anchor from '@project-serum/anchor';
import {
  getPostSearchSubQuery,
  getPublishedThroughHubSubQuery,
} from '../utils.js';
import { callRpcMethodWithRetry } from '../../indexer/src/utils/index.js';

import TransactionSyncer from '../../indexer/src/TransactionSyncer.js';

const router = new KoaRouter({
  prefix: '/posts'
})

router.get('/', async (ctx) => {
  try {
    const { offset=0, limit=20, sort='desc', column='datetime', query='', full='false'} = ctx.query;
    const includeBlocks = full === 'true';
    const hubIds = await getPublishedThroughHubSubQuery(query);
    const postIds = await getPostSearchSubQuery(query);
    const posts = await Post
    .query()
    .where('archived', false)
    .withGraphFetched('releases')
    .where(function () {
      this.whereRaw(`data->>'title' ILIKE ?`, [`%${query}%`])
        .orWhereRaw(`data->>'description' ILIKE ?`, [`%${query}%`])
        .orWhereIn('hubId', hubIds)
        .orWhereIn('id', postIds);
    })
    .orderBy(column, sort)
    .range(
      Number(offset),
      Number(offset) + Number(limit) - 1
    );

    for await (let post of posts.results) {
      // Format releases from the relation
      if (post.releases && post.releases.length > 0) {
        for await (let release of post.releases) {
          await release.format();
        }
      }
      await post.format({ includeBlocks });
      post.type = 'post'
    }
    ctx.body = {
      posts: posts.results,
      total: posts.total,
      query
    };
  } catch (err) {
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching posts'
    }
  }
})

router.get('/sitemap', async (ctx) => {
  try {
    const posts = await Post
      .query()  
      .where('archived', false)
      .select(ref('data:slug').castText())
      .orderBy('datetime', 'desc')
    ctx.body = {
      slugs: posts.map(post => post.text),
    };
  } catch(err) {
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching posts for sitemap'
    }
  }
});

//TODO: PLUG INTO TRANSACTION SYNCER
router.get('/:publicKeyOrSlug', async (ctx) => {
  try {
    let postAccount
    const { txid } = ctx.query
    let post = await findPostForPublicKeyOrSlug(ctx.params.publicKeyOrSlug)
    if (!post) {
      postAccount = await callRpcMethodWithRetry(() => TransactionSyncer.program.account.post.fetch(new anchor.web3.PublicKey(ctx.params.publicKeyOrSlug), 'confirmed'));
      if (!postAccount) {
        throw ('Post not found')
      }
      if (txid) {
        const success = await TransactionSyncer.handleDomainProcessingForSingleTransaction(txid)
        if (success) {
          post = await findPostForPublicKeyOrSlug(ctx.params.publicKeyOrSlug)
        }
      }
    }
    const publisher = await post.$relatedQuery('publisher')
    await publisher.format();
    const publishedThroughHub = await post.$relatedQuery('publishedThroughHub')
    if (publishedThroughHub) {
      await publishedThroughHub.format();
    }
    // Format releases from the relation (via posts_releases join table)
    if (post.releases && post.releases.length > 0) {
      for await (let release of post.releases) {
        await release.format();
      }
    }

    await post.format();

    // Process blocks: populate release and hub data for backwards compatibility
    // Uses already-loaded post.releases instead of N+1 queries for efficiency
    if (post.data.blocks) {
      // Create lookup map of releases by publicKey for O(1) access
      const releasesMap = new Map();
      if (post.releases) {
        post.releases.forEach(release => {
          releasesMap.set(release.publicKey, release);
        });
      }

      for await (let block of post.data.blocks) {
        switch (block.type) {
          case 'release':
            // Populate release objects from already-loaded releases (backwards compatibility)
            const releases = []
            if (Array.isArray(block.data)) {
              for (const item of block.data) {
                const publicKey = item?.publicKey || (typeof item === 'string' ? item : null);
                if (publicKey) {
                  const releaseRecord = releasesMap.get(publicKey);
                  if (releaseRecord) {
                    releases.push(releaseRecord)
                  }
                }
              }
            }
            block.data.release = releases
            break;

          case 'featuredRelease':
            // Populate release object from already-loaded releases (backwards compatibility)
            const publicKey = typeof block.data === 'string' ? block.data : block.data?.publicKey;
            if (publicKey) {
              const releaseRecord = releasesMap.get(publicKey);
              if (releaseRecord) {
                block.data = releaseRecord
              }
            }
            break;

          case 'hub':
            const hubs = []
            for await (let hub of block.data) {
              const hubRecord = await Hub.query().findOne({ publicKey: hub });
              if (hubRecord) {
                await hubRecord.format();
                hubs.push(hubRecord)
              }
            }
            block.data.hubs = hubs
            break;

          default:
            break;
        }
      }
    }

    ctx.body = {
      post,
      publisher,
      publishedThroughHub,
  };
  } catch (err) {
    console.log(err)
    postNotFound(ctx)
  }
})

const postNotFound = (ctx) => {
  ctx.status = 404
  ctx.body = {
    message: `Post not found with publicKeyOrSlug: ${ctx.params.publicKeyOrSlug}`
  }
}

const findPostForPublicKeyOrSlug = async (publicKeyOrSlug) => {
  let post = await Post.query()
    .where('archived', false)
    .withGraphFetched('releases')
    .findOne({publicKey: publicKeyOrSlug})
  if (!post) {
    post = await Post.query()
      .withGraphFetched('releases')
      .where(ref('data:slug').castText(), 'like', `%${publicKeyOrSlug}%`)
      .first()
  }
  return post
}

export default router
