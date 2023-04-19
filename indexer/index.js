import "dotenv/config.js";
import cron from 'node-cron';
import os from 'os';
import v8 from 'node:v8';

import { initDb, config } from '@nina-protocol/nina-db';
import NinaProcessor from './processor.js';
import { environmentIsSetup } from "../scripts/env_check.js";

const arg = process.argv.slice()

const startProcessing = async () => {
  console.log(`${new Date()} Indexer Starting Up`)
  await initDb(config)
  await NinaProcessor.init()
  console.log('Indexer Started - DB and Processor Initialized')

  console.log('Initial Sync starting')
  await NinaProcessor.runDbProcesses()
  if (process.env.RUN_INITIAL_SYNC === 'true') {
    await NinaProcessor.processCollectors()
  }
  console.log('Initial Sync complete')

  cron.schedule('* * * * *', async() => {
    console.log(`${new Date()} Cron job starting: Sync Hubs + Releases`);
    if (arg[2]=="--heap-stats") {
      runHeapDiagnostics()
    }
    await NinaProcessor.runDbProcesses()
    console.log(`${new Date()} Cron job ended: Sync Hubs + Releases`);
  });
  
  cron.schedule('0 * * * *', async() => {
    console.log(`${new Date()} Cron job starting: Sync Collectors`);
    await NinaProcessor.processCollectors()
    console.log(`${new Date()} Cron job ended: Sync Collectors`);
  })
}

try {
  environmentIsSetup()  
  startProcessing()
} catch (error) {
  console.error('Environment is not properly setup.  Check .env file and try again.')
  console.error(error)
}

const runHeapDiagnostics = () => {
  console.log("Memory Diagnostics at " + new Date(Date.now()) + ": ");
  console.log("   os.freemem():  " + os.freemem());
  console.log("   os.totalmem(): " + os.totalmem());
  console.log("process.memoryUsage(): ");
  console.log(process.memoryUsage());
  console.log("v8.getHeapSpaceStatistics(): ");
  console.log(v8.getHeapSpaceStatistics());
  console.log("v8.getHeapStatistics(): ");
  console.log(v8.getHeapStatistics());
}