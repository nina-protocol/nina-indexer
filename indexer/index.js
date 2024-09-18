import "dotenv/config.js";
import cron from 'node-cron';
import { environmentIsSetup } from "../scripts/env_check.js";
import v8 from 'node:v8';
import os from 'os';
import { logTimestampedMessage } from '../utils/logging.js';
import { initDb, config } from '@nina-protocol/nina-db';
import NinaProcessor from './processor.js';

function getUsedHeapSize() {
    const heapStats = v8.getHeapStatistics();
    const usedHeapSizeBytes = heapStats.used_heap_size;
    const usedHeapSizeMB = usedHeapSizeBytes / (1024 * 1024);
    return usedHeapSizeMB;
}

const runHeapDiagnostics = () => {
    logTimestampedMessage("Memory Diagnostics at " + new Date(Date.now()) + ": ");
    logTimestampedMessage("   os.freemem():  " + os.freemem());
    logTimestampedMessage("   os.totalmem(): " + os.totalmem());
    logTimestampedMessage("process.memoryUsage(): ");
    logTimestampedMessage(process.memoryUsage());
    logTimestampedMessage("v8.getHeapSpaceStatistics(): ");
    logTimestampedMessage(v8.getHeapSpaceStatistics());
    logTimestampedMessage("v8.getHeapStatistics(): ");
    logTimestampedMessage(v8.getHeapStatistics());
}

const startProcessing = async () => {
    logTimestampedMessage('Indexer processing started.');
    await initDb(config);
    logTimestampedMessage('initDb completed.');
    await NinaProcessor.initialize();
    logTimestampedMessage('NinaProcessor initialized.');
    cron.schedule('* * * * *', async() => {
        logTimestampedMessage(`Synchronizing Transactions`);
        await NinaProcessor.processRecentTx();

        if (process.argv[2] === "--heap-stats") {
            runHeapDiagnostics(); // verbose heap diagnostics if option enabled
        }
        logTimestampedMessage(`Indexer heap size (MB): ${getUsedHeapSize()}`);
    });
};

try {
    environmentIsSetup();
    startProcessing();
} catch (error) {
    console.error('Environment is not properly setup.');
    console.error(error);
}