import axios from 'axios';
import { Release } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from './utils/logging.js';

class ReleaseSyncer {
  async syncReleases() {
    const restrictedReleases = await axios.get(`${process.env.ID_SERVER_ENDPOINT}/restricted`);
    const restrictedReleasesPublicKeys = restrictedReleases.data.restricted.map(x => x.value);

    const releasesToDelete = await Release.query().whereIn('publicKey', restrictedReleasesPublicKeys);
    
    for await (let release of releasesToDelete) {
      try {
        logTimestampedMessage('deleting restricted release:', release.publicKey)
        await Release.query().deleteById(release.id);
      } catch (error) {
        logTimestampedMessage('error deleting restricted release:', release.publicKey, error)
      }
    }

  }
}

export default new ReleaseSyncer();