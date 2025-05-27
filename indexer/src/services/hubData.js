import { PublicKey } from '@solana/web3.js';
import { decode, callRpcMethodWithRetry, logTimestampedMessage, sleep } from '../utils/index.js';
import axios from 'axios';

const ensureHttps = (uri) => {
  if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
    return `https://${uri}`;
  }
  return uri;
};

class HubDataService {
  constructor() {
    this.program = null;
  }

  async initialize(program) {
    this.program = program;
  }

  async fetchHubAccountData(publicKey) {
    let hub;
    let attempts = 0;
    while (!hub && attempts < 50) {
      try {
        hub = await callRpcMethodWithRetry(() => this.program.account.hub.fetch(publicKey));
        if (hub) break;
      } catch (error) {
        logTimestampedMessage('Hub not found, retrying... - attempts: ', attempts);
        attempts++;
        await sleep(1000);
      }
    }
    return hub;
  }

  async fetchHubContentAccountData(publicKey) {
    let hubContent;
    let attempts = 0;
    while (!hubContent && attempts < 50) {
      try {
        hubContent = await callRpcMethodWithRetry(() => this.program.account.hubContent.fetch(publicKey));
        if (hubContent) break;
      } catch (error) {
        logTimestampedMessage('Hub content not found, retrying... - attempts: ', attempts);
        attempts++;
        await sleep(1000);  
      }
    }
    return hubContent;
  }
  

  async fetchHubData(hubPublicKey) {
    try {
      console.log('fetchHubData', hubPublicKey);
      const hubAccount = await this.fetchHubAccountData(hubPublicKey);

      const uri = typeof hubAccount.uri === 'string' ?
        hubAccount.uri :
        decode(hubAccount.uri);

      let metadata;
      try {
        const response = await axios.get(ensureHttps(uri.replace('www.', '').replace('arweave.net', 'gateway.irys.xyz')));
        metadata = response.data;
      } catch (error) {
        const response = await axios.get(ensureHttps(uri.replace('gateway.irys.xyz', 'arweave.net')));
        metadata = response.data;
      }

      return {
        handle: decode(hubAccount.handle),
        metadata,
        uri,
        datetime: new Date(hubAccount.datetime.toNumber() * 1000).toISOString()
      };
    } catch (error) {
      logTimestampedMessage(`Error fetching hub data for ${hubPublicKey}: ${error.message}`);
      throw error;
    }
  }

  async getHubContent(hubPublicKey, contentAccount) {
    try {
      await this.initialize();

      const [hubContentPublicKey] = await PublicKey.findProgramAddress(
        [
          Buffer.from('nina-hub-content'),
          new PublicKey(hubPublicKey).toBuffer(),
          new PublicKey(contentAccount).toBuffer(),
        ],
        this.program.programId
      );

      const hubContent = await this.fetchHubContentAccountData(hubContentPublicKey);
      return hubContent;
    } catch (error) {
      logTimestampedMessage(`Error fetching hub content for ${hubPublicKey}: ${error.message}`);
      throw error;
    }
  }

  async getHubContents(hubPublicKey, contentAccounts) {
    try {
      await this.initialize();

      const hubContentPromises = contentAccounts.map(async (contentAccount) => {
        const [hubContentPublicKey] = await PublicKey.findProgramAddress(
          [
            Buffer.from('nina-hub-content'),
            new PublicKey(hubPublicKey).toBuffer(),
            contentAccount.toBuffer()
          ],
          this.program.programId
        );

        return this.fetchHubContentAccountData(hubContentPublicKey);
      });

      return Promise.all(hubContentPromises);

    } catch (error) {
      logTimestampedMessage(`Error fetching hub contents for ${hubPublicKey}: ${error.message}`);
      throw error;
    }
  }
  async buildHubReleasePublicKey(hubPublicKey, releasePublicKey) {
    const [hubReleasePublicKey] = await PublicKey.findProgramAddress(
      [
        Buffer.from('nina-hub-release'),
        new PublicKey(hubPublicKey).toBuffer(),
        new PublicKey(releasePublicKey).toBuffer()
      ],
      this.program.programId
    );

    return hubReleasePublicKey.toBase58();
  }  

  async buildHubPostPublicKey(hubPublicKey, postPublicKey) {
    const [hubPostPublicKey] = await PublicKey.findProgramAddress(
      [
        Buffer.from('nina-hub-release'),
        new PublicKey(hubPublicKey).toBuffer(),
        new PublicKey(postPublicKey).toBuffer()
      ],
      this.program.programId
    );

    return hubPostPublicKey.toBase58();
  }  


  async buildHubContentPublicKey(hubPublicKey, contentAccount) {
    const [hubContentPublicKey] = await PublicKey.findProgramAddress(
      [
        Buffer.from('nina-hub-content'),
        new PublicKey(hubPublicKey).toBuffer(),
        new PublicKey(contentAccount).toBuffer()
      ],
      this.program.programId
    );

    return hubContentPublicKey.toBase58();
  }
}

export const hubDataService = new HubDataService();