import { Model } from 'objection';
import Account from './Account.js';
import Hub from './Hub.js';

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
      required: ['datetime'],
      properties: {
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

  static async findOrCreate({from, to, datetime, subscriptionType}) {
    let subscription = await Subscription.query().findOne({ from, to });
    if (subscription) {
      return subscription;
    }

    subscription = await Subscription.query().insert({
      from, to, datetime, subscriptionType
    });
    console.log('Inserted subscription: ', from, to)
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