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

  static sanitizeValue = (value) => value.toLowerCase().replace('#', '').replace(',', '');

  static findOrCreate = async (value) => {
    const sanitizedValue = this.sanitizeValue(value);
    let tag = await Tag.query().where('value', sanitizedValue).first();
    if (!tag) {
      tag = await Tag.query().insert({ value: sanitizedValue });
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