import { expect } from 'chai';
import NinaProcessor from '../indexer/processor.js';
import { Connection } from '@solana/web3.js';
import { Program } from '@project-serum/anchor';
import dotenv from 'dotenv';

dotenv.config();

describe('NinaProcessor', function() {
  this.timeout(10000);

  before(async function() {
    await NinaProcessor.initialize();
  });

  it('should initialize connection to a cluster', function() {
    expect(NinaProcessor.connection).to.be.instanceOf(Connection);
    expect(NinaProcessor.connection._rpcEndpoint).to.equal(process.env.SOLANA_CLUSTER_URL);
  });

  it('should connect to the program', function() {
    expect(NinaProcessor.program).to.be.instanceOf(Program);
    expect(NinaProcessor.program.programId.toBase58()).to.equal(process.env.NINA_PROGRAM_ID);
  });

  it('should get the latest blockhash', async function() {
    const { blockhash } = await NinaProcessor.connection.getLatestBlockhash();
    expect(blockhash).to.be.a('string');
    expect(blockhash).to.have.lengthOf(44); // Base58 encoded blockhash is always 44 characters
  });
});