import "dotenv/config.js";
import cron from 'node-cron';
import os from 'os';
import v8 from 'node:v8';

import { initDb, config } from '@nina-protocol/nina-db';
import NinaProcessor from './processor.js';
import { environmentIsSetup } from "../scripts/env_check.js";

const arg = process.argv.slice()

function getUsedHeapSize() {
  const heapStats = v8.getHeapStatistics();
  const usedHeapSizeBytes = heapStats.used_heap_size;
  const usedHeapSizeMB = usedHeapSizeBytes / (1024 * 1024);
  return usedHeapSizeMB;
}

const runInitialSync = async () => {
  try {
    console.log('Initial Sync starting')
    await NinaProcessor.runDbProcesses()
    await NinaProcessor.runProcessExchangesAndTransactions()
    if (process.env.RUN_INITIAL_SYNC === 'true') {
      await NinaProcessor.processCollectors()
    }
    console.log('Initial Sync complete')
    return true
  } catch (error) {
    console.log('Initial Sync error: ', error)
    return false
  }
}

const startProcessing = async () => {
  console.log(`${new Date()} Indexer Starting Up`)
  await initDb(config)
  await NinaProcessor.init()
  console.log('Indexer Started - DB and Processor Initialized')
  
  let initialSyncComplete = false
  while (!initialSyncComplete) {
    initialSyncComplete = await runInitialSync()
    if (!initialSyncComplete) {
      console.log('Initial Sync failed.  Retrying in 5 seconds.')
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  cron.schedule('* * * * *', async() => {
    console.log(`${new Date()} Cron job starting: Sync Hubs + Releases`);
    if (arg[2]=="--heap-stats") {
      runHeapDiagnostics() // Verbose heap diagnostics if option enabled
    }
    console.log(`${new Date()} Indexer heap size (MB): `, getUsedHeapSize());
    await NinaProcessor.runDbProcesses()
    console.log(`${new Date()} Cron job ended: Sync Hubs + Releases`);
  });

  cron.schedule('*/10 * * * * *', async() => {
    
    console.log(`${new Date()} Cron job starting: Sync Transactions`);
    if (arg[2]=="--heap-stats") {
      runHeapDiagnostics() // Verbose heap diagnostics if option enabled
    }
    console.log(`${new Date()} Indexer heap size (MB): `, getUsedHeapSize());
    await NinaProcessor.runProcessExchangesAndTransactions(false)
    console.log(`${new Date()} Cron job ended: Sync Transactions`);
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