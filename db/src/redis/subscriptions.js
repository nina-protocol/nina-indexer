import redis from './index.js';
import Subscription from '../models/Subscription.js';
import Account from '../models/Account.js';
import { formatColumnForJsonFields, BIG_LIMIT } from '../utils/index.js';

const SUBSCRIPTION_TO = 'subscription:to'
const getFollowersForAccountWithCache = async (publicKeyOrHandle, query, override=false) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime' } = query;
    return redis.withCache(`${SUBSCRIPTION_TO}:${publicKeyOrHandle}:${offset}:${limit}:${sort}:${column}`, async () => {
      let account = await Account.query().findOne({publicKey: publicKeyOrHandle});
      if (!account) {
        account = await Account.query().findOne({handle: publicKeyOrHandle});
        if (!account) {
          throw new Error(`Account not found for publicKeyOrHandle ${publicKeyOrHandle}`)
        }
      }
        const publicKey = account.publicKey
        column = formatColumnForJsonFields(column);
        const subscriptions = await Subscription.query()
          .where('to', publicKey)
          .orderBy(column, sort)
          .range(Number(offset), Number(offset) + Number(limit) - 1);
        
        const followers = []
        for await (let subscription of subscriptions.results) {
          if (subscription.subscriptionType === 'account') {
            const account = await Account.findOrCreate(subscription.from);
            await account.format();
            delete subscription.id
    
            followers.push({
              account,
              subscription,
            })
          }
        }
        return {
          followers,
          total: subscriptions.total
        }
      }, 
      undefined,
      override
    );  
  } catch (error) {
    console.log('getFollowersForAccountWithCache error', error)
  }
};

const getUserFollowingAccountWithCache = async (
  publicKeyOrHandle,
  followingPublicKeyOrHandle,
  override = false,
) => {
  try {
    return redis.withCache(
      `following:${publicKeyOrHandle}:${followingPublicKeyOrHandle}`, async () => {
        let account = await Account.query().findOne({publicKey: publicKeyOrHandle});
        if (!account) {
          account = await Account.query().findOne({handle: publicKeyOrHandle});
          if (!account) {
            ctx.status = 404
            ctx.body = {
              success: false,
              following:false,
              message: `Account not found with publicKey: ${publicKeyOrHandle}`
            }
            return;
          }
        }
        let followingAccount = await Account.query().findOne({publicKey: followingPublicKeyOrHandle});
        if (!followingAccount) {
          followingAccount = await Account.query().findOne({handle: followingPublicKeyOrHandle});
          if (!followingAccount) {
            followingAccount = await Hub.query().findOne({publicKey: followingPublicKeyOrHandle});
            if (!followingAccount) {
              followingAccount = await Hub.query().findOne({handle: followingPublicKeyOrHandle});
            }
            if (!followingAccount) {
              ctx.status = 404
              ctx.body = {
                success: false,
                following:false,
                message: `Account not found with publicKey: ${followingPublicKeyOrHandle}`
              }
              return;
            }
          }
        }
        const publicKey = account.publicKey
        const followingPublicKey = followingAccount.publicKey
        const subscriptions = await Subscription.query()
          .where('from', publicKey)
          .andWhere('to', followingPublicKey)

        return subscriptions.length > 0
    
      },
      undefined,
      override
    )
  } catch (error) {
    console.log('getUserFollowingAccountWithCache error', error)
  }
}

const deleteCacheAfterAccountFollow = async(
  toPublicKey,
  toHandle,
  fromPublicKey,
  fromHandle,
) => {
  try {
    console.log('deleteCacheAfterAccountFollow', toHandle, toPublicKey)
    await redis.deleteCacheMatchingPattern(`${SUBSCRIPTION_TO}:${toPublicKey}*`)
    await redis.deleteCacheMatchingPattern(`${SUBSCRIPTION_TO}:${toHandle}*`)
    await redis.deleteCacheMatchingPattern(`following:${fromPublicKey}:${toPublicKey}`)
    await redis.deleteCacheMatchingPattern(`following:${fromPublicKey}:${toHandle}`)
    await redis.deleteCacheMatchingPattern(`following:${fromHandle}:${toPublicKey}`)
    await redis.deleteCacheMatchingPattern(`following:${fromHandle}:${toHandle}`)
    
  } catch (error) {
    console.log('deleteCacheAfterAccountFollow error: ', error)
  }
}

export default {
  getFollowersForAccountWithCache,
  getUserFollowingAccountWithCache,
  deleteCacheAfterAccountFollow,
}