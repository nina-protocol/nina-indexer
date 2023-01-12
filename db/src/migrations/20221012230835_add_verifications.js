/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return Promise.all([
    knex.schema.createTable('verifications', table => {
      table.increments('id').primary();
      table.string('publicKey').unique().notNullable();
      table.string('type').notNullable();
      table.string('value').notNullable();
      table.string('displayName');
      table.string('image');
      table.string('description');
      table.integer('accountId')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
        .index();
    }),
  ])
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.dropTableIfExists('verificiations');
};
