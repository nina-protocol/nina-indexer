import { expect } from 'chai';
import * as anchor from '@project-serum/anchor';
import processor from '../../indexer/processor.js';

describe('NinaProcessor Integration Tests', () => {
  describe('getSignatures()', () => {
    let connection;

    before(() => {
      connection = new anchor.web3.Connection(process.env.SOLANA_CLUSTER_URL);
    });

    const logTransactions = (title, transactions) => {
      console.log(`\n--- ${title} ---`);
      console.log(`Total transactions: ${transactions.length}`);
      console.log('First 5 transactions:');
      transactions.slice(0, 5).forEach(tx => {
        console.log(`Signature: ${tx.signature}, BlockTime: ${tx.blockTime}`);
      });
    };

    const compareResults = (processorResult, anchorResult) => {
      expect(processorResult.length).to.be.at.least(anchorResult.length);
      expect(processorResult.slice(0, anchorResult.length)).to.deep.equal(anchorResult);
    };

    it('should fetch signatures with no tx (initial run)', async () => {
      const result = await processor.getSignatures(connection);
      console.log('Processor Result Length:', result.length);

      const anchorResult = await connection.getSignaturesForAddress(
        new anchor.web3.PublicKey(process.env.NINA_PROGRAM_ID)
      );
      console.log('Direct Anchor Result Length:', anchorResult.length);

      logTransactions('Fetched Transactions', result);
      console.log('result:', result);
      console.log('Anchor Result:', anchorResult);
      compareResults(result, anchorResult);
    });
  });
});