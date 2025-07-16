import { Connection, PublicKey } from '@solana/web3.js';
import { Transaction, Account, Release } from '@nina-protocol/nina-db';
import * as anchor from '@project-serum/anchor';
import * as anchorCoral from '@coral-xyz/anchor';
import { releaseProcessor } from './processors/ReleaseProcessor.js';
import { hubProcessor } from './processors/HubProcessor.js';
import { logTimestampedMessage } from './utils/logging.js';
import { postsProcessor } from './processors/PostsProcessor.js';
import { hubDataService } from './services/hubData.js';
import { releaseDataService } from './services/releaseData.js';
import { callRpcMethodWithRetry, sleep } from './utils/index.js';

export const FILE_SERVICE_ADDRESSES = ['3skAZNf7EjUus6VNNgHog44JZFsp8BBaso9pBRgYntSd', 'HQUtBQzt8d5ZtxAwfbPLE6TpBq68wJQ7ZaSjQDEn4Hz6']

class TransactionSyncer {
  constructor() {
    this.connection = new Connection(process.env.SOLANA_CLUSTER_URL);
    this.programId = new PublicKey(process.env.NINA_PROGRAM_ID);
    console.log('this.programId', this.programId)
    this.programV2Id = new PublicKey(process.env.NINA_PROGRAM_V2_ID);
    console.log('this.programV2Id', this.programV2Id)
    this.batchSize = 200;
    this.provider = new anchor.AnchorProvider(this.connection, {}, { commitment: 'confirmed' });
    this.isSyncing = false;
  }

  async initialize() {
    this.program = await anchor.Program.at(this.programId, this.provider);
    console.log('this.program', this.program.programId.toBase58())
    this.programV2 = await anchorCoral.Program.at(this.programV2Id, this.provider);
    console.log('this.programV2', this.programV2.programId.toBase58())
    await hubDataService.initialize(this.program);
    await releaseProcessor.initialize(this.program, this.programV2);
    await hubProcessor.initialize(this.program);
    await postsProcessor.initialize(this.program);
    await releaseDataService.initialize(this.program, this.programV2);
  }

  async syncTransactions() {
    try {
      if (this.isSyncing) {
        logTimestampedMessage('Transaction sync already in progress. Skipping.');
        return;
      }
      this.isSyncing = true;
      logTimestampedMessage('Starting transaction sync...');
  
      let { lastSignatureV1, lastSignatureV2 } = await this.getLastSyncedSignature();
      let signaturesV1 = await this.fetchSignatures(this.programId, lastSignatureV1, undefined, lastSignatureV1 === null)
      let signaturesV2 = await this.fetchSignatures(this.programV2Id, lastSignatureV2, undefined, lastSignatureV2 === null)

      if (signaturesV1) {
        signaturesV1 = signaturesV1.reverse();  

        signaturesV1.forEach(signatureInfo => {
          logTimestampedMessage(`Fetched signature ${signatureInfo.signature} at blocktime ${signatureInfo.blockTime}`);
        });
    
        const insertedCount = await this.processAndInsertTransactions(signaturesV1);
    
        logTimestampedMessage(`Transaction V1 sync completed. Fetched ${signaturesV1.length} signatures. Inserted ${insertedCount} new transactions.`);  
      } else {
        logTimestampedMessage('Unable to fetch V1signatures. Skipping sync.');
      }

      if (signaturesV2) {
        signaturesV2 = signaturesV2.reverse();  

        signaturesV2.forEach(signatureInfo => {
          logTimestampedMessage(`Fetched signature ${signatureInfo.signature} at blocktime ${signatureInfo.blockTime}`);
        });

        const insertedCount = await this.processAndInsertTransactions(signaturesV2);

        logTimestampedMessage(`Transaction V2 sync completed. Fetched ${signaturesV2.length} signatures. Inserted ${insertedCount} new transactions.`);  
      } else {
        logTimestampedMessage('Unable to fetch V2 signatures. Skipping sync.');
      }
    } catch (error) {
      logTimestampedMessage(`Error in syncTransactions: ${error.message}`);
    }
    this.isSyncing = false;
  }

  async getLastSyncedSignature() {
    const lastTransactionV1 = await Transaction.query().where('programId', process.env.NINA_PROGRAM_ID).orderBy('blocktime', 'desc').first();
    const lastTransactionV2 = await Transaction.query().where('programId', process.env.NINA_PROGRAM_V2_ID).orderBy('blocktime', 'desc').first();
    const lastSignatureV1 = lastTransactionV1 ? lastTransactionV1.txid : null;
    const lastSignatureV2 = lastTransactionV2 ? lastTransactionV2.txid : null;
    logTimestampedMessage(`Last synced signature from DB: v1: ${lastSignatureV1} v2: ${lastSignatureV2}`);
    return {lastSignatureV1, lastSignatureV2};
  }

  async fetchSignatures (programId, tx=undefined, lastTx=undefined, isBefore=true, existingSignatures=[]) {
    console.log(`fetchSignatures for programId: ${programId.toBase58()} tx: ${tx} isBefore: ${isBefore} existingSignatures: ${existingSignatures.length}`)
    
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
      const newSignatures = await callRpcMethodWithRetry(() => this.connection.getSignaturesForAddress(programId, options))
      for (let i = 0; i < newSignatures.length; i ++) {
        console.log(`newSignatures[${i}]: ${newSignatures[i].signature} ${newSignatures[i].blockTime}`)
      }

      if (newSignatures.length > 0) {
        let signature
        if (isBefore) {
          signature = newSignatures.reduce((a, b) => a.blockTime < b.blockTime ? a : b)  
        } else if (tx) {
          signature = tx
          lastTx = newSignatures.reduce((a, b) => a.blockTime < b.blockTime ? a : b)  
        }  
        existingSignatures.push(...newSignatures)
        logTimestampedMessage(`Fetched ${existingSignatures.length} signatures.`);
        if (existingSignatures.length % this.batchSize === 0) {
          return await this.fetchSignatures(programId, signature.signature || signature, lastTx?.signature, isBefore, existingSignatures)
        }  
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
      ).catch(error => {
        console.warn(`Error this.connection.getParsedTransactions: ${error.message}`);
        return [];
      });

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
              logTimestampedMessage(`❌ Error in domain processing for ${task.txid} ${task.type}: ${error.message}`);
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
      const accounts = this.getRelevantAccounts(txInfo);
      console.log('txInfo', txInfo)
      console.log('accounts', accounts)
      let programId = txInfo.meta.logMessages.some(log => log.includes(process.env.NINA_PROGRAM_V2_ID)) ? process.env.NINA_PROGRAM_V2_ID : null;
      if (!programId) {
        programId = txInfo.meta.logMessages.some(log => log.includes(process.env.NINA_PROGRAM_ID)) ? process.env.NINA_PROGRAM_ID : null;
      }
      if (!programId) {
        throw new Error(`Warning: Unable to determine program ID for transaction ${txInfo.transaction.signatures[0]}`);
      }

      if (!accounts || accounts.length === 0) {
        throw new Error(`Warning: No relevant accounts found for transaction ${txInfo.transaction.signatures[0]}`);
      }

      let accountPublicKey = await this.getAccountPublicKey(accounts, type, txInfo.meta.logMessages, programId);

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
        programId,
      };

      const task = {
        type,
        txid,
        accounts,
        txInfo,
        transaction,
        programId,
      }
      return task;
    } catch (error) {
      logTimestampedMessage(`Error building task for transaction: ${error.message}`);
    }
  }

  async handleDomainProcessingForSingleTransaction (txid) {
    try {
      let txInfo
      let attempts = 0
      while (!txInfo && attempts < 60) {
        txInfo = await callRpcMethodWithRetry(() => this.connection.getParsedTransaction(
          txid,
          { maxSupportedTransactionVersion: 0 }
        ), true);
        if (txInfo) break;
        console.log('handleDomainProcessingForSingleTransaction getParsedTransaction failure - attempts:', attempts)
        attempts++;
        await sleep(1000);
      }

      console.log('handleDomainProcessingForSingleTransaction txInfo', txInfo)
      const task = await this.buildProcessorTaskForTransaction(txInfo);
      console.log('task', task)
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

    if (logMessages.some(log => log.includes('ReleaseInitV2'))) return 'ReleaseInitV2';
    if (logMessages.some(log => log.includes('ReleaseUpdate'))) return 'ReleaseUpdate';
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
      i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID || i.programId.toBase58() === process.env.NINA_PROGRAM_V2_ID
    );

    if (!ninaInstruction) {
      if (txInfo.meta && txInfo.meta.innerInstructions) {
        for (let innerInstruction of txInfo.meta.innerInstructions) {
          for (let instruction of innerInstruction.instructions) {
            if (instruction.programId.toBase58() === process.env.NINA_PROGRAM_ID || instruction.programId.toBase58() === process.env.NINA_PROGRAM_V2_ID) {
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

  async getAccountPublicKey(accounts, type, logs, programId = process.env.NINA_PROGRAM_ID) {
    try {
      switch (type) {
        case 'ReleaseInitV2':
          console.log('ReleaseInitV2 accounts', accounts)
          return accounts[1].toBase58();
        case 'ReleaseUpdate':
          console.log('ReleaseUpdate accounts', accounts)
          return accounts[1].toBase58();
        case 'ReleaseInitViaHub':
          return this.isFileServicePayer(accounts) && accounts.length > 18 ? accounts[18].toBase58() : accounts[0].toBase58();
        case 'ReleasePurchaseViaHub':
        case 'ReleasePurchase':
          if (programId === process.env.NINA_PROGRAM_V2_ID) {
            return accounts[1].toBase58();
          } else if (logs.some(log => log.includes('ReleasePurchase'))) {
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
          if (programId === process.env.NINA_PROGRAM_V2_ID) {
            return accounts[2].toBase58();
          } else {
            return accounts[4].toBase58();
          }
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
