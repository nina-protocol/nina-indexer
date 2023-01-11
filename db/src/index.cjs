import Knex from 'knex'
import { Model } from 'objection'
import Models from './models'
import knexConfig from './utils/knexfile'

const initDb = async () => {
  const db = Knex(knexConfig.development)
  await db.raw(`SELECT 'CREATE DATABASE ${process.env.POSTGRES_DATABASE}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${process.env.POSTGRES_DATABASE}')`
  )
  await db.migrate.latest();
  
  Model.knex(db)  
}

const destroyDb = async () => {
  const db = Knex(knexConfig.development)
  await db.destroy()
}

const connectDb = async () => {
  const db = Knex(knexConfig.development)
  
  Model.knex(db)  
}

const db = {
  initDb,
  connectDb,
  destroyDb,
  Models,
}

export default db