require('dotenv/config');
const cron = require('node-cron');

const { connectDb } = require('@nina-protocol/nina-db');
const NinaProcessor = require('./processor');

const startProcessing = async () => {
  console.log('Indexer Starting Up')

  await connectDb()
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

startProcessing();