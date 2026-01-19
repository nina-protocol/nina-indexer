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
    await post.format();

    if (post.data.blocks) {
      const releases = []
      for await (let block of post.data.blocks) {
        switch (block.type) {
          case 'release':
            for await (let release of block.data) {
              const releaseRecord = await Release.query().findOne({ publicKey: release });
              if (releaseRecord) {
                await releaseRecord.format();
                releases.push(releaseRecord)
              }
            }
            block.data.release = releases
            break;
          case 'featuredRelease':
            const releaseRecord = await Release.query().findOne({ publicKey: block.data });
            if (releaseRecord) {
              await releaseRecord.format();
              block.data = releaseRecord
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
  let post = await Post.query().where('archived', false).findOne({publicKey: publicKeyOrSlug})
  if (!post) {
    post = await Post.query().where(ref('data:slug').castText(), 'like', `%${publicKeyOrSlug}%`).first()
  }
  return post
}

export default router
