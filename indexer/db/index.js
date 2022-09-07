const Knex = require('knex')
const knexConfig = require('./knexfile')
const { Model } = require('objection')

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

module.exports = {
  initDb,
  connectDb,
  destroyDb,
}