import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider } from '@project-serum/anchor';
import {
  Account
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
}

export default new NinaProcessor();