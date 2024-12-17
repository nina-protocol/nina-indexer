import KoaRouter from 'koa-router'
import { 
  Account,
  Exchange,
  Hub,
  Post,
  Release,
  Subscription,
  Transaction,
  config,
} from '@nina-protocol/nina-db';
import Knex from 'knex'
import { ref } from 'objection'

import {
  formatColumnForJsonFields,
  getPublishedThroughHubSubQuery,
  BIG_LIMIT
} from '../utils.js';

const router = new KoaRouter({
  prefix: '/posts'
})

router.get('/', async (ctx) => {
  try {
    const { offset=0, limit=20, sort='desc', column='datetime', query=''} = ctx.query;
    const posts = await Post
      .query()
      .where(ref('data:title').castText(), 'ilike', `%${query}%`)
      .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
      .orWhereIn('hubId', getPublishedThroughHubSubQuery(query))
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    for await (let post of posts.results) {
      await post.format();
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
    await NinaProcessor.init()
    let postAccount
    const { txid } = ctx.query
    let post = await Post.query().findOne({publicKey: ctx.params.publicKeyOrSlug})
    if (!post) {
      post = await Post.query().where(ref('data:slug').castText(), 'like', `%${ctx.params.publicKeyOrSlug}%`).first()
    }
    if (!post) {
      postAccount = await NinaProcessor.program.account.post.fetch(new anchor.web3.PublicKey(ctx.params.publicKeyOrSlug), 'confirmed');
      if (!postAccount) {
        throw ('Post not found')
      }
      let hub
      let hubPublicKey
      if (txid) {
        const tx = await NinaProcessor.provider.connection.getParsedTransaction(txid, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        })
        console.log('tx', tx)
        const accounts = tx.transaction.message.instructions.find(i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID)?.accounts
        hubPublicKey = accounts[1].toBase58()
      }
      if (hubPublicKey) {
        const [hubContentPublicKey] =
        await anchor.web3.PublicKey.findProgramAddress(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode(`nina-hub-content`)),
            new anchor.web3.PublicKey(hubPublicKey).toBuffer(),
            new anchor.web3.PublicKey(ctx.params.publicKeyOrSlug).toBuffer(),
          ],
          NinaProcessor.program.programId,
        )
        const hubContentAccount = await NinaProcessor.program.account.hubContent.fetch(new anchor.web3.PublicKey(hubContentPublicKey), 'confirmed');
        if (hubContentAccount) {
          hub = await Hub.query().findOne({ publicKey: hubContentAccount.hub.toBase58() });
        }
      }
      const data = await fetchFromArweave(decode(postAccount.uri));
      const publisher = await Account.findOrCreate(postAccount.author.toBase58());
      const postData = {
        publicKey: ctx.params.publicKeyOrSlug,
        data: data,
        datetime: new Date(postAccount.createdAt.toNumber() * 1000).toISOString(),
        publisherId: publisher.id,
        version: data.blocks ? '0.0.2' : '0.0.1'
      }
      if (hub) {
        postData.hubId = hub.id
      }
      post = await Post.query().insertGraph(postData)
      if (post.data.heroImage) {
        NinaProcessor.warmCache(post.data.heroImage, 5000);
      }
      if (data.blocks) {
        for await (let block of data.blocks) {
          switch (block.type) {
            case 'image':
              try {
                NinaProcessor.warmCache(block.data.image, 5000);
              } catch (error) {
                console.log(error)
              }
              break;

            case 'release':
              for await (let release of block.data) {
                try {
                  const releaseRecord = await Release.query().findOne({ publicKey: release.publicKey });
                  await Post.relatedQuery('releases').for(post.id).relate(releaseRecord.id);
                } catch (err) {
                  console.log('error', err)
                }
              }
              break;

            case 'featuredRelease':
              try {
                const releaseRecord = await Release.query().findOne({ publicKey: block.data });
                await Post.relatedQuery('releases').for(post.id).relate(releaseRecord.id);
              } catch (err) {
                console.log('error', err)
              }
              break
              
            default:
              break
          }
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



export default router
