import { Model } from 'objection';
import Account from './Account.js';
import Release from './Release.js';

export default class Exchange extends Model {
  static tableName = 'exchanges'
  static idColum = 'id'

  static jsonSchema = {
    type: 'object',
    required: ['publicKey', 'isSale', 'initializerAmount', 'expectedAmount', 'cancelled', 'createdAt'],
    properties: {
      publicKey: { type: 'string' },
      isSale: { type: 'boolean' },
      initializerAmount: { type: 'number' },
      expectedAmount: { type: 'number' },
      cancelled: { type: 'boolean' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  }

  format = async () => {
    const initializer = await this.$relatedQuery('initializer');
    const completedBy = await this.$relatedQuery('completedBy');
    const release = await this.$relatedQuery('release').select('publicKey');

    if (completedBy) {
      await completedBy.format();
      this.completedBy = completedBy;
    }
    this.release = release.publicKey;
    await initializer.format();
    this.initializer = initializer;
    delete this.id
    delete this.initializerId
    delete this.completedById
    delete this.releaseId
  }

  static relationMappings = () => ({
    initializer: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: 'exchanges.initializerId',
        to: 'accounts.id',
      },
    },
    completedBy: {
      relation: Model.HasOneRelation,
      modelClass: Account,
      join: {
        from: 'exchanges.completedById',  
        to: 'accounts.id',
      },
    },
    release: {
      relation: Model.HasOneRelation,
      modelClass: Release,
      join: {
        from: 'exchanges.releaseId',
        to: 'releases.id',
      },
    },
  })
}
