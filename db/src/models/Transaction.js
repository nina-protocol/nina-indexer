import { Model } from 'objection';
import Account from './Account.js';
import Hub from './Hub.js';
import Release from './Release.js';
import Post from './Post.js';

class Transaction extends Model {
  static get tableName() {
    return 'transactions';
  }
  static get idColumn() {
    return 'id';
  }
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['txid', 'blocktime', 'type'],
      properties: {
        txid: { type: 'string' },
        blocktime: { type: 'integer' },
        type: {
          type: 'string',
          enum: [
            'HubInitWithCredit',
            'ReleaseInitWithCredit',
            'ReleaseInitViaHub',
            'ReleasePurchase',
            'ReleasePurchaseViaHub',
            'HubAddCollaborator',
            'HubAddRelease',
            'PostInitViaHub',
            'PostInitViaHubWithReferenceRelease',
            'SubscriptionSubscribeAccount',
            'SubscriptionSubscribeHub',
            'Unknown'
          ],
        },
      },
    };
  }

  async format () {    
    const hub = await this.$relatedQuery('hub');
    if (hub) {
      await hub.format()
      this.hub = hub;
    }
    delete this.hubId

    const authority = await this.$relatedQuery('authority');
    if (authority) {
      await authority.format();
      this.authority = authority;
    }
    delete this.authorityId

    const release = await this.$relatedQuery('release');
    if (release) {
      await release.format();
      this.release = release;
    }
    delete this.releaseId

    const post = await this.$relatedQuery('post');
    if (post) {
      await post.format();
      this.post = post;
    }
    delete this.postId

    const toAccount = await this.$relatedQuery('toAccount');
    if (toAccount) {
      await toAccount.format();
      this.toAccount = toAccount;
    }
    delete this.toAccountId

    const toHub = await this.$relatedQuery('toHub');
    if (toHub) {
      await toHub.format();
      this.toHub = toHub;
    }
    delete this.toHubId

    this.datetime = new Date(this.blocktime * 1000).toISOString()
    delete this.id;
  }

  static relationMappings = () => ({
    authority: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: 'transactions.authorityId',
        to: 'accounts.id',
      },
    },
    hub: {  
      relation: Model.HasOneRelation,
      modelClass: Hub,
      join: {
        from: 'transactions.hubId',
        to: 'hubs.id',
      },
    },
    release: {
      relation: Model.HasOneRelation,
      modelClass: Release,
      join: {
        from: 'transactions.releaseId',
        to: 'releases.id',
      },
    },
    post: {
      relation: Model.HasOneRelation,
      modelClass: Post,
      join: {
        from: 'transactions.postId',
        to: 'posts.id',
      },
    },
    toAccount: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: 'transactions.toAccountId',
        to: 'accounts.id',
      },
    },
    toHub: {
      relation: Model.HasOneRelation,
      modelClass: Hub,
      join: {
        from: 'transactions.toHubId',
        to: 'hubs.id',
      },
    },
  })
}

export default Transaction;