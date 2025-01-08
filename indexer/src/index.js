import 'dotenv/config';
import cron from 'node-cron';
import { environmentIsSetup } from '../../scripts/env_check.js';
import v8 from 'node:v8';
import os from 'os';
import { logTimestampedMessage } from '../src/utils/logging.js';
import { initDb, config } from '@nina-protocol/nina-db';
import TransactionSyncer from './TransactionSyncer.js';
import VerificationSyncer from './VerificationSyncer.js';
import CollectorSyncer from './CollectorSyncer.js';

function getUsedHeapSize() {
    const heapStats = v8.getHeapStatistics();
    const usedHeapSizeBytes = heapStats.used_heap_size;
    const usedHeapSizeMB = usedHeapSizeBytes / (1024 * 1024);
    return usedHeapSizeMB;
}

const runHeapDiagnostics = () => {
    const now = new Date(Date.now());
    const diagnosticInfo = {
        "Memory Diagnostics at": now.toString(),
        "os.freemem()": os.freemem(),
        "os.totalmem()": os.totalmem(),
        "process.memoryUsage()": process.memoryUsage(),
        "v8.getHeapSpaceStatistics()": v8.getHeapSpaceStatistics(),
        "v8.getHeapStatistics()": v8.getHeapStatistics()
    };

    logTimestampedMessage(JSON.stringify(diagnosticInfo, null, 2));
}

const startProcessing = async () => {
    logTimestampedMessage('Indexer processing started.');
    await initDb(config);
    logTimestampedMessage('initDb completed.');
    await TransactionSyncer.initialize();
    await CollectorSyncer.initialize();

    await TransactionSyncer.syncTransactions(); // initial sync

    cron.schedule('* * * * *', async() => {
        logTimestampedMessage(`Starting scheduled transaction sync`);
        await TransactionSyncer.syncTransactions();

        if (process.argv[2] === "--heap-stats") {
            runHeapDiagnostics(); // verbose heap diagnostics if option enabled
        }
        logTimestampedMessage(`Indexer heap size (MB): ${getUsedHeapSize()}`);
    });

    cron.schedule('* * * * *', async() => {
        logTimestampedMessage(`Starting scheduled verification sync`);
        await VerificationSyncer.syncVerifications();
    });

    cron.schedule('0 * * * *', async() => {
        logTimestampedMessage(`Starting scheduled collector sync`);
        await CollectorSyncer.syncCollectors();
    });

};

try {
    environmentIsSetup();
    startProcessing();
} catch (error) {
    console.error('Environment is not properly setup.');
    console.error(error);
}

export { TransactionSyncer };