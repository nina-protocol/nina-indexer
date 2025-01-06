import { BaseProcessor } from './base/BaseProcessor.js';
import { hubDataService } from '../services/hubData.js';
import { Account, Hub, Post, Release } from '@nina-protocol/nina-db';
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

    async processTransaction(task) {
      try {
        const { transaction, accounts, txid } = task;
        if (!this.canProcessTransaction(transaction.type)) return;
    
        // Verify authority exists
        const authority = await Account.query().findById(transaction.authorityId);
        if (!authority) {
          logTimestampedMessage(`Authority not found for transaction ${txid} with id ${transaction.authorityId}`);
          return;
        }
    
        switch (transaction.type) {
          case 'HubInitWithCredit':
            try {

              let hubPublicKey;
              try {
                const hub = await hubDataService.fetchHubAccountData(accounts[3]);
                if (hub) {
                  hubPublicKey = accounts[3].toBase58();
                }
              } catch (error) {
                logTimestampedMessage(`HubInitWithCredit: Hub not found at index 3, trying index 1`);
                try {
                  const hub = await hubDataService.fetchHubAccountData(accounts[1]);
                  if (hub) {
                    hubPublicKey = accounts[1].toBase58();
                  }
                } catch (error) {
                  logTimestampedMessage(`HubInitWithCredit: Hub not found at index 1, trying index 4`);
                  try {
                    const hub = await hubDataService.fetchHubAccountData(accounts[4]);
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
                const hubData = await hubDataService.fetchHubData(hubPublicKey);
                const newHub = await Hub.query().insertGraph({
                  publicKey: hubPublicKey,
                  handle: hubData.handle,
                  data: hubData.metadata,
                  dataUri: hubData.uri,
                  datetime: new Date(transaction.blocktime * 1000).toISOString(),
                  authorityId: authority.id
                });

                const [hubCollaborator] = await anchor.web3.PublicKey.findProgramAddress(
                  [
                    Buffer.from(anchor.utils.bytes.utf8.encode("nina-hub-collaborator")), 
                    new anchor.web3.PublicKey(hubPublicKey).toBuffer(),
                    new anchor.web3.PublicKey(authority.publicKey).toBuffer(),
                  ],
                  this.program.programId
                );
            
                await Hub.relatedQuery('collaborators')
                  .for(newHub.id)
                  .relate({
                    id: authority.id,
                    hubCollaboratorPublicKey: hubCollaborator.toBase58()
                  })
                  .onConflict(['hubId', 'accountId'])
                  .ignore();

                return { success: true, ids: { hubId: newHub.id }};
              } else {
                return { success: true, ids: { hubId: hub.id }};
              }
            } catch (error) {
              logTimestampedMessage(`HubInitWithCredit: Error processing transaction ${txid}: ${error.message}`);
              return { success: false };
            }
          case 'HubInit': {
            try {
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

                const [hubCollaborator] = await anchor.web3.PublicKey.findProgramAddress(
                  [
                    Buffer.from(anchor.utils.bytes.utf8.encode("nina-hub-collaborator")), 
                    new anchor.web3.PublicKey(hubPublicKey).toBuffer(),
                    new anchor.web3.PublicKey(authority.publicKey).toBuffer(),
                  ],
                  this.program.programId
                );
            
                await Hub.relatedQuery('collaborators')
                  .for(newHub.id)
                  .relate({
                    id: authority.id,
                    hubCollaboratorPublicKey: hubCollaborator.toBase58()
                  })
                  .onConflict(['hubId', 'accountId'])
                  .ignore();

                return { success: true, ids: { hubId: newHub.id }};
              } else {
                return { success: true, ids: { hubId: hub.id }};
              }
            } catch (error) {
              logTimestampedMessage(`HubInit: Error processing transaction ${txid}: ${error.message}`);
              return { success: false };
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
                let hub = await Hub.query().findOne({ publicKey: accounts[0].toBase58() });
                if (hub) {
                  hubPublicKey = accounts[0].toBase58();
                  releasePublicKey = accounts[1].toBase58();
                } else {
                  hub = await Hub.query().findOne({ publicKey: accounts[1].toBase58() });
                  if (hub) {
                    hubPublicKey = accounts[1].toBase58();
                    let release = await Release.query().findOne({ publicKey: accounts[2].toBase58() });
                    if (release) {
                      releasePublicKey = accounts[2].toBase58();
                    } else {
                      release = await Release.query().findOne({ publicKey: accounts[5].toBase58() });
                      if (release) {
                        releasePublicKey = accounts[5].toBase58();
                      } else {
                        throw new Error('cannot find release')
                      }
                    }
                  } else {
                      hub = await Hub.query().findOne({ publicKey: accounts[4].toBase58() });
                      if (hub) {
                        hubPublicKey = accounts[4].toBase58();
                        releasePublicKey = accounts[6].toBase58();
                      } else {
                        hub = await Hub.query().findOne({ publicKey: accounts[5].toBase58() });
                        if (hub) {
                          hubPublicKey = accounts[5].toBase58();
                          releasePublicKey = accounts[4].toBase58();
                        }
                      }
                  }
                }                  
              }
  
              const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                throw new Error(`Hub not found for HubAddRelease ${txid} with publicKey ${hubPublicKey}`);
              }
  
              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                throw new Error(`Release not found for HubAddRelease ${txid} with publicKey ${releasePublicKey}`);
              }
              
              const hubReleasePublicKey = await hubDataService.buildHubReleasePublicKey(hubPublicKey, releasePublicKey);
              await Hub.relatedQuery('releases')
                .for(hub.id)
                .relate({
                  id: release.id,
                  visible: true,
                  hubReleasePublicKey,
                })
                .onConflict(['hubId', 'releaseId'])
                .ignore();
    
              logTimestampedMessage(`Successfully processed HubAddRelease ${txid} for hub ${hubPublicKey} and release ${releasePublicKey}`);
              return {success: true, ids: { hubId: hub.id, releaseId: release.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing HubAddRelease for ${txid}: ${error.message}`);
              return { success: false };
            }
          }
          case 'HubAddCollaborator': {
            try {
              const hubPublicKey = this.isFileServicePayer(accounts) ?
                accounts[3].toBase58() : accounts[2].toBase58();
              const collaboratorPublicKey = this.isFileServicePayer(accounts) ?
                accounts[5].toBase58() : accounts[4].toBase58();
  
              const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                throw new Error(`Hub not found for HubAddCollaborator ${txid}`);
              }
  
              const collaborator = await Account.findOrCreate(collaboratorPublicKey);
              if (!collaborator) {
                throw new Error(`Could not create collaborator account for ${collaboratorPublicKey}`);
              }
              
              const [hubCollaborator] = await anchor.web3.PublicKey.findProgramAddress(
                [
                  Buffer.from(anchor.utils.bytes.utf8.encode("nina-hub-collaborator")), 
                  new anchor.web3.PublicKey(hubPublicKey).toBuffer(),
                  new anchor.web3.PublicKey(collaborator.publicKey).toBuffer(),
                ],
                this.program.programId
              );


              await Hub.relatedQuery('collaborators')
                .for(hub.id)
                .relate({
                  id: collaborator.id,
                  hubCollaboratorPublicKey: hubCollaborator.toBase58()
                })
                .onConflict(['hubId', 'accountId'])
                .ignore();
                
              logTimestampedMessage(`Successfully processed HubAddCollaborator ${txid} for hub ${hubPublicKey} and collaborator ${collaboratorPublicKey}`);
              return {success: true, ids: { hubId: hub.id, toAccountId: collaborator.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing HubAddCollaborator for ${txid}: ${error.message}`);
              return { success: false };
            }
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
                throw new Error(`Hub not found for HubWithdraw ${txid}`);
              }
              return {success: true, ids: { hubId: hub.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing HubWithdraw for ${txid}: ${error.message}`);
              return { success: false };
            }
          }
          case 'HubUpdateConfig': {
            try {
              let hub;
              try {
                if (accounts.length > 2) {
                  hub = await Hub.query().findOne({ publicKey: accounts[2].toBase58() });
                }
                if (!hub) {
                  hub = await Hub.query().findOne({ publicKey: accounts[1].toBase58() });
                }
              } catch (error) {
                throw new Error(`Hub not found for HubUpdateConfig ${txid}`);
              }

              if (!hub) {
                throw new Error(`Hub not found for HubUpdateConfig ${txid}`);
              }
              return {success: true, ids: { hubId: hub.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing HubUpdateConfig for ${txid}: ${error.message}`);
              return { success: false };
            }
          }
          case 'HubContentToggleVisibility': {
            try {
              console.log('HubContentToggleVisibility accounts', accounts);
              let hubPublicKey = accounts[1].toBase58();
              let contentPublicKey = accounts[3].toBase58();
              let hubContentPublicKey;
              let hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (hub) {
                hubContentPublicKey = accounts[2].toBase58();
              } else {
                hub = await Hub.query().findOne({ publicKey: accounts[4].toBase58() });
                if (hub) {
                  hubPublicKey = accounts[4].toBase58();
                  contentPublicKey = accounts[2].toBase58();
                } else {
                  hub = await Hub.query().findOne({ publicKey: accounts[2].toBase58() });
                  if (hub) {
                    hubPublicKey = accounts[2].toBase58();
                    contentPublicKey = accounts[4].toBase58();
                  } else {
                    throw new Error(`Hub not found for HubContentToggleVisibility ${txid}`);
                  }
                }
                hubContentPublicKey = await hubDataService.buildHubContentPublicKey(hubPublicKey, contentPublicKey);
              }
              console.log('hubContentPublicKey', hubContentPublicKey);
              console.log('contentPublicKey', contentPublicKey);
              console.log('hubPublicKey', hubPublicKey);
              const hubContent = await hubDataService.fetchHubContentAccountData(new anchor.web3.PublicKey(hubContentPublicKey));

              let content = await Release.query().findOne({ publicKey: contentPublicKey });
              let table = 'releases';
              if (!content) {
                content = await Post.query().findOne({ publicKey: contentPublicKey });
                table = 'posts';
              }

              if (!content) {
                throw new Error(`Content not found for HubContentToggleVisibility ${txid}`);
              }

              await Hub.relatedQuery(table)
                .for(hub.id)
                .patch({
                  visible: hubContent.visible,
                })
                .where( {id: content.id });

              logTimestampedMessage(`Successfully processed HubContentToggleVisibility ${txid} for hub ${hubPublicKey} and ${table} ${content}`);
                
              const response = {
                success: true,
                ids: {
                  hubId: hub.id,
                }
              }
              if (table === 'releases') {
                response.ids.releaseId = content.id;
              } else {
                response.ids.postId = content.id;
              }
              return response;
            } catch (error) {
              logTimestampedMessage(`Error processing HubContentToggleVisibility for ${txid}: ${error.message}`);
              return { success: false };
            }
          }
          case 'HubRemoveCollaborator': {
            try {
              console.log('HubRemoveCollaborator accounts', accounts);
              let collaboratorPublicKey = accounts[3].toBase58();
              let hubPublicKey = accounts[1].toBase58();

              let hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                hub = await Hub.query().findOne({ publicKey: accounts[2].toBase58() });
                if (hub) {
                  hubPublicKey = accounts[2].toBase58();
                  collaboratorPublicKey = accounts[4].toBase58();
                } else {
                  throw new Error(`Hub not found for HubAddCollaborator ${txid}`);
                }
              }
  
              const collaborator = await Account.findOrCreate(collaboratorPublicKey);
              if (!collaborator) {
                throw new Error(`Could not create collaborator account for ${collaboratorPublicKey}`);
              }

              await Hub.relatedQuery('collaborators')
                .for(hub.id)
                .unrelate()
                .where('id', collaborator.id);
              logTimestampedMessage(`Successfully processed HubRemoveCollaborator ${txid} for hub ${hubPublicKey} and collaborator ${collaboratorPublicKey}`);
              return {success: true, ids: { hubId: hub.id, toAccountId: collaborator.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing HubRemoveCollaborator for ${txid}: ${error.message}`);
              return { success: false };
            }
          }
          case 'HubUpdateCollaboratorPermissions': {
            try {
              let collaboratorPublicKey = accounts[3].toBase58();
              let hubPublicKey;
              let hub;
              if (accounts.length > 5) {
                hub = await Hub.query().findOne({ publicKey: accounts[5].toBase58() });
              }
              if (hub) {
                hubPublicKey = accounts[5].toBase58();
              } else {
                hub = await Hub.query().findOne({ publicKey: accounts[2].toBase58() });
                if (hub) {
                  hubPublicKey = accounts[2].toBase58();
                } else {
                   hub = await Hub.query().findOne({ publicKey: accounts[4].toBase58() });
                  if (hub) {
                    hubPublicKey = accounts[4].toBase58();
                  } else {
                    hub = await Hub.query().findOne({ publicKey: accounts[3].toBase58() });
                    if (hub) {
                      hubPublicKey = accounts[3].toBase58();
                      collaboratorPublicKey = accounts[5].toBase58();
                    } else {
                      throw new Error(`Hub not found for HubUpdateCollaboratorPermissions ${txid}`);
                    }
                  }
                }
              }

              if (!hub) {
                throw new Error(`Hub not found for HubUpdateCollaboratorPermissions ${txid}`);
              }

              const collaborator = await Account.findOrCreate(collaboratorPublicKey);
              if (!collaborator) {
                throw new Error(`Could not create collaborator account for ${collaboratorPublicKey}`);
              }

              return {success: true, ids: { hubId: hub.id, toAccountId: collaborator.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing HubUpdateCollaboratorPermissions for ${txid}: ${error.message}`);
              return { success: false };
            }
          }
        }  
      } catch (error) {
        logTimestampedMessage(`HubProcessor: Error processing transaction ${txid}: ${error.message}`);
      }
    }
}
  
export const hubProcessor = new HubProcessor();