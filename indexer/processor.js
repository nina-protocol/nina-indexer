import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider } from '@project-serum/anchor';
import {
  Account
} from '@nina-protocol/nina-db';

class Processor {
  constructor() {
    this.connection = null;
    this.provider = null;
    this.program = null;
  }

  // initialize solana connection, anchor provider and nina program
  async initialize() {
    this.connection = new Connection(process.env.SOLANA_CLUSTER_URL);

    this.provider = new AnchorProvider(
      this.connection,
      {},
      { commitment: 'confirmed' }
    );

    const programId = new PublicKey(process.env.NINA_PROGRAM_ID);
    this.program = await Program.at(programId, this.provider);
  }

  async processTransactions() {
    console.log('Processing accounts and recent transcations...');

    const accounts = await Account.query();
    console.log(`Found ${accounts.length} accounts`);

    const recentTxs = await this.connection.getRecentBlockhash();
    console.log('Recent blockhash:', recentTxs.blockhash);
  }
}

export default new Processor();