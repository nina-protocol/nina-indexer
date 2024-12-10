import { BaseProcessor } from './base/BaseProcessor.js';
import { hubDataService } from '../services/hubData.js';
import { Account, Hub } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';

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
        case 'HubAddRelease': {
          try {
            const hubPublicKey = this.isFileServicePayer(accounts) ?
              accounts[1].toBase58() : accounts[0].toBase58();
            const releasePublicKey = this.isFileServicePayer(accounts) ?
              accounts[2].toBase58() : accounts[1].toBase58();

            const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
            if (!hub) {
              logTimestampedMessage(`Hub not found for HubAddRelease ${txid} with publicKey ${hubPublicKey}`);
              return;
            }

            const release = await Release.query().findOne({ publicKey: releasePublicKey });
            if (!release) {
              logTimestampedMessage(`Release not found for HubAddRelease ${txid} with publicKey ${releasePublicKey}`);
              return;
            }

            await Hub.relatedQuery('releases')
              .for(hub.id)
              .relate({
                id: release.id,
                visible: true,
                hubReleasePublicKey: `${hubPublicKey}-${releasePublicKey}`
              })
              .onConflict(['hubId', 'releaseId'])
              .merge(['visible']);

            await this.updateTransactionReferences(transaction, {
              hubId: hub.id,
              releaseId: release.id
            });

            logTimestampedMessage(`Successfully processed HubAddRelease ${txid} for hub ${hubPublicKey} and release ${releasePublicKey}`);
          } catch (error) {
            logTimestampedMessage(`Error processing HubAddRelease for ${txid}: ${error.message}`);
          }
          break;
        }
        case 'HubAddCollaborator': {
          try {
            const hubPublicKey = this.isFileServicePayer(accounts) ?
              accounts[3].toBase58() : accounts[2].toBase58();
            const collaboratorPublicKey = this.isFileServicePayer(accounts) ?
              accounts[5].toBase58() : accounts[4].toBase58();

            const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
            if (!hub) {
              logTimestampedMessage(`Hub not found for HubAddCollaborator ${txid}`);
              return;
            }

            const collaborator = await Account.findOrCreate(collaboratorPublicKey);
            if (!collaborator) {
              logTimestampedMessage(`Could not create collaborator account for ${collaboratorPublicKey}`);
              return;
            }

            const hubCollaboratorPublicKey = txInfo.transaction.signatures[0];

            await Hub.relatedQuery('collaborators')
              .for(hub.id)
              .relate({
                id: collaborator.id,
                hubCollaboratorPublicKey
              });

            await this.updateTransactionReferences(transaction, {
              hubId: hub.id,
              toAccountId: collaborator.id
            });

            logTimestampedMessage(`Successfully processed HubAddCollaborator ${txid} for hub ${hubPublicKey} and collaborator ${collaboratorPublicKey}`);
          } catch (error) {
            logTimestampedMessage(`Error processing HubAddCollaborator for ${txid}: ${error.message}`);
          }
          break;
        }
      }
    }
}
  
export const hubProcessor = new HubProcessor();