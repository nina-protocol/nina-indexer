const { Model } = require('objection');
const { stripHtmlIfNeeded } = require('../../utils');

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
  
  async format() {
    const publisher = await this.$relatedQuery('publisher').select('publicKey');
    const publishedThroughHub = await this.$relatedQuery('publishedThroughHub').select('publicKey');

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
    const Account = require('./Account');
    const Exchange = require('./Exchange');
    const Hub = require('./Hub');
    const Post = require('./Post');

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
            extra: ['publicKey'],
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
