const { Model } = require('objection');

class Subscription extends Model {
  static get tableName() {
    return 'subscriptions';
  }
  static get idColumn() {
    return 'id';
  }
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['publicKey', 'datetime'],
      properties: {
        publicKey: { type: 'string' },
        datetime: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        subscriptionType: {
          type: 'string',
          enum: ['account', 'hub'],
        },
      },
    };
  }

  async format () {
    delete this.id;
  }
}

module.exports = Subscription;