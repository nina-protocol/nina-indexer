# NINA API

The Nina API makes available the Artist, Collector, Release, and Hub data from the [Nina Protocol](https://www.ninaprotocol.com).

[Documentation](https://dev.ninaprotocol.com/api)
Public Endpoint: [https://api.ninaprotocol.com/v1](https://api.ninaprotocol.com/v1)
---

## What's inside

1. Indexer - `/indexer`
2. Api - `/api`

---

## 1. Indexer

The Indexer consists of a Postgres Db and a Processor that periodically checks the [on-chain Nina Program](https://github.com/nina-protocol/nina/tree/main/programs/nina) and ingests the updates.  It does this in two loops:

1. Changes to Release, Hub, HubRelease, HubPost (frequency: every minute)
2. Changes to Collectors (frequency: every hour)

>Note: Updating Collector information requires a premium RPC connection in order to call `getProgramAccounts` on the Solana Token Program

### Setup

- Copy contents of `.env.example` to `.env` - this includes a default `SOLANA_CLUSTER_URL` for Genysys Go's Public RPC which will be enough to handle (1.) above, but not (2.)
- Setup a Postgres db and replace details in `.env` with your configuration
- `yarn`
- `yarn start:indexer`

>Note: The Indexer can be run as a standalone process

---

## 2. API

The API is a simple Koa app that connects to the Postgres Database used by the indexer.

###Setup

- You should have done the setup for the Indexer above
- `yarn start:api` 

---

## Contributors welcome! 
Need help?  Ask a question in our [Discord](https://discord.gg/ePkqJqSBgj) or open an issue.