/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
import "dotenv/config.js";
export default {

  development: {
    client: 'postgresql',
    connection: {
      host:     process.env.POSTGRES_HOST,
      database: process.env.POSTGRES_DATABASE,
      user:     process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    },
    migrations: {
      directory: './node_modules/@nina-protocol/nina-db/dist/migrations',
    },
  },
  staging: {
    client: 'postgresql',
    connection: {
      host:     process.env.POSTGRES_HOST,
      database: process.env.POSTGRES_DATABASE,
      user:     process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    },
    migrations: {
      directory: './node_modules/@nina-protocol/nina-db/dist/migrations',
    },
  },
  production: {
    client: 'postgresql',
    connection: {
      host:     process.env.POSTGRES_HOST,
      database: process.env.POSTGRES_DATABASE,
      user:     process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    },
    migrations: {
      directory: './node_modules/@nina-protocol/nina-db/dist/migrations',
    },
    debug: true,
  }
};
