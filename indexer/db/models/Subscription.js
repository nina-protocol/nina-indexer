const { Model } = require('objection');
const Account = require('./Account');
const Hub = require('./Hub');

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

  static async findOrCreate({publicKey, from, to, datetime, subscriptionType}) {
    let subscription = await Subscription.query().findOne({ publicKey });
    if (subscription) {
      return subscription;
    }

    subscription = await Subscription.query().insert({
      publicKey, from, to, datetime, subscriptionType
    });
    console.log('Inserted subscription: ', publicKey)
    return subscription;
  }

  async format () {
    if (this.subscriptionType === 'account') {
      const account = await Account.query().findOne({ publicKey: this.to });
      await account.format();
      this.to = account;
    } else if (this.subscriptionType === 'hub') {
      const hub = await Hub.query().findOne({ publicKey: this.to });
      await hub.format();
      this.to = hub;
    }
    delete this.id;
  }
}

module.exports = Subscription;