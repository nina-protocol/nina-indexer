![image](img/nina.png)

# nina-indexer
Nina Indexer 2.0

1. [About](#About)
2. [Requirements](#Requirements)

## About
Nina Indexer synchronizes on-chain Nina Protocol transactions.

Structure:
```
indexer/
├── src/
│   ├── services/
│   │   ├── hubData.js         # Hub data fetching service
│   │   ├── releaseData.js     # Release data fetching service
│   │   └── index.js           # Service exports
│   ├── processors/
│   │   ├── base/
│   │   │   └── BaseProcessor.js
│   │   ├── HubProcessor.js
│   │   ├── ReleaseProcessor.js
│   │   └── index.js           # Processor exports
│   ├── utils/
│   │   ├── logging.js         # Logging utilities
│   │   ├── helpers.js         # General helpers
│   │   └── index.js           # Utils exports
│   ├── TransactionSyncer.js   # Main transaction syncer
│   └── index.js               # Main entry point
├── package.json
└── README.md
```

## Run manually
```
pm2 start src/index.js --name "nina-indexer"
pm2 start api/index.js --name "nina-api"
```

## Executions using our scripts
```
./scripts/run.sh
./scripts/stop.sh
./scripts/restart.sh
```

## Testing
```
yarn test:local
```

## Requirements
1. Node >= 16.17.0 and < 18.0