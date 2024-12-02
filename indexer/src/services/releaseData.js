import { Release } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';

class ReleaseDataService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  async fetchReleaseData(publicKey) {
    try {
      const release = await Release.query().findOne({ publicKey });
      if (release) {
        return {
          metadata: release.metadata,
          uri: release.metadata?.uri || '',
          handle: release.metadata?.properties?.handle || ''
        };
      }
      return {
        metadata: {},
        uri: '',
        handle: ''
      };
    } catch (error) {
      logTimestampedMessage(`Error fetching release data for ${publicKey}: ${error.message}`);
      return {
        metadata: {},
        uri: '',
        handle: ''
      };
    }
  }
}

export const releaseDataService = new ReleaseDataService();