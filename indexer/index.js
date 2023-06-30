import "dotenv/config.js";
import cron from 'node-cron';
import os from 'os';
import v8 from 'node:v8';

import { initDb, config } from '@nina-protocol/nina-db';
import NinaProcessor from './processor.js';
import { environmentIsSetup } from "../scripts/env_check.js";
import { logger } from "./utils.js";

const arg = process.argv.slice()

function getUsedHeapSize() {
  const heapStats = v8.getHeapStatistics();
  const usedHeapSizeBytes = heapStats.used_heap_size;
  const usedHeapSizeMB = usedHeapSizeBytes / (1024 * 1024);
  return usedHeapSizeMB;
}

const runInitialSync = async () => {
  try {
    logger('Initial Sync starting')
    await NinaProcessor.runDbProcesses(true)
    if (process.env.RUN_INITIAL_SYNC === 'true') {
      await NinaProcessor.processCollectors()
    }
    logger('Initial Sync complete')
    return true
  } catch (error) {
    logger(`Initial Sync error: ${error}`)
    return false
  }
}

const startProcessing = async () => {
  logger(`Indexer Starting Up`)
  await initDb(config)
  await NinaProcessor.init()
  logger('Indexer Started - DB and Processor Initialized')
  
  let initialSyncComplete = false
  while (!initialSyncComplete) {
    initialSyncComplete = await runInitialSync()
    if (!initialSyncComplete) {
      logger('Initial Sync failed.  Retrying in 5 seconds.')
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  cron.schedule('* * * * *', async() => {
    logger(`Cron job starting: Sync Hubs + Releases`);
    if (arg[2]=="--heap-stats") {
      runHeapDiagnostics() // Verbose heap diagnostics if option enabled
    }
    logger(`Indexer heap size (MB): ${getUsedHeapSize()}`);
    await NinaProcessor.runDbProcesses()
    logger(`Cron job ended: Sync Hubs + Releases`);
  });
  
  cron.schedule('0 * * * *', async() => {
    logger(`Cron job starting: Sync Collectors`);
    await NinaProcessor.processCollectors()
    logger(`Cron job ended: Sync Collectors`);
  })
}

try {
  environmentIsSetup()  
  startProcessing()
} catch (error) {
  logger(`Environment is not properly setup.  Check .env file and try again. - ${error}`)
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