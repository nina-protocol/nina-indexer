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
    return await callRpcMethodWithRetry(() => this.program.account.release.fetch(publicKey))
  }
}

export const releaseDataService = new ReleaseDataService();