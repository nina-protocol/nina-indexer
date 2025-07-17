// BaseProcessor.js
import { Connection } from '@solana/web3.js';
import { logTimestampedMessage } from '../../utils/logging.js';
import { Transaction } from '@nina-protocol/nina-db';
import axios from 'axios';
import { FILE_SERVICE_ADDRESSES } from '../../TransactionSyncer.js';
export class BaseProcessor {
  constructor() {
  }
  
  async initialize(program, programV2) {
    this.program = program;
    this.programV2 = programV2;
  }
  
  isFileServicePayer(accounts) {
    return FILE_SERVICE_ADDRESSES.includes(accounts[0].toBase58()) || accounts[0].toBase58() === accounts[1].toBase58();
  }

  // REMOVE THIS FUNCTION
  async processTransactionRecord(txid) {
    const transaction = await Transaction.query().findOne({ txid });
    if (!transaction) {
      logTimestampedMessage(`No transaction found for txid: ${txid}`);
      return null;
    }

    // Get the on-chain transaction data
    const connection = new Connection(process.env.SOLANA_CLUSTER_URL);
    const txInfo = await connection.getParsedTransaction(txid, {
      maxSupportedTransactionVersion: 0
    });

    if (!txInfo) {
      logTimestampedMessage(`No on-chain transaction found for txid: ${txid}`);
      return null;
    }

    const accounts = this.getRelevantAccounts(txInfo);
    if (!accounts || accounts.length === 0) {
      logTimestampedMessage(`No relevant accounts found for transaction ${txid}`);
      return null;
    }

    return {
      transaction,
      accounts,
      txInfo
    };
  }

  // Get relevant accounts from transaction
  getRelevantAccounts(txInfo) {
    let ninaInstruction = txInfo.transaction.message.instructions.find(
      i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID
    );

    if (!ninaInstruction && txInfo.meta?.innerInstructions) {
      for (let innerInstruction of txInfo.meta.innerInstructions) {
        for (let instruction of innerInstruction.instructions) {
          if (instruction.programId.toBase58() === process.env.NINA_PROGRAM_ID) {
            ninaInstruction = instruction;
            break;
          }
        }
        if (ninaInstruction) break;
      }
    }
    console.log('ninaInstruction', ninaInstruction);
    return ninaInstruction ? ninaInstruction.accounts : [];
  }

  async getRestrictedReleases() {
    try {
      const response = await axios.get(`${process.env.ID_SERVER_ENDPOINT}/restricted`);
      return response.data.restricted.map(x => x.value);
    } catch (error) {
      logTimestampedMessage(`Error fetching restricted releases: ${error.message}`);
      return [];
    }
  }
}

export const baseProcessor = new BaseProcessor();