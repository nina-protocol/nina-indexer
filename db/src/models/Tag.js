import { Model } from 'objection';
import Release from './Release.js';

export default class Tag extends Model {
  static tableName = 'tags';
  static idColumn = 'id';
  static jsonSchema = {
    type: 'object',
    required: ['value'],
    properties: {
      value: { type: 'string' },
    },
  }

  static findOrCreate = async (value) => {
    let tag = await Tag.query().where('value', value).first();
    if (!tag) {
      tag = await Tag.query().insert({ value });
    }
    return tag;
  }

  format = () => {
    delete this.id
  }

  static relationMappings = () => ({
    releases: {
      relation: Model.ManyToManyRelation,
      modelClass: Release,
      join: {
        from: 'tags.id',
        through: {
          from: 'tags_releases.tagId',
          to: 'tags_releases.releaseId',
        },
        to: 'releases.id',
      },
    },
  });
}