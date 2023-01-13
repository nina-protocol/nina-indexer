import Knex from 'knex'
import { Model } from 'objection'
import Models from './models/index.js'
import knexConfig from './utils/knexfile.js'

export const initDb = async () => {
  const db = Knex(knexConfig.development)
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
export const Transaction = Models.Transaction
export const Verification = Models.Verification
