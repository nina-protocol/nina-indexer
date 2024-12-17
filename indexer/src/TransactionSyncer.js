import { Connection, PublicKey } from '@solana/web3.js';
import { Transaction, Account, Release } from '@nina-protocol/nina-db';
import { releaseProcessor } from './processors/ReleaseProcessor.js';
import { hubProcessor } from './processors/HubProcessor.js';
import { logTimestampedMessage } from './utils/logging.js';
import { postsProcessor } from './processors/PostsProcessor.js';
import * as anchor from '@project-serum/anchor';
import { hubDataService } from './services/hubData.js';

export const FILE_SERVICE_ADDRESSES = ['3skAZNf7EjUus6VNNgHog44JZFsp8BBaso9pBRgYntSd', 'HQUtBQzt8d5ZtxAwfbPLE6TpBq68wJQ7ZaSjQDEn4Hz6']

class TransactionSyncer {
  constructor() {
    this.connection = new Connection(process.env.SOLANA_CLUSTER_URL);
    this.programId = new PublicKey(process.env.NINA_PROGRAM_ID);
    this.batchSize = 1000;
    this.provider = new anchor.AnchorProvider(this.connection, {}, { commitment: 'processed' });
    this.isSyncing = false;
  }

  async initialize() {
    this.program = await anchor.Program.at(this.programId, this.provider);
    await hubDataService.initialize(this.program);
    await releaseProcessor.initialize(this.program);
    await hubProcessor.initialize(this.program);
    await postsProcessor.initialize(this.program);
  }

  async syncTransactions() {
    try {
      if (this.isSyncing) {
        logTimestampedMessage('Transaction sync already in progress. Skipping.');
        return;
      }
      this.isSyncing = true;
      logTimestampedMessage('Starting transaction sync...');
  
      let lastSyncedSignature = await this.getLastSyncedSignature();
  
      let signatures = await this.fetchSignatures(lastSyncedSignature, undefined, lastSyncedSignature === null)
      if (signatures) {
        signatures = signatures.reverse();  

        signatures.forEach(signatureInfo => {
          logTimestampedMessage(`Fetched signature ${signatureInfo.signature} at blocktime ${signatureInfo.blockTime}`);
        });
    
        const insertedCount = await this.processAndInsertTransactions(signatures);
    
        logTimestampedMessage(`Transaction sync completed. Fetched ${signatures.length} signatures. Inserted ${insertedCount} new transactions.`);  
      } else {
        logTimestampedMessage('Unable to fetch signatures. Skipping sync.');
      }
    } catch (error) {
      logTimestampedMessage(`Error in syncTransactions: ${error.message}`);
    }
    this.isSyncing = false;
  }

  async getLastSyncedSignature() {
    const lastTransaction = await Transaction.query().orderBy('blocktime', 'desc').first();
    const lastSignature = lastTransaction ? lastTransaction.txid : null;
    logTimestampedMessage(`Last synced signature from DB: ${lastSignature}`);
    return lastSignature;
  }

  async fetchSignatures (tx=undefined, lastTx=undefined, isBefore=true, existingSignatures=[]) {
    console.log(`fetchSignatures: ${tx} ${isBefore} ${existingSignatures.length}`)
    try {
      const options = {}
      if (tx && isBefore) {
        options.before = tx
      } else if (!isBefore && tx) {
        options.until = tx
        if (lastTx) {
          options.before = lastTx
        }
      }
      console.log('options: ', options)
      const newSignatures = await this.connection.getSignaturesForAddress(this.programId, options)
      for (let i = 0; i < newSignatures.length; i ++) {
        console.log(`newSignatures[${i}]: ${newSignatures[i].signature} ${newSignatures[i].blockTime}`)
      }
      let signature
      if (isBefore) {
        signature = newSignatures.reduce((a, b) => a.blockTime < b.blockTime ? a : b)  
      } else if (tx) {
        signature = tx
        lastTx = newSignatures.reduce((a, b) => a.blockTime < b.blockTime ? a : b)  
      }
      console.log(newSignatures.reduce((a, b) => a.blockTime < b.blockTime ? a : b))
      if (newSignatures.length > 0) {
        existingSignatures.push(...newSignatures)
      }
      logTimestampedMessage(`Fetched ${existingSignatures.length} signatures.`);
      if (existingSignatures.length % this.batchSize === 0 && newSignatures.length > 0) {
        return await this.fetchSignatures(signature.signature || signature, lastTx?.signature, isBefore, existingSignatures)
      }
      return existingSignatures
    } catch (error) {
      console.warn (error)
    }
  }

  async processAndInsertTransactions(signatures) {
    const pages = []
    let totalInsertedCount = 0
    for (let i = 0; i < signatures.length; i += this.batchSize) {
      pages.push(signatures.slice(i, i + this.batchSize))
    }
    for await (const page of pages) {
      let pageInsertedCount = 0
      const pageNumber = pages.indexOf(page) + 1;
      logTimestampedMessage(`Processing page ${pageNumber} of ${pages.length}...`);
      const txInfos = await this.connection.getParsedTransactions(
        page.map(sig => sig.signature),
        { maxSupportedTransactionVersion: 0 }
      );

      const processorQueue = []; // Queue up processor tasks

      for await (const txInfo of txInfos) {
        try {
          const task = await this.buildProcessorTaskForTransaction(txInfo);
          if (task) {
            processorQueue.push(task);
          }
        } catch (error) {
          logTimestampedMessage(`❌ Error processing transaction ${txInfo.transaction.signatures[0]}: ${error.message}`);
        }
      }
  
      if (processorQueue.length > 0) {
        console.log('processorQueue', processorQueue.length)
        // Process with domain processors
        for (const task of processorQueue) {
          try {
            if (releaseProcessor.canProcessTransaction(task.type)) {
              const { ids, success } = await releaseProcessor.processTransaction(task);
              if (!success) {
                throw new Error(`Error processing ${task.type} transaction ${task.txid}`);
              }
              if (ids?.releaseId) task.transaction.releaseId = ids.releaseId;
              if (ids?.hubId) task.transaction.hubId = ids.hubId;
            } else if (hubProcessor.canProcessTransaction(task.type)) {
              const { ids, success } = await hubProcessor.processTransaction(task);
              if (!success) {
                throw new Error(`Error processing ${task.type} transaction ${task.txid}`);
              }
              if (ids?.releaseId) task.transaction.releaseId = ids.releaseId;
              if (ids?.hubId) task.transaction.hubId = ids.hubId;
              if (ids?.toAccountId) task.transaction.toAccountId = ids.toAccountId;
              if (ids?.postId) task.transaction.postId = ids.postId;
            } else if (postsProcessor.canProcessTransaction(task.type)) {
              const { ids, success } = await postsProcessor.processTransaction(task);
              if (!success) {
                throw new Error(`Error processing ${task.type} transaction ${task.txid}`);
              }
              if (ids?.hubId) task.transaction.hubId = ids.hubId;
              if (ids?.postId) task.transaction.postId = ids.postId;
              if (ids?.releaseId) task.transaction.releaseId = ids.releaseId;
            }

            await Transaction.query().insert(task.transaction).onConflict('txid').ignore();
            pageInsertedCount++;
            totalInsertedCount++;
            logTimestampedMessage(`Inserted transaction ${task.txid}`);
          } catch (error) {
            if (task.type === 'ReleaseInitWithCredit' && error.message.includes(`reading 'uri'`)) {
              logTimestampedMessage('Release in transaction has no metadata and is not a successfully completed release. Skipping...');
            } else {
              logTimestampedMessage(`❌ Error in domain processing for ${task.txid}: ${error.message}`);
            }
          }
        }
  
        logTimestampedMessage(`Inserted ${pageInsertedCount} new transactions.`);
        logTimestampedMessage(`Completed processing page ${pageNumber} of ${pages.length}...`);
      }
    }
    return totalInsertedCount;
  }

  async buildProcessorTaskForTransaction (txInfo) {
    try {
      if (txInfo === null) {
        throw new Error('No transaction info found');
      }
      if (txInfo.meta.err) {
        throw new Error (`Error in execution of transaction ${txInfo.transaction.signatures[0]}.  Skipping processing...`);
      }
      const txid = txInfo.transaction.signatures[0];
      let type = await this.determineTransactionType(txInfo);
      console.log(`txid: ${txid} type: ${type}`)
      const accounts = this.getRelevantAccounts(txInfo);
  
      if (!accounts || accounts.length === 0) {
        throw new Error(`Warning: No relevant accounts found for transaction ${txInfo.transaction.signatures[0]}`);
      }

      let accountPublicKey = await this.getAccountPublicKey(accounts, type, txInfo.meta.logMessages);

      if (!accountPublicKey) {
        throw new Error(`Warning: Unable to determine account public key for transaction ${txInfo.transaction.signatures[0]}`);
      }

      let authority = await Account.findOrCreate(accountPublicKey);

      // Prepare transaction record
      const transaction = {
        txid,
        blocktime: txInfo.blockTime,
        type,
        authorityId: authority.id,
      };

      const task = {
        type,
        txid,
        accounts,
        txInfo,
        transaction,
      }
      return task;
    } catch (error) {
      logTimestampedMessage(`Error building task for transaction: ${error.message}`);
    }
  }

  async handleDomainProcessingForSingleTransaction (txid) {
    try {
      const txInfo = await this.connection.getParsedTransaction(
        txid,
        { maxSupportedTransactionVersion: 0 }
      );
      const task = await this.buildProcessorTaskForTransaction(txInfo);
      if (releaseProcessor.canProcessTransaction(task.type)) {
        const { success } = await releaseProcessor.processTransaction(task);
        if (!success) {
          throw new Error(`Error processing ${task.type} transaction ${task.txid}`);
        }
      } else if (hubProcessor.canProcessTransaction(task.type)) {
        const { success } = await hubProcessor.processTransaction(task);
        if (!success) {
          throw new Error(`Error processing ${task.type} transaction ${task.txid}`);
        }
      } else if (postsProcessor.canProcessTransaction(task.type)) {
        const { success } = await postsProcessor.processTransaction(task);
        if (!success) {
          throw new Error(`Error processing ${task.type} transaction ${task.txid}`);
        }
      }
      return true
    } catch (error) {
      logTimestampedMessage(`Error in handleDomainProcessingForSingleTransaction: ${error.message}`);
      return false
    }
  }

  async determineTransactionType(txInfo) {
    const logMessages = txInfo.meta.logMessages;
    const accounts = this.getRelevantAccounts(txInfo);

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

    // Special detection logic for to handle special cases from before the type was printed in the logs
    try {
      if (accounts?.length === 10) {
        if (accounts[0].toBase58() === accounts[1].toBase58()) {
          const release = await this.program.account.release.fetch(accounts[2])
          if (release) return 'ReleasePurchase'
        } else if (accounts[3].toBase58() === accounts[4].toBase58()) {
          const release = await this.program.account.release.fetch(accounts[0])
          if (release) return 'ReleasePurchase'
        }
      } else if (accounts?.length === 18) {
        const release = await this.program.account.release.fetch(accounts[7])
        if (release) return 'ReleaseInitWithCredit'
      } else if (accounts?.length === 14) {
        let release;
        try {
          release = await this.program.account.release.fetch(accounts[0])
        } catch (error) {
          release = await this.program.account.release.fetch(accounts[3])
        }

        if (release) return 'ReleaseInitWithCredit'
      } else if (accounts?.length === 16) {
        const release = await this.program.account.release.fetch(accounts[5])
        if (release) return 'ReleaseInitWithCredit'
      } else if (accounts?.length === 13) {
        let release;
        try {
          release = await this.program.account.release.fetch(accounts[0])
          if (release) return 'ReleaseInitWithCredit'
        } catch (error) {
          release = await this.program.account.release.fetch(accounts[9])
          if (release) return 'ExchangeInit'
        }
      }
    } catch (error) {
      logTimestampedMessage(`error determining type in special case: ${error}`)
    }
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

  async getAccountPublicKey(accounts, type, logs) {
    try {
      switch (type) {
        case 'ReleaseInitViaHub':
          return this.isFileServicePayer(accounts) && accounts.length > 18 ? accounts[18].toBase58() : accounts[0].toBase58();
        case 'ReleasePurchaseViaHub':
        case 'ReleasePurchase':
          if (logs.some(log => log.includes('ReleasePurchase'))) {
            return accounts[1].toBase58();
          } else if (accounts?.length === 10) {
            if (accounts[0].toBase58() === accounts[1].toBase58()) {
              return accounts[0].toBase58();
            } else if (accounts[3].toBase58() === accounts[4].toBase58()) {
              return accounts[3].toBase58();
            }
          }
          return accounts[1].toBase58();
        case 'HubInitWithCredit':
          return accounts[0].toBase58();
        case 'ReleaseInitWithCredit':
          return accounts[3].toBase58();
        case 'HubAddCollaborator':
        case 'HubAddRelease':
          if (this.isFileServicePayer(accounts)) {
            return  accounts[1].toBase58();
          } else {
            return accounts[0].toBase58();
          }
        case 'PostInitViaHubWithReferenceRelease':
        case 'PostInitViaHub':
          if (this.isFileServicePayer(accounts)) {
            return  accounts[8].toBase58();
          } else {
            return accounts[0].toBase58();
          }
        case 'PostUpdateViaHubPost':
          return accounts[1].toBase58();
        case 'SubscriptionSubscribeAccount':
        case 'SubscriptionSubscribeHub':
          return accounts[1].toBase58();
        case 'SubscriptionUnsubscribe':
          return accounts[1].toBase58();
        case 'ReleaseClaim':
          return accounts[3].toBase58();
        case 'HubInit':
          if (this.isFileServicePayer(accounts)) {
            return accounts[1].toBase58();
          } else {
            return accounts[0].toBase58();
          }
        case 'ReleaseInit':
          return accounts[4].toBase58();
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
            return accounts[1].toBase58();
          } else {
            return accounts[0].toBase58();
          }
        case 'ExchangeInit':
        case 'ExchangeCancel':
        case 'ExchangeAccept':
          return accounts[0].toBase58();
        default:
          return accounts[0].toBase58();
      }  
    } catch (error) {
      logTimestampedMessage(`Error getting account public key: ${error.message}`);
    }
  }

  isFileServicePayer(accounts) {
    return FILE_SERVICE_ADDRESSES.includes(accounts[0].toBase58() || accounts[0].toBase58() === accounts[1].toBase58());
  }
}

export default new TransactionSyncer();