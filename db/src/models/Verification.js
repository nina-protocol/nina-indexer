import { Model } from 'objection';
import Account from './Account.js';

export default class Verification extends Model {
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

  async format () {
    delete this.id;
    const account = await this.$relatedQuery('account');
    delete this.accountId;
    if (account) {
      this.account = account.publicKey;
    }
  }

  static relationMappings = () => ({
    account: {
      relation: Model.BelongsToOneRelation,
      modelClass: Account,
      join: {
        from: 'verifications.accountId',
        to: 'accounts.id',
      },
    },
  });
}