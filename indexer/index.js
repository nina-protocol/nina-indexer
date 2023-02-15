import "dotenv/config.js";
import cron from 'node-cron';

import { initDb, config } from '@nina-protocol/nina-db';
import NinaProcessor from './processor.js';
import { environmentIsSetup } from "../scripts/env_check.js";

const startProcessing = async () => {
  console.log('Indexer Starting Up')
  await initDb(config)
  await NinaProcessor.init()
  console.log('Indexer Started - DB and Processor Initialized')

  if (process.env.RUN_INITIAL_SYNC === 'true') {
    console.log('Initial Sync starting')
    await NinaProcessor.runDbProcesses()
    await NinaProcessor.processCollectors()
    console.log('Initial Sync complete')
  }

  cron.schedule('* * * * *', async() => {
    console.log('Cron job starting: Sync Hubs + Releases');
    await NinaProcessor.runDbProcesses()
    console.log('Cron job ended: Sync Hubs + Releases');
  });
  
  cron.schedule('0 * * * *', async() => {
    console.log('Cron job starting: Sync Collectors');
    await NinaProcessor.processCollectors()
    console.log('Cron job ended: Sync Collectors');
  })
}

try {
  environmentIsSetup()
  startProcessing()
} catch (error) {
  console.error('Environment is not properly setup.  Check .env file and try again.')
  console.error(error)
}