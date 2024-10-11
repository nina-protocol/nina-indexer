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

      const type = this.determineTransactionType(txInfo);
      const accounts = this.getRelevantAccounts(txInfo);
      let accountPublicKey = this.getAccountPublicKey(accounts, type);

      let authorityId = await this.getOrCreateAuthorityId(accountPublicKey);

      transactionsToInsert.push({
        txid: txInfo.transaction.signatures[0],
        blocktime: txInfo.blockTime,
        type: type,
        authorityId: authorityId,
         // more fields to come
      });
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
     // more tx to come

    return 'Unknown';
  }

  getRelevantAccounts(txInfo) {
    const ninaInstruction = txInfo.transaction.message.instructions.find(
      i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID
    );
    return ninaInstruction ? ninaInstruction.accounts : [];
  }

  getAccountPublicKey(accounts, type) {
    switch (type) {
      case 'ReleaseInitViaHub':
        return this.isFileServicePayer(accounts) ? accounts[18].toBase58() : accounts[0].toBase58();
      case 'ReleasePurchaseViaHub':
        return accounts[1].toBase58();
      case 'ReleasePurchase':
        return accounts[1].toBase58();
      // more tx to come
      default:
        return accounts[0].toBase58();
    }
  }

  isFileServicePayer(accounts) {
    const FILE_SERVICE_ADDRESS = '3skAZNf7EjUus6VNNgHog44JZFsp8BBaso9pBRgYntSd';
    return accounts[0].toBase58() === FILE_SERVICE_ADDRESS || accounts[0].toBase58() === accounts[1].toBase58();
  }
}

export default new TransactionSyncer();