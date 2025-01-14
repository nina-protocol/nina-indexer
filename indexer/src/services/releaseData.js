import { logTimestampedMessage } from '../utils/logging.js';
import { callRpcMethodWithRetry } from '../utils/helpers.js';
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
      release = await callRpcMethodWithRetry(() => this.program.account.release.fetch(publicKey))
      if (release) break;
      logTimestampedMessage('Release not found, retrying... - attempts: ', attempts)
      attempts++
    }
    return release
  }
}

export const releaseDataService = new ReleaseDataService();