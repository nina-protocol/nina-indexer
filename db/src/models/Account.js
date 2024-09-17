import { Model } from 'objection';
import Exchange from './Exchange.js';
import Hub from './Hub.js';
import Post from './Post.js';
import Release from './Release.js';
import Verification from './Verification.js';
import Subscription from './Subscription.js';

export default class Account extends Model {
  static tableName= 'accounts';

  static idColumn = 'id';

  static jsonSchema = {
    type: 'object',
    required: ['publicKey'],
    properties: {
      publicKey: { type: 'string' },
      image: { type: 'string' },
      description: { type: 'string' },
      displayName: { type: 'string' },
      handle: { type: 'string' },
    },
  }

  static findOrCreate = async (publicKey) => {
    let account = await Account.query().findOne({ publicKey });
    if (account) {
      return account;
    }
    account = await Account.query().insert({ publicKey });
    console.log('Inserted Account: ', publicKey)
    return account;
  }

  format = async () => {
    const verifications = await this.$relatedQuery('verifications').where('active', true);
    if (verifications) {
      for await (let verification of verifications) {
        await verification.format();
      }
      this.verifications = verifications;
    }
    delete this.id
    const followers = await Subscription.query().where('to', this.publicKey).range(0,0);
    this.followers = followers.total;
  }

  static relationMappings = () => ({    
    published: {  
      relation: Model.HasManyRelation,
      modelClass: Release,
      join: {
        from: 'accounts.id',
        to: 'releases.publisherId'
      }
    },
    collected: {  
      relation: Model.ManyToManyRelation,
      modelClass: Release,
      join: {
        from: 'accounts.id',
        through: {
          from: 'releases_collected.accountId',
          to: 'releases_collected.releaseId',
        },
        to: 'releases.id'
      }
    },
    exchangesInitialized: {
      relation: Model.HasManyRelation,
      modelClass: Exchange,
      join: {
        from: 'accounts.id',
        to: 'exchanges.initializerId',
      },
    },
    exchangesCompleted: {
      relation: Model.HasManyRelation,
      modelClass: Exchange,
      join: {
        from: 'accounts.id',
        to: 'exchanges.completedById',
      },
    },
    hubs: {
      relation: Model.ManyToManyRelation,
      modelClass: Hub,
      join: {
        from: 'accounts.id',
        through : {
          from: 'hubs_collaborators.accountId',
          to: 'hubs_collaborators.hubId',
          extra: ['hubCollaboratorPublicKey'],
        },
        to: 'hubs.id',
      },
    },
    posts: {
      relation: Model.HasManyRelation,
      modelClass: Post,
      join: {
        from: 'accounts.id',
        to: 'posts.publisherId',
      },
    },
    revenueShares: {
      relation: Model.ManyToManyRelation,
      modelClass: Release,
      join: {
        from: 'accounts.id',
        through: {
          from: 'releases_revenue_share.accountId',
          to: 'releases_revenue_share.releaseId',
        },
        to: 'releases.id',
      },
    },
    verifications: {
      relation: Model.HasManyRelation,
      modelClass: Verification,
      join: {
        from: 'accounts.id',
        to: 'verifications.accountId',
      },
    },
  })
}