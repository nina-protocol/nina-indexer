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

  static async findOrCreate(publicKey, from, to, datetime, subscriptionType) {
    let subscription = await Subscription.query().findOne({ publicKey });
    if (subscription) {
      return subscription;
    }
    subscription = await subscription.query().insert({
      publicKey, from, to, datetime, subscriptionType
    });
    console.log('Inserted subscription: ', publicKey)
    return subscription;
  }

  async format () {
    delete this.id;
  }
}

module.exports = Subscription;