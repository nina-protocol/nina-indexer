import { Model } from 'objection';

export default class TagsPosts extends Model {
  static tableName = 'tags_posts';

  $beforeUpdate() {
    this.updatedAt = new Date().toISOString();
  }

  static jsonSchema = {
    type: 'object',
    required: ['tagId', 'postId'],
    properties: {
      tagId: { type: 'integer' },
      postId: { type: 'integer' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  }
}
