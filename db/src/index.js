import "dotenv/config.js";
import Knex from 'knex'
import { Model } from 'objection'
import Models from './models/index.js'
import knexConfig from './knexfile.js'
import RedisSubscriptions from './redis/subscriptions.js'
import IndexerRedis from './redis/index.js'

export const initDb = async (config) => {
  const db = Knex(config.development)
  await db.raw(`SELECT 'CREATE DATABASE ${process.env.POSTGRES_DATABASE}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${process.env.POSTGRES_DATABASE}')`
  )
  await db.migrate.latest();
  
  Model.knex(db)  
}

export const destroyDb = async () => {
  const db = Knex(knexConfig.development)
  await db.destroy()
}

export const connectDb = async () => {
  const db = Knex(knexConfig.development)
  
  Model.knex(db)  
}

export const Account = Models.Account
export const Exchange = Models.Exchange
export const Hub = Models.Hub
export const Post = Models.Post
export const Release = Models.Release
export const Subscription = Models.Subscription
export const Tag = Models.Tag
export const Transaction = Models.Transaction
export const Verification = Models.Verification
export const config = knexConfig
export const redis = IndexerRedis
export const SubscriptionsWithCache = RedisSubscriptions