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

      const authority = txInfo.transaction.message.accountKeys[0].pubkey.toBase58(); // determined by transaction type
      let authorityId = await this.getOrCreateAuthorityId(authority);

      transactionsToInsert.push({
        txid: txInfo.transaction.signatures[0],
        blocktime: txInfo.blockTime,
        type: this.determineTransactionType(txInfo),
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
    // todo add logic to determine transaction type
    return 'Unknown';
  }
}

export default new TransactionSyncer();