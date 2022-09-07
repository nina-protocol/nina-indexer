const { Model } = require('objection');
const { stripHtmlIfNeeded } = require('../../utils');

class Post extends Model {
  static get tableName() {
    return 'posts';
  }
  static get idColumn() {
    return 'id';
  }
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['publicKey', 'data', 'datetime'],
      properties: {
        publicKey: { type: 'string' },
        data: { type: 'object' },
        datetime: { type: 'string' },
      },
    };
  }

  async format() {
    const publisher = await this.$relatedQuery('publisher').select('publicKey');
    const publishedThroughHub = await this.$relatedQuery('publishedThroughHub').select('publicKey');

    this.publisher = publisher.publicKey;
    if (publishedThroughHub) {
      this.publishedThroughHub = publishedThroughHub.publicKey;
    }
    
    delete this.publisherId
    delete this.id
    delete this.hubId
  
    stripHtmlIfNeeded(this.data, 'body');
  }

  static relationMappings() {
    const Account = require('./Account');
    const Hub = require('./Hub');
    const Release = require('./Release');
    return {
      publishedThroughHub: {
        relation: Model.BelongsToOneRelation,
        modelClass: Hub,
        join: {
          from: 'posts.hubId',
          to: 'hubs.id',
        },
      },
      publisher: {
        relation: Model.HasOneRelation,
        modelClass: Account,
        join: {
          from: 'posts.publisherId',
          to: 'accounts.id',
        },
      },
      hubs: {
        relation: Model.ManyToManyRelation,
        modelClass: Hub,
        join: {
          from: 'posts.id',
          through : {
            from: 'hubs_posts.postId',
            to: 'hubs_posts.hubId',
          },
          to: 'hubs.id',
        },
      },
      releases: {
        relation: Model.ManyToManyRelation,
        modelClass: Release,
        join: {
          from: 'posts.id',
          through : {
            from: 'posts_releases.postId',
            to: 'posts_releases.releaseId',
          },
          to: 'releases.id',
        },
      },
    }
  }
}


module.exports = Post;
