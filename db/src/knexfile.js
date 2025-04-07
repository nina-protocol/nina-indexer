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
    auth: {
      client: 'postgresql',
      connection: {
        host:     process.env.AUTH_DB_HOST,
        user:     process.env.AUTH_USER,
        password: process.env.AUTH_PASSWORD,
        database: process.env.AUTH_DB_NAME
      }
    }
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
    auth: {
      client: 'postgresql',
      connection: {
        host:     process.env.AUTH_DB_HOST,
        user:     process.env.AUTH_USER,
        password: process.env.AUTH_PASSWORD,
        database: process.env.AUTH_DB_NAME
      }
    }
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
    auth: {
      client: 'postgresql',
      connection: {
        host:     process.env.AUTH_DB_HOST,
        user:     process.env.AUTH_USER,
        password: process.env.AUTH_PASSWORD,
        database: process.env.AUTH_DB_NAME
      }
    }
  },
  knexAuthDB: {
    client: 'postgresql',
    connection: {
      host:     process.env.AUTH_DB_HOST,
      user:     process.env.AUTH_USER,
      password: process.env.AUTH_PASSWORD,
      database: process.env.AUTH_DB_NAME
    }
  }
};