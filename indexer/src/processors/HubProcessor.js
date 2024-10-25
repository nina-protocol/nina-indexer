import { BaseProcessor } from './base/BaseProcessor.js';
import { hubDataService } from '../services/hubData.js';
import { Account, Hub } from '@nina-protocol/nina-db';

export class HubProcessor extends BaseProcessor {
    constructor() {
      super();
      this.HUB_TRANSACTION_TYPES = new Set([
        'HubInitWithCredit',
        'HubInit',
        'HubAddCollaborator', 
        'HubAddRelease',
        'HubContentToggleVisibility',
        'HubRemoveCollaborator',
        'HubUpdateCollaboratorPermissions',
        'HubUpdateConfig',
        'HubWithdraw'
      ]);
    }
  
    canProcessTransaction(type) {
      return this.HUB_TRANSACTION_TYPES.has(type);
    }
  
    async handleHubInit(transaction, accounts, authority) {
      const hubPublicKey = this.isFileServicePayer(accounts) ?
        accounts[2].toBase58() : accounts[1].toBase58();

      let hub = await Hub.query().findOne({ publicKey: hubPublicKey });
      if (!hub) {
        const hubData = await hubDataService.fetchHubData(hubPublicKey);
        hub = await Hub.query().insertGraph({
          publicKey: hubPublicKey,
          handle: hubData.handle,
          data: hubData.metadata,
          dataUri: hubData.uri,
          datetime: new Date(transaction.blocktime * 1000).toISOString(),
          authorityId: authority.id
        });
      }

      return hub;
    }

    async processTransaction(txid) {
      const txData = await this.processTransactionRecord(txid);
      if (!txData) return;
  
      const { transaction, accounts, txInfo } = txData;
      
      if (!this.canProcessTransaction(transaction.type)) {
        return;
      }
  
      const authority = await Account.query().findById(transaction.authorityId);
  
      switch (transaction.type) {
        case 'HubInitWithCredit':
        case 'HubInit': {
          const hubPublicKey = this.isFileServicePayer(accounts) ? 
            accounts[2].toBase58() : accounts[1].toBase58();
          
          const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
          if (!hub) {
            const hubData = await hubDataService.fetchHubData(hubPublicKey);
            const newHub = await Hub.query().insertGraph({
              publicKey: hubPublicKey,
              handle: hubData.handle,
              data: hubData.metadata,
              dataUri: hubData.uri,
              datetime: new Date(transaction.blocktime * 1000).toISOString(),
              authorityId: authority.id
            });
            await this.updateTransactionReferences(transaction, { hubId: newHub.id });
          } else {
            await this.updateTransactionReferences(transaction, { hubId: hub.id });
          }
          break;
        }
      }
    }
}
  
export const hubProcessor = new HubProcessor();