const { Model } = require('objection');

class Verification extends Model {
  static get tableName() {
    return 'verifications';
  }
  static get idColumn() {
    return 'id';
  }
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['publicKey', 'type', 'value'],
      properties: {
        publicKey: { type: 'string' },
        type: {
          type: 'string',
          enum: [
            'soundcloud',
            'instagram',
            'twitter',
            'ethereum',
          ],
        },
        value: { type: 'string' },
        displayName: { type: 'string' },
        image: { type: 'string' },
        description: { type: 'string' },
      },
    };
  }
  
  static get relationMappings() {
    const Account = require('./Account');
    return {
      account: {
        relation: Model.BelongsToOneRelation,
        modelClass: Account,
        join: {
          from: 'verifications.accountId',
          to: 'accounts.id',
        },
      },
    };
  }
}

module.exports = Verification;