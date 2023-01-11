// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
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
      directory: __dirname + '/migrations',
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
      directory: __dirname + '/migrations',
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
      directory: __dirname + '/migrations',
    },
  }

};
