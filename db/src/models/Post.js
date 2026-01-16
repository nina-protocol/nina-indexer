import { Model } from 'objection';
import { stripHtmlIfNeeded } from '../utils/index.js';
import Account from './Account.js';
import Hub from './Hub.js';
import Release from './Release.js';
import Tag from './Tag.js';

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
      required: ['publicKey', 'data', 'datetime', 'version'],
      properties: {
        publicKey: { type: 'string' },
        data: { type: 'object' },
        datetime: { type: 'string' },
        version: { type: 'string' },
      },
    };
  }

  async format(options = {}) {
    const { includeBlocks = true } = options;

    const publisher = await this.$relatedQuery('publisher').select('publicKey');
    const publishedThroughHub = await this.$relatedQuery('publishedThroughHub');

    this.publisher = publisher.publicKey;
    if (publishedThroughHub) {
      this.publishedThroughHub = publishedThroughHub.publicKey;
      this.hub = publishedThroughHub;
      delete this.hub.id;
      delete this.hub.authorityId;
    }

    delete this.publisherId
    delete this.id
    delete this.hubId

    // Strip blocks for list views unless explicitly requested
    if (!includeBlocks && this.data?.blocks) {
      delete this.data.blocks;
    }

    stripHtmlIfNeeded(this.data, 'body');
  }

  static relationMappings = () => ({    
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
          extra: ['hubPostPublicKey'],
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
    tags: {
      relation: Model.ManyToManyRelation,
      modelClass: Tag,
      join: {
        from: 'posts.id',
        through: {
          from: 'tags_posts.postId',
          to: 'tags_posts.tagId',
        },
        to: 'tags.id',
      },
    },
  })
}


export default Post;
