import { Model } from 'objection';

export default class TagsRelease extends Model {
  static tableName = 'tags_releases';

  $beforeUpdate() {
    this.updatedAt = new Date().toISOString();
  }

  static jsonSchema = {
    type: 'object',
    required: ['tagId', 'releaseId', 'createdAt', 'updatedAt'],
    properties: {
      tagId: { type: 'integer' },
      releaseId: { type: 'integer' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  }
}