// BaseProcessor.js
import { logTimestampedMessage } from '../utils/logging.js';
import { Account, Hub, Release, Transaction } from '@nina-protocol/nina-db';
import axios from 'axios';

export class BaseProcessor {
  constructor() {
    this.FILE_SERVICE_ADDRESS = '3skAZNf7EjUus6VNNgHog44JZFsp8BBaso9pBRgYntSd';
  }

  isFileServicePayer(accounts) {
    return accounts[0].toBase58() === this.FILE_SERVICE_ADDRESS || 
           accounts[0].toBase58() === accounts[1].toBase58();
  }

  // Process a single transaction record
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

  // Add additional references to transaction record
  async updateTransactionReferences(transaction, refs) {
    try {
      const updates = {};

      if (refs.hubId) {
        updates.hubId = refs.hubId;
      }
      if (refs.releaseId) {
        updates.releaseId = refs.releaseId;
      }
      if (refs.toAccountId) {
        updates.toAccountId = refs.toAccountId;
      }
      if (refs.toHubId) {
        updates.toHubId = refs.toHubId;
      }

      if (Object.keys(updates).length > 0) {
        await Transaction.query()
          .patch(updates)
          .where('id', transaction.id);
      }
    } catch (error) {
      logTimestampedMessage(`Error updating transaction references: ${error.message}`);
    }
  }
}

export const baseProcessor = new BaseProcessor();