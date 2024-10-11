import { Connection, PublicKey } from '@solana/web3.js';
import { Transaction, Account } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';

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

    while (hasMore) {
      const { signatures, newLastSignature } = await this.fetchSignatures(lastSyncedSignature);
      
      if (signatures.length === 0) {
        hasMore = false;
        continue;
      }

      await this.processAndInsertTransactions(signatures);

      lastSyncedSignature = newLastSignature;
    }

    logTimestampedMessage('Transaction sync completed');
  }

  async getLastSyncedSignature() {
    const lastTransaction = await Transaction.query().orderBy('blocktime', 'desc').first();
    return lastTransaction ? lastTransaction.txid : null;
  }

  async fetchSignatures(lastSignature) {
    const options = {
      limit: this.batchSize,
    };

    if (lastSignature) {
      options.until = lastSignature;
    }

    const signatures = await this.connection.getSignaturesForAddress(this.programId, options);
    const newLastSignature = signatures.length > 0 ? signatures[signatures.length - 1].signature : null;

    return { signatures, newLastSignature };
  }

  async processAndInsertTransactions(signatures) {
    const txInfos = await this.connection.getParsedTransactions(
      signatures.map(sig => sig.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    const transactionsToInsert = [];

    for (const txInfo of txInfos) {
      if (txInfo === null) continue;

      try {
        const type = this.determineTransactionType(txInfo);
        const accounts = this.getRelevantAccounts(txInfo);

        if (!accounts || accounts.length === 0) {
          logTimestampedMessage(`Warning: No relevant accounts found for transaction ${txInfo.transaction.signatures[0]}`);
          continue;
        }

        let accountPublicKey = this.getAccountPublicKey(accounts, type);

        if (!accountPublicKey) {
          logTimestampedMessage(`Warning: Unable to determine account public key for transaction ${txInfo.transaction.signatures[0]}`);
          continue;
        }

        let authorityId = await this.getOrCreateAuthorityId(accountPublicKey);

        transactionsToInsert.push({
          txid: txInfo.transaction.signatures[0],
          blocktime: txInfo.blockTime,
          type: type,
          authorityId: authorityId,
        });
      } catch (error) {
        logTimestampedMessage(`Error processing transaction ${txInfo.transaction.signatures[0]}: ${error.message}`);
      }
    }

    if (transactionsToInsert.length > 0) {
      await Transaction.query().insert(transactionsToInsert);
      logTimestampedMessage(`Inserted ${transactionsToInsert.length} new transactions`);
    }
  }

  async getOrCreateAuthorityId(publicKey) {
    let account = await Account.query().where('publicKey', publicKey).first();
    if (!account) {
      account = await Account.query().insert({ publicKey });
      logTimestampedMessage(`Created new account for ${publicKey}`);
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
    const ninaInstruction = txInfo.transaction.message.instructions.find(
      i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID
    );
    return ninaInstruction ? ninaInstruction.accounts : [];
  }

  getAccountPublicKey(accounts, type) {
    if (!accounts || accounts.length === 0) {
      return null;
    }

    switch (type) {
      case 'ReleaseInitViaHub':
        return this.isFileServicePayer(accounts) && accounts.length > 18 ? accounts[18].toBase58() : accounts[0].toBase58();
      case 'ReleasePurchaseViaHub':
        return accounts.length > 1 ? accounts[1].toBase58() : null;
      case 'ReleasePurchase':
        return accounts.length > 1 ? accounts[1].toBase58() : null;
      case 'HubInitWithCredit':
        return accounts.length > 0 ? accounts[0].toBase58() : null;
      case 'ReleaseInitWithCredit':
        return accounts.length > 4 ? accounts[4].toBase58() : null;
      case 'HubAddCollaborator':
        if (this.isFileServicePayer(accounts)) {
          return accounts.length > 1 ? accounts[1].toBase58() : null;
        } else {
          return accounts.length > 0 ? accounts[0].toBase58() : null;
        }
      case 'HubAddRelease':
        if (this.isFileServicePayer(accounts)) {
          return accounts.length > 1 ? accounts[1].toBase58() : null;
        } else {
          return accounts.length > 0 ? accounts[0].toBase58() : null;
        }
      case 'PostInitViaHubWithReferenceRelease':
      case 'PostInitViaHub':
        if (this.isFileServicePayer(accounts)) {
          return accounts.length > 8 ? accounts[8].toBase58() : null;
        } else {
          return accounts.length > 0 ? accounts[0].toBase58() : null;
        }
      case 'PostUpdateViaHubPost':
        return accounts.length > 1 ? accounts[1].toBase58() : null;
      case 'SubscriptionSubscribeAccount':
      case 'SubscriptionSubscribeHub':
        return accounts.length > 1 ? accounts[1].toBase58() : (accounts.length > 0 ? accounts[0].toBase58() : null);
      case 'SubscriptionUnsubscribe':
        return accounts.length > 1 ? accounts[1].toBase58() : null;
      case 'ReleaseClaim':
        return accounts.length > 3 ? accounts[3].toBase58() : null;
      case 'HubInit':
        if (this.isFileServicePayer(accounts)) {
          return accounts.length > 1 ? accounts[1].toBase58() : null;
        } else {
          return accounts.length > 0 ? accounts[0].toBase58() : null;
        }
      case 'ReleaseInit':
        return accounts.length > 4 ? accounts[4].toBase58() : null;
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
          return accounts.length > 1 ? accounts[1].toBase58() : null;
        } else {
          return accounts.length > 0 ? accounts[0].toBase58() : null;
        }
      case 'ExchangeInit':
      case 'ExchangeCancel':
      case 'ExchangeAccept':
        return accounts.length > 0 ? accounts[0].toBase58() : null;
      default:
        return accounts.length > 0 ? accounts[0].toBase58() : null;
    }
  }

  isFileServicePayer(accounts) {
    const FILE_SERVICE_ADDRESS = '3skAZNf7EjUus6VNNgHog44JZFsp8BBaso9pBRgYntSd';
    return accounts.length > 0 && (accounts[0].toBase58() === FILE_SERVICE_ADDRESS || (accounts.length > 1 && accounts[0].toBase58() === accounts[1].toBase58()));
  }
}

export default new TransactionSyncer();