# NINA API

The Nina API makes available the Artist, Collector, Release, and Hub data from the [Nina Protocol](https://www.ninaprotocol.com).

[Documentation](https://api.docs.ninaprotocol.com/)

Public Endpoint: [https://api.ninaprotocol.com/v1](https://api.ninaprotocol.com/v1)
---

## What's inside

1. `/db` - ObjectionJs Postgres ORM
2. `/indexer` - ingests onchain data from the Nina Program into the Postgres DB
3. `/api` - Koa app that serves the data from the Postgres DB 
4. `/docs` - OpenApi Specification for the API
---
## 1. /db

The `/db` folder contains migrations, models, and lifecycle scripts for the Postgres DB.  It uses [ObjectionJs](https://vincit.github.io/objection.js/) as an ORM.  

It exists as an npm package that can be installed into other projects via:
`yarn add @nina-protocol/nina-db`

It is used by the Indexer and API.

>Note: When using as a package in an external project make sure to have the required environment variables set.  See `.env.example` for details.

## 2. /indexer

The Indexer consists of a Postgres Db and a Processor that periodically checks the [on-chain Nina Program](https://github.com/nina-protocol/nina/tree/main/programs/nina) and ingests the updates.  It does this in two loops:

1. Changes to Release, Hub, HubRelease, HubPost (syncs every 1 min)
2. Changes to Collectors (syncs every 1 hour)

>Note: Updating Collector information requires a premium RPC connection in order to call `getProgramAccounts` on the Solana Token Program

### Setup

- Copy contents of `.env.example` to `.env` - this includes a default `SOLANA_CLUSTER_URL` for Genysys Go's Public RPC which will be enough to handle (1.) above, but not (2.)
- Setup a Postgres db and replace details in `.env` with your configuration
- `yarn`
- `yarn start:indexer`

>Note: The Indexer can be run as its own standalone process.

---

## 3. /api

The API is a simple Koa app that connects to the Postgres Database populated by the indexer.

###Setup

- After setting up the Indexer as described above run the following which will set up on port 3004
- `yarn start:api` 

---


## 4. /docs

- The docs are built using [Redocly](https://redocly.com/) and adhere to the [OpenApi Specification](https://spec.openapis.org/oas/v3.1.0)'
- Docs can be visited at [here](http://api.docs.ninaprotocol.com/)
- `yarn docs` runs the documenation for local development

## Contributors welcome! 
Need help? Ask a question in our [Discord](https://discord.gg/ePkqJqSBgj) or open an issue.
