import { logTimestampedMessage } from '../utils/logging.js';
import { callRpcMethodWithRetry, sleep } from '../utils/helpers.js';

class ReleaseDataService {
  constructor() {
    this.program = null;
  }

  async initialize(program) {
    this.program = program;
  }

  async fetchReleaseAccountData(publicKey) {
    let release
    let attempts = 0
    while (!release && attempts < 50) {
      try {
        release = await callRpcMethodWithRetry(() => this.program.account.release.fetch(publicKey), true)
        console.log('fetchReleaseAccountData release:', release)
        if (release?.authority) break;
      } catch (error) {
        logTimestampedMessage('Release not found, retrying... - attempts: ', attempts)
        attempts++
        await sleep(1000)
      }
    }
    return release
  }
}

export const releaseDataService = new ReleaseDataService();