import { BaseProcessor } from './base/BaseProcessor.js';
import { hubDataService } from '../services/hubData.js';
import { Account, Hub, Release } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';
import * as anchor from '@project-serum/anchor';

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

    async processTransaction(txid, transaction, accounts, txInfo) {
      try {
        if (!this.canProcessTransaction(transaction.type)) return;
    
        // Verify authority exists
        const authority = await Account.query().findById(transaction.authorityId);
        if (!authority) {
          logTimestampedMessage(`Authority not found for transaction ${txid} with id ${transaction.authorityId}`);
          return;
        }
    
        switch (transaction.type) {
          case 'HubInitWithCredit':
            let hubPublicKey;
            try {
              const hub = await this.program.account.hub.fetch(accounts[3]);
              if (hub) {
                hubPublicKey = accounts[3].toBase58();
              }
            } catch (error) {
              logTimestampedMessage(`HubInitWithCredit: Hub not found at index 3, trying index 1`);
              try {
                const hub = await this.program.account.hub.fetch(accounts[1]);
                if (hub) {
                  hubPublicKey = accounts[1].toBase58();
                }
              } catch (error) {
                logTimestampedMessage(`HubInitWithCredit: Hub not found at index 1, trying index 4`);
                try {
                  const hub = await this.program.account.hub.fetch(accounts[4]);
                  if (hub) {
                    hubPublicKey = accounts[4].toBase58();
                  }
                } catch (error) {
                  logTimestampedMessage(`HubInitWithCredit: Hub not found for txid ${txid}`);
                  return;
                }
              }
            }
            const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
            if (!hub) {
              console.log(`HubInitWithCredit: Creating hub for ${hubPublicKey}`);
              const hubData = await hubDataService.fetchHubData(hubPublicKey);
              const newHub = await Hub.query().insertGraph({
                publicKey: hubPublicKey,
                handle: hubData.handle,
                data: hubData.metadata,
                dataUri: hubData.uri,
                datetime: new Date(transaction.blocktime * 1000).toISOString(),
                authorityId: authority.id
              });
              return { hubId: newHub.id };
            } else {
              return { hubId: hub.id };
            }
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
              return { hubId: newHub.id };
            } else {
              return { hubId: hub.id };
            }
          }
          case 'HubAddRelease': {
            try {
              let hubPublicKey;
              let releasePublicKey;
              if (this.isFileServicePayer(accounts)) {
                hubPublicKey = accounts[2].toBase58();
                releasePublicKey = accounts[6].toBase58();
              } else {
                try {
                  console.log('looking for hub at index 0');
                  const hub = await this.program.account.hub.fetch(accounts[0]);
                  if (hub) {
                    hubPublicKey = accounts[0].toBase58();
                    releasePublicKey = accounts[1].toBase58();
                  }
                } catch (error) {
                  try {
                    console.log('looking for hub at index 1');
                    const hub = await this.program.account.hub.fetch(accounts[1]);
                    if (hub) {
                      hubPublicKey = accounts[1].toBase58();
                      try {
                        console.log('looking for release at index 2');
                        const release = await this.program.account.release.fetch(accounts[2]);
                        if (release) {
                          releasePublicKey = accounts[2].toBase58();
                        }
                      } catch (error) {
                        try {
                          console.log('looking for release index 5');
                          const release = await this.program.account.release.fetch(accounts[5]);
                          if (release) {
                            releasePublicKey = accounts[5].toBase58();
                          }  
                        } catch (error) {
                          console.log('cannot find release')
                        }
                      }
                    }  
                  } catch (error) {
                    try {
                      console.log('looking for hub at index 4');
                      const hub = await this.program.account.hub.fetch(accounts[4]);
                      if (hub) {
                        hubPublicKey = accounts[4].toBase58();
                        releasePublicKey = accounts[6].toBase58();
                      }
                    } catch (error) {
                      try {
                        console.log('looking for hub at index 5');
                        const hub = await this.program.account.hub.fetch(accounts[5]);
                        if (hub) {
                          hubPublicKey = accounts[5].toBase58();
                          releasePublicKey = accounts[4].toBase58();
                        }
                      } catch (error) {
                        logTimestampedMessage(`HubAddRelease: Hub not found for txid ${txid}`);
                        return;
                      }
                    }
                  }
                }                  
              }
  
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
              
              const hubReleasePublicKey = await hubDataService.buildHubReleasePublicKey(hubPublicKey, releasePublicKey);
              console.log('hubReleasePublicKey', hubReleasePublicKey);
              await Hub.relatedQuery('releases')
                .for(hub.id)
                .relate({
                  id: release.id,
                  visible: true,
                  hubReleasePublicKey,
                })
    
              logTimestampedMessage(`Successfully processed HubAddRelease ${txid} for hub ${hubPublicKey} and release ${releasePublicKey}`);
              return { hubId: hub.id, releaseId: release.id };
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
              
              const hubCollaboratorPublicKey = accounts[2].toBase58()

              await Hub.relatedQuery('collaborators')
                .for(hub.id)
                .relate({
                  id: collaborator.id,
                  hubCollaboratorPublicKey
                });
  
                
              logTimestampedMessage(`Successfully processed HubAddCollaborator ${txid} for hub ${hubPublicKey} and collaborator ${collaboratorPublicKey}`);
              return { hubId: hub.id, toAccountId: collaborator.id };
            } catch (error) {
              logTimestampedMessage(`Error processing HubAddCollaborator for ${txid}: ${error.message}`);
            }
            break;
          }
          case 'HubWithdraw': {
            try {
              let hubPublicKey;
              if (accounts[0].toBase58() === accounts[1].toBase58()) {
                hubPublicKey = accounts[2].toBase58();
              } else {
                hubPublicKey = accounts[1].toBase58();
              }
              const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                logTimestampedMessage(`Hub not found for HubWithdraw ${txid}`);
                console.log('accounts', accounts);
                return;
              }
              return { hubId: hub.id };
            } catch (error) {
              logTimestampedMessage(`Error processing HubWithdraw for ${txid}: ${error.message}`);
            }
          }
          case 'HubUpdateConfig': {
            try {
              let hub;
              try {
                hub = await Hub.query().findOne({ publicKey: accounts[2].toBase58() });
                if (!hub) {
                  hub = await Hub.query().findOne({ publicKey: accounts[1].toBase58() });
                }
              } catch (error) {
                logTimestampedMessage(`Hub not found for HubUpdateConfig ${txid}`);
              }

              if (!hub) {
                logTimestampedMessage(`Hub not found for HubUpdateConfig ${txid}`);
                return;
              }
              return { hubId: hub.id };
            } catch (error) {
              logTimestampedMessage(`Error processing HubUpdateConfig for ${txid}: ${error.message}`);
            }
            break;
          }
          case 'HubContentToggleVisibility': {
            try {
              const hubPublicKey = accounts[1].toBase58();
              const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                logTimestampedMessage(`Hub not found for HubContentToggleVisibility ${txid}`);
                return;
              }
              const contentPublicKey = accounts[3].toBase58();
              const hubContentPublicKey = await hubDataService.buildHubContentPublicKey(hubPublicKey, contentPublicKey);
              const hubContent = await this.program.account.hubContent.fetch(new anchor.web3.PublicKey(hubContentPublicKey));

              let content;
              let table;
              try {
                content = await Release.query().findOne({ publicKey: contentPublicKey });
                table = 'releases';
              } catch (error) {
                content = await Post.query().findOne({ publicKey: contentPublicKey });
                table = 'posts';
              }

              if (!content) {
                logTimestampedMessage(`Content not found for HubContentToggleVisibility ${txid}`);
                return;
              }

              await Hub.relatedQuery(table)
                .for(hub.id)
                .patch({
                  visible: hubContent.visible,
                })
                .where( {id: content.id });

              logTimestampedMessage(`Successfully processed HubContentToggleVisibility ${txid} for hub ${hubPublicKey} and ${table} ${content}`);
                
              const response = {
                hubId: hub.id,
              }
              if (table === 'releases') {
                response.releaseId = content.id;
              } else {
                response.postId = content.id;
              }
              return response;
            } catch (error) {
              logTimestampedMessage(`Error processing HubContentToggleVisibility for ${txid}: ${error.message}`);
            }
            break;
          }
          case 'HubRemoveCollaborator': {
            try {
              const collaboratorPublicKey = accounts[3].toBase58();
              const hubPublicKey = accounts[1].toBase58();

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

              await Hub.relatedQuery('collaborators')
                .for(hub.id)
                .unrelate()
                .where('id', collaborator.id);
              logTimestampedMessage(`Successfully processed HubRemoveCollaborator ${txid} for hub ${hubPublicKey} and collaborator ${collaboratorPublicKey}`);
              return { hubId: hub.id, toAccountId: collaborator.id };
            } catch (error) {
              logTimestampedMessage(`Error processing HubRemoveCollaborator for ${txid}: ${error.message}`);
            }
            break;
          }
        }  
      } catch (error) {
        logTimestampedMessage(`HubProcessor: Error processing transaction ${txid}: ${error.message}`);
      }
    }
}
  
export const hubProcessor = new HubProcessor();