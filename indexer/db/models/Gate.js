const { Model } = require('objection');

class Gate extends Model {
  static get tableName() {
    return 'gates';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['fileName', 'fileSize', 'uri'],
      properties: {
        description: { type: 'string' },
        fileName: { type: 'string' },
        fileSize: { type: 'integer' },
        uri: { type: 'string' },
      }
    }
  }

  static get relationMappings() {
    const Release = require('./Release');
    return {
      release: {
        relation: Model.HasOneRelation,
        modelClass: Release,
        join: {
          from: 'gates.releaseId',
          to: 'releases.id',
        },
      },
    };
  }
}

module.exports = Gate;
