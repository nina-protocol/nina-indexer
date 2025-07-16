import { logTimestampedMessage } from '../utils/logging.js';
import { callRpcMethodWithRetry, sleep } from '../utils/helpers.js';

class ReleaseDataService {
  constructor() {
    this.program = null;
  }

  async initialize(program, programV2) {
    this.program = program;
    this.programV2 = programV2;
  }

  async fetchReleaseAccountData(publicKey, programId=process.env.NINA_PROGRAM_ID) {
    let release
    let attempts = 0
    while (!release && attempts < 50) {
      try {
        const program = programId === process.env.NINA_PROGRAM_V2_ID ? this.programV2 : this.program;
        const programModelName = programId === process.env.NINA_PROGRAM_V2_ID ? 'releaseV2' : 'release';
        release = await callRpcMethodWithRetry(() => program.account[programModelName].fetch(publicKey), true)
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