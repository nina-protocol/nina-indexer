import "dotenv/config.js";
import cron from 'node-cron';
import { environmentIsSetup } from "../scripts/env_check.js";
import v8 from 'node:v8';
import os from 'os';
import { logTimestampedMessage } from '../utils/logging.js';

function getUsedHeapSize() {
    const heapStats = v8.getHeapStatistics();
    const usedHeapSizeBytes = heapStats.used_heap_size;
    const usedHeapSizeMB = usedHeapSizeBytes / (1024 * 1024);
    return usedHeapSizeMB;
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

const startProcessing = async () => {
    logTimestampedMessage(`${new Date()} Indexer Starting Up`);
    logTimestampedMessage('Indexer Started - DB and Processor Initialized');

    cron.schedule('* * * * *', async() => {
        logTimestampedMessage(`${new Date()} Synchronizing Transactions`);
      if (process.argv[2] === "--heap-stats") {
        runHeapDiagnostics(); // verbose heap diagnostics if option enabled
      }
      logTimestampedMessage(`${new Date()} Indexer heap size (MB): `, getUsedHeapSize());
    });
};

try {
    environmentIsSetup();
    startProcessing();
} catch (error) {
    console.error('Environment is not properly setup.');
    console.error(error);
}
