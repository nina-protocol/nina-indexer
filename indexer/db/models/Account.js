const { Model } = require('objection');

class Account extends Model {
  static get tableName() {
    return 'accounts';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['publicKey'],
      properties: {
        publicKey: { type: 'string' },
      },
    };
  }

  static async findOrCreate(publicKey) {
    let account = await Account.query().findOne({ publicKey });
    if (account) {
      return account;
    }
    account = await Account.query().insert({ publicKey });
    console.log('Inserted Account: ', publicKey)
    return account;
  }

  format () {
    delete this.id
  }

  static get relationMappings() {
    const Exchange = require('./Exchange');
    const Hub = require('./Hub');
    const Post = require('./Post');
    const Release = require('./Release');

    return {
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
      }
    };
  }
}

module.exports = Account;