import { BaseProcessor } from './baseProcessor.js';
import { Release, Account, Hub } from '@nina-protocol/nina-db';

export class ReleaseProcessor extends BaseProcessor {
    constructor() {
      super();
      this.RELEASE_TRANSACTION_TYPES = new Set([
        'ReleaseInitWithCredit',
        'ReleaseInitViaHub',
        'ReleasePurchaseViaHub',
        'ReleasePurchase',
        'ReleaseClaim',
        'ReleaseInit',
        'ReleaseCloseEdition',
        'ReleaseUpdateMetadata',
        'ReleaseRevenueShareCollectViaHub',
        'ReleaseRevenueShareCollect',
        'ReleaseRevenueShareTransfer'
      ]);
    }
  
    canProcessTransaction(type) {
      return this.RELEASE_TRANSACTION_TYPES.has(type);
    }
  
    async processTransaction(txid) {
      const txData = await this.processTransactionRecord(txid);
      if (!txData) return;
  
      const { transaction, accounts, txInfo } = txData;
      
      if (!this.canProcessTransaction(transaction.type)) {
        return;
      }
  
      const authority = await Account.query().findById(transaction.authorityId);
      
      // Process based on transaction type
      switch (transaction.type) {
        case 'ReleaseInitWithCredit':
        case 'ReleaseInit': {
          const releasePublicKey = accounts[0].toBase58();
          const release = await Release.findOrCreate(releasePublicKey);
          await this.updateTransactionReferences(transaction, { 
            releaseId: release.id 
          });
          break;
        }
  
        case 'ReleaseInitViaHub': {
          const releasePublicKey = accounts[1].toBase58();
          const hubPublicKey = accounts[4].toBase58();
          const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
          const release = await Release.findOrCreate(releasePublicKey, hubPublicKey);
          await this.updateTransactionReferences(transaction, { 
            releaseId: release.id,
            hubId: hub.id
          });
          break;
        }
  
        // need more release transaction handlers
      }
    }
  }

  export const releaseProcessor = new ReleaseProcessor();