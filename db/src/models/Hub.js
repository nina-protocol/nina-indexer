import { Model } from 'objection';
import { stripHtmlIfNeeded } from '../utils/index.js';
import Account from './Account.js';
import Release from './Release.js';
import Post from './Post.js';

export default class Hub extends Model {
  static get tableName() {
    return 'hubs';
  }
  static get idColumn() {
    return 'id';
  }
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['publicKey', 'handle', 'data', 'dataUri', 'datetime'],
      properties: {
        publicKey: { type: 'string' },
        handle: { type: 'string' },
        data: { type: 'object' },
        dataUri: { type: 'string' },
        datetime: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    };
  }

  async format () {
    const authority = await this.$relatedQuery('authority').select('publicKey');
    this.authority = authority.publicKey;
    delete this.authorityId;
    delete this.id;

    stripHtmlIfNeeded(this.data, 'description');
  }
  
  static relationMappings = () => ({
    authority: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: 'hubs.authorityId',
        to: 'accounts.id',
      },
    },
    collaborators: {
      relation: Model.ManyToManyRelation,
      modelClass: Account,
      join: {
        from: 'hubs.id',
        through: {
          from: 'hubs_collaborators.hubId',
          to: 'hubs_collaborators.accountId',
          extra: ['hubCollaboratorPublicKey'],
        },
        to: 'accounts.id',
      },
    },
    posts: {
      relation: Model.ManyToManyRelation,
      modelClass: Post,
      join: {
        from: 'hubs.id',
        through: {
          from: 'hubs_posts.hubId',
          to: 'hubs_posts.postId',
          extra: ['hubPostPublicKey'],
        },
        to: 'posts.id',
      },
    },
    releases: {
      relation: Model.ManyToManyRelation,
      modelClass: Release,
      join: {
        from: 'hubs.id',
        through: {
          from: 'hubs_releases.hubId',
          to: 'hubs_releases.releaseId',
          extra: ['hubReleasePublicKey', 'visible'],
        },
        to: 'releases.id',
      },
    },
  })
}
