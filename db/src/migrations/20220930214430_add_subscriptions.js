/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return Promise.all([
    knex.schema.createTable('subscriptions', table => {
      table.increments('id').primary();
      table.string('publicKey').unique().notNullable();
      table.string('datetime').notNullable();
      table.string('from').notNullable();
      table.string('to').notNullable();
      table.string('subscriptionType').notNullable();
    }),
  ])
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.dropTableIfExists('subscriptions');
};
