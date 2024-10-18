import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider } from '@project-serum/anchor';
import {
  Account,
  Transaction
} from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';

class NinaProcessor {
  constructor() {
    this.connection = null;
    this.provider = null;
    this.program = null;
  }

  // initialize solana connection, anchor provider and nina program
  async initialize() {
    this.connection = new Connection(process.env.SOLANA_CLUSTER_URL);
    logTimestampedMessage('NinaProcessor initialized connection to cluster');
    this.provider = new AnchorProvider(
      this.connection,
      {},
      { commitment: 'confirmed' }
    );

    const programId = new PublicKey(process.env.NINA_PROGRAM_ID);
    this.program = await Program.at(programId, this.provider);
  }

  async processRecentTx() {
    logTimestampedMessage('Processing accounts and recent transactions...');

    const accounts = await Account.query();
    logTimestampedMessage(`Found ${accounts.length} accounts`);

    const recentTxs = await this.connection.getLatestBlockhash();
    logTimestampedMessage(`Recent blockhash: ${recentTxs.blockhash}`);
  }

  async transactionConsistencyCheck() {
    logTimestampedMessage('Starting transaction consistency check...');

    // Get the latest on-chain transactions
    const latestSignatures = await this.connection.getSignaturesForAddress(
      new PublicKey(process.env.NINA_PROGRAM_ID),
      { limit: 1000 } // Adjust this limit as needed
    );

    const onChainTxCount = latestSignatures.length;
    logTimestampedMessage(`Detected ${onChainTxCount} transactions on-chain`);

    // Get the latest transactions from the database
    const dbTxCount = await Transaction.query().count();
    logTimestampedMessage(`Found ${dbTxCount} transactions in the database`);

    // Process transactions in batches
    const batchSize = 100; // Adjust this value based on your needs
    for (let i = 0; i < latestSignatures.length; i += batchSize) {
      const batch = latestSignatures.slice(i, i + batchSize);
      await this.processTxBatch(batch);
    }

    logTimestampedMessage('Transaction consistency check completed');
  }

  async processTxBatch(signatures) {
    const txInfos = await this.connection.getParsedTransactions(
      signatures.map(sig => sig.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    for (const txInfo of txInfos) {
      if (txInfo) {
        await this.processSingleTx(txInfo);
      }
    }
  }

  async processSingleTx(txInfo) {
    // Extract relevant information from txInfo
    const txid = txInfo.transaction.signatures[0];
    const blocktime = txInfo.blockTime;

    // Check if the transaction already exists in the database
    const existingTx = await Transaction.query().where('txid', txid).first();

    if (!existingTx) {
      await Transaction.query().insert({
        txid,
        blocktime,
        // Add other fields as necessary
      });
      logTimestampedMessage(`Inserted new transaction: ${txid}`);
    }
  }
}

export default new NinaProcessor();