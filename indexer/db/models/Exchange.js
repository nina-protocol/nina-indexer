const { Model } = require('objection');

class Exchange extends Model {
  static get tableName() {
    return 'exchanges'
  }
  static get idColumn() {
    return 'id'
  }
  static get jsonSchema() {
    return {
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
    };
  }

  async format () {
    const initializer = await this.$relatedQuery('initializer').select('publicKey');
    const completedBy = await this.$relatedQuery('completedBy').select('publicKey');
    const release = await this.$relatedQuery('release').select('publicKey');

    if (completedBy) {
      this.completedBy = completedBy.publicKey;
    }
    this.release = release.publicKey;
    this.initializer = initializer.publicKey;

    delete this.id
    delete this.initializerId
    delete this.completedById
    delete this.releaseId
  }

  static get relationMappings() {
    const Account = require('./Account');
    const Release = require('./Release');

    return {
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
    }
  }
}


module.exports = Exchange;