import { Model } from 'objection';
import Account from './Account';
import Hub from './Hub';

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
      const accountTo = await Account.query().findOne({ publicKey: this.to });
      await accountTo.format();
      this.to = accountTo;

      const accountFrom = await Account.query().findOne({ publicKey: this.from });
      await accountFrom.format();
      this.from = accountFrom;
    } else if (this.subscriptionType === 'hub') {
      const hub = await Hub.query().findOne({ publicKey: this.to });
      await hub.format();
      this.to = hub;
      
      const account = await Account.query().findOne({ publicKey: this.from });
      await account.format();
      this.from = account;
    }
    delete this.id;
  }
}

export default Subscription;