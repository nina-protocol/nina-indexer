import { Connection, PublicKey } from '@solana/web3.js';
import { Transaction, Account, Release } from '@nina-protocol/nina-db';
import { releaseProcessor } from './processors/ReleaseProcessor.js';
import { hubProcessor } from './processors/HubProcessor.js';
import { logTimestampedMessage } from './utils/logging.js';
import { postsProcessor } from './processors/PostsProcessor.js';

class TransactionSyncer {
  constructor() {
    this.connection = new Connection(process.env.SOLANA_CLUSTER_URL);
    this.programId = new PublicKey(process.env.NINA_PROGRAM_ID);
    this.batchSize = 100;
  }

  async syncTransactions() {
    logTimestampedMessage('Starting transaction sync...');

    let lastSyncedSignature = await this.getLastSyncedSignature();
    let hasMore = true;
    let totalFetchedSignatures = 0;
    let totalInsertedTransactions = 0;
    let beforeSignature = null;

    while (hasMore) {
      const { signatures, hasMore: moreSignatures, beforeSignature: newBeforeSignature } =
        await this.fetchSignatures(lastSyncedSignature, beforeSignature);

      const fetchedCount = signatures.length;
      totalFetchedSignatures += fetchedCount;

      if (fetchedCount === 0) {
        hasMore = false;
        continue;
      }

      signatures.forEach(signatureInfo => {
        logTimestampedMessage(`Fetched signature ${signatureInfo.signature}`);
      });

      const insertedCount = await this.processAndInsertTransactions(signatures);
      totalInsertedTransactions += insertedCount;

      logTimestampedMessage(`Processed batch: fetched ${fetchedCount} signatures, inserted ${insertedCount} new transactions.`);

      if (!beforeSignature && signatures.length > 0) {
        lastSyncedSignature = signatures[0].signature; // The most recent signature
      }

      beforeSignature = newBeforeSignature;
      hasMore = moreSignatures;
    }

    logTimestampedMessage(`Transaction sync completed. Fetched ${totalFetchedSignatures} signatures, inserted ${totalInsertedTransactions} new transactions.`);
  }

  async getLastSyncedSignature() {
    const lastTransaction = await Transaction.query().orderBy('blocktime', 'desc').first();
    const lastSignature = lastTransaction ? lastTransaction.txid : null;
    logTimestampedMessage(`Last synced signature from DB: ${lastSignature}`);
    return lastSignature;
  }

  async fetchSignatures(lastSignature, beforeSignature = null) {
    const options = { limit: this.batchSize };
    if (beforeSignature) options.before = beforeSignature;

    const signatures = await this.connection.getSignaturesForAddress(this.programId, options);

    const newSignatures = [];
    let hasReachedLastSignature = false;

    for (const signatureInfo of signatures) {
      if (signatureInfo.signature === lastSignature) {
        hasReachedLastSignature = true;
        // logTimestampedMessage(`Reached last synced signature: ${lastSignature}`);
        break; // Stop processing when the last synced signature is reached
      }
      newSignatures.push(signatureInfo);
    }

    const newBeforeSignature = signatures.length > 0 ? signatures[signatures.length - 1].signature : null;

    return {
      signatures: newSignatures,
      hasMore: !hasReachedLastSignature && signatures.length === this.batchSize,
      beforeSignature: newBeforeSignature,
    };
  }

  async processAndInsertTransactions(signatures) {
    const txInfos = await this.connection.getParsedTransactions(
      signatures.map(sig => sig.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    const transactionsToInsert = [];
    const processorQueue = []; // Queue up processor tasks

    for (const txInfo of txInfos) {
      if (txInfo === null) continue;

      try {
        // Update accountPublicKey and type based on the new detection logic
        let type = this.determineTransactionType(txInfo);
        const accounts = this.getRelevantAccounts(txInfo);

        if (!accounts || accounts.length === 0) {
          logTimestampedMessage(`Warning: No relevant accounts found for transaction ${txInfo.transaction.signatures[0]}`);
          continue;
        }

        let { accountPublicKey, updatedType } = await this.getAccountPublicKey(accounts, type);
        type = updatedType;

        if (!accountPublicKey) {
          logTimestampedMessage(`Warning: Unable to determine account public key for transaction ${txInfo.transaction.signatures[0]}`);
          continue;
        }

        let authorityId = await this.getOrCreateAuthorityId(accountPublicKey);
        const txid = txInfo.transaction.signatures[0];

        // Prepare transaction record
        const transactionRecord = {
          txid,
          blocktime: txInfo.blockTime,
          type: type,
          authorityId: authorityId,
        };

        // logTimestampedMessage(`Processing transaction ${txInfo.transaction.signatures[0]} of type ${type}`);
        transactionsToInsert.push(transactionRecord);

        // Queue up processor task based on type
        processorQueue.push({
          type,
          txid,
          accounts,
          txInfo
        });

      } catch (error) {
        logTimestampedMessage(`Error processing transaction ${txInfo.transaction.signatures[0]}: ${error.message}`);
      }
    }

    if (transactionsToInsert.length > 0) {
      await Transaction.query().insert(transactionsToInsert).onConflict('txid').ignore();

      transactionsToInsert.forEach(tx => {
        logTimestampedMessage(`Inserted transaction ${tx.txid}`);
      });
      logTimestampedMessage(`Inserted ${transactionsToInsert.length} new transactions.`);

      // Process with domain processors
      for (const task of processorQueue) {
        try {
          if (releaseProcessor.canProcessTransaction(task.type)) {
            await releaseProcessor.processTransaction(task.txid);
          } else if (hubProcessor.canProcessTransaction(task.type)) {
            await hubProcessor.processTransaction(task.txid);
          } else if (postsProcessor.canProcessTransaction(task.type)) {
            await postsProcessor.processTransaction(task.txid);
          }
        } catch (error) {
          logTimestampedMessage(`Error in domain processing for ${task.txid}: ${error.message}`);
        }
      }

      logTimestampedMessage(`Inserted ${transactionsToInsert.length} new transactions.`);
      return transactionsToInsert.length;
    }
    return 0;  // Return 0 if no transactions were inserted
  }

  async getOrCreateAuthorityId(publicKey) {
    let account = await Account.query().where('publicKey', publicKey).first();
    if (!account) {
      account = await Account.query().insert({ publicKey });
      // logTimestampedMessage(`Created new account for public key: ${publicKey}`);
    }
    return account.id;
  }

  determineTransactionType(txInfo) {
    const logMessages = txInfo.meta.logMessages;

    if (logMessages.some(log => log.includes('ReleaseInitViaHub'))) return 'ReleaseInitViaHub';
    if (logMessages.some(log => log.includes('ReleasePurchaseViaHub'))) return 'ReleasePurchaseViaHub';
    if (logMessages.some(log => log.includes('ReleasePurchase'))) return 'ReleasePurchase';
    if (logMessages.some(log => log.includes('HubInitWithCredit'))) return 'HubInitWithCredit';
    if (logMessages.some(log => log.includes('ReleaseInitWithCredit'))) return 'ReleaseInitWithCredit';
    if (logMessages.some(log => log.includes('HubAddCollaborator'))) return 'HubAddCollaborator';
    if (logMessages.some(log => log.includes('HubAddRelease'))) return 'HubAddRelease';
    if (logMessages.some(log => log.includes('PostInitViaHubWithReferenceRelease'))) return 'PostInitViaHubWithReferenceRelease';
    if (logMessages.some(log => log.includes('PostInitViaHub'))) return 'PostInitViaHub';
    if (logMessages.some(log => log.includes('PostUpdateViaHubPost'))) return 'PostUpdateViaHubPost';
    if (logMessages.some(log => log.includes('SubscriptionSubscribeAccount'))) return 'SubscriptionSubscribeAccount';
    if (logMessages.some(log => log.includes('SubscriptionSubscribeHub'))) return 'SubscriptionSubscribeHub';
    if (logMessages.some(log => log.includes('SubscriptionUnsubscribe'))) return 'SubscriptionUnsubscribe';
    if (logMessages.some(log => log.includes('ReleaseClaim'))) return 'ReleaseClaim';
    if (logMessages.some(log => log.includes('HubInit'))) return 'HubInit';
    if (logMessages.some(log => log.includes('ReleaseInit'))) return 'ReleaseInit';
    if (logMessages.some(log => log.includes('ReleaseCloseEdition'))) return 'ReleaseCloseEdition';
    if (logMessages.some(log => log.includes('HubContentToggleVisibility'))) return 'HubContentToggleVisibility';
    if (logMessages.some(log => log.includes('HubRemoveCollaborator'))) return 'HubRemoveCollaborator';
    if (logMessages.some(log => log.includes('HubUpdateCollaboratorPermissions'))) return 'HubUpdateCollaboratorPermissions';
    if (logMessages.some(log => log.includes('HubUpdateConfig'))) return 'HubUpdateConfig';
    if (logMessages.some(log => log.includes('ReleaseRevenueShareCollectViaHub'))) return 'ReleaseRevenueShareCollectViaHub';
    if (logMessages.some(log => log.includes('ReleaseRevenueShareCollect'))) return 'ReleaseRevenueShareCollect';
    if (logMessages.some(log => log.includes('ReleaseRevenueShareTransfer'))) return 'ReleaseRevenueShareTransfer';
    if (logMessages.some(log => log.includes('ReleaseUpdateMetadata'))) return 'ReleaseUpdateMetadata';
    if (logMessages.some(log => log.includes('ExchangeInit'))) return 'ExchangeInit';
    if (logMessages.some(log => log.includes('ExchangeCancel'))) return 'ExchangeCancel';
    if (logMessages.some(log => log.includes('ExchangeAccept'))) return 'ExchangeAccept';
    if (logMessages.some(log => log.includes('HubWithdraw'))) return 'HubWithdraw';

    return 'Unknown';
  }

  getRelevantAccounts(txInfo) {
    let ninaInstruction = txInfo.transaction.message.instructions.find(
      i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID
    );

    if (!ninaInstruction) {
      if (txInfo.meta && txInfo.meta.innerInstructions) {
        for (let innerInstruction of txInfo.meta.innerInstructions) {
          for (let instruction of innerInstruction.instructions) {
            if (instruction.programId.toBase58() === process.env.NINA_PROGRAM_ID) {
              logTimestampedMessage('Found Nina instruction in inner instructions');
              ninaInstruction = instruction;
              break;
            }
          }
          if (ninaInstruction) break;
        }
      }
    }

    return ninaInstruction ? ninaInstruction.accounts : [];
  }

  async getAccountPublicKey(accounts, type) {
    if (!accounts || accounts.length === 0) {
      return { accountPublicKey: null, updatedType: type };
    }

    switch (type) {
      case 'ReleaseInitViaHub':
        return {
          accountPublicKey: this.isFileServicePayer(accounts) && accounts.length > 18 ? accounts[18].toBase58() : accounts[0].toBase58(),
          updatedType: type
        };
      case 'ReleasePurchaseViaHub':
      case 'ReleasePurchase':
        return {
          accountPublicKey: accounts.length > 1 ? accounts[1].toBase58() : null,
          updatedType: type
        };
      case 'HubInitWithCredit':
        return {
          accountPublicKey: accounts.length > 0 ? accounts[0].toBase58() : null,
          updatedType: type
        };
      case 'ReleaseInitWithCredit':
        return {
          accountPublicKey: accounts.length > 4 ? accounts[4].toBase58() : null,
          updatedType: type
        };
      case 'HubAddCollaborator':
      case 'HubAddRelease':
        if (this.isFileServicePayer(accounts)) {
          return {
            accountPublicKey: accounts.length > 1 ? accounts[1].toBase58() : null,
            updatedType: type
          };
        } else {
          return {
            accountPublicKey: accounts.length > 0 ? accounts[0].toBase58() : null,
            updatedType: type
          };
        }
      case 'PostInitViaHubWithReferenceRelease':
      case 'PostInitViaHub':
        if (this.isFileServicePayer(accounts)) {
          return {
            accountPublicKey: accounts.length > 8 ? accounts[8].toBase58() : null,
            updatedType: type
          };
        } else {
          return {
            accountPublicKey: accounts.length > 0 ? accounts[0].toBase58() : null,
            updatedType: type
          };
        }
      case 'PostUpdateViaHubPost':
        return {
          accountPublicKey: accounts.length > 1 ? accounts[1].toBase58() : null,
          updatedType: type
        };
      case 'SubscriptionSubscribeAccount':
      case 'SubscriptionSubscribeHub':
        return {
          accountPublicKey: accounts.length > 1 ? accounts[1].toBase58() : (accounts.length > 0 ? accounts[0].toBase58() : null),
          updatedType: type
        };
      case 'SubscriptionUnsubscribe':
        return {
          accountPublicKey: accounts.length > 1 ? accounts[1].toBase58() : null,
          updatedType: type
        };
      case 'ReleaseClaim':
        return {
          accountPublicKey: accounts.length > 3 ? accounts[3].toBase58() : null,
          updatedType: type
        };
      case 'HubInit':
        if (this.isFileServicePayer(accounts)) {
          return {
            accountPublicKey: accounts.length > 1 ? accounts[1].toBase58() : null,
            updatedType: type
          };
        } else {
          return {
            accountPublicKey: accounts.length > 0 ? accounts[0].toBase58() : null,
            updatedType: type
          };
        }
      case 'ReleaseInit':
        return {
          accountPublicKey: accounts.length > 4 ? accounts[4].toBase58() : null,
          updatedType: type
        };
      case 'ReleaseCloseEdition':
      case 'HubContentToggleVisibility':
      case 'HubRemoveCollaborator':
      case 'HubUpdateCollaboratorPermissions':
      case 'HubUpdateConfig':
      case 'ReleaseRevenueShareCollectViaHub':
      case 'ReleaseRevenueShareCollect':
      case 'ReleaseRevenueShareTransfer':
      case 'ReleaseUpdateMetadata':
      case 'HubWithdraw':
        if (this.isFileServicePayer(accounts)) {
          return {
            accountPublicKey: accounts.length > 1 ? accounts[1].toBase58() : null,
            updatedType: type
          };
        } else {
          return {
            accountPublicKey: accounts.length > 0 ? accounts[0].toBase58() : null,
            updatedType: type
          };
        }
      case 'ExchangeInit':
      case 'ExchangeCancel':
      case 'ExchangeAccept':
        return {
          accountPublicKey: accounts.length > 0 ? accounts[0].toBase58() : null,
          updatedType: type
        };
      default:
        // Special detection logic for to handle special case where accounts with length === 10
        if (accounts?.length === 10) {
          if (accounts[0].toBase58() === accounts[1].toBase58()) {
            try {
              const release = await Release.query().findOne({ publicKey: accounts[2].toBase58() });
              if (release) {
                return {
                  accountPublicKey: accounts[0].toBase58(),
                  updatedType: 'ReleasePurchase'
                };
              }
            } catch (error) {
              console.log(error);
            }
          } else if (accounts[3].toBase58() === accounts[4].toBase58()) {
            try {
              const release = await Release.query().findOne({ publicKey: accounts[0].toBase58() });
              if (release) {
                return {
                  accountPublicKey: accounts[3].toBase58(),
                  updatedType: 'ReleasePurchase'
                };
              }
            } catch (error) {
              console.log(error);
            }
          }
        }
        return {
          accountPublicKey: accounts.length > 0 ? accounts[0].toBase58() : null,
          updatedType: type
        };
    }
  }

  isFileServicePayer(accounts) {
    const FILE_SERVICE_ADDRESS = '3skAZNf7EjUus6VNNgHog44JZFsp8BBaso9pBRgYntSd';
    return accounts.length > 0 && (accounts[0].toBase58() === FILE_SERVICE_ADDRESS || (accounts.length > 1 && accounts[0].toBase58() === accounts[1].toBase58()));
  }
}

export default new TransactionSyncer();
