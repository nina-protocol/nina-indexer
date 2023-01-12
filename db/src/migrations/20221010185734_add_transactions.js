/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return Promise.all([
    knex.schema.createTable('transactions', table => {
      table.increments('id').primary();
      table.string('txid').unique().notNullable();
      table.integer('blocktime').notNullable();
      table.string('type').notNullable();
      table.integer('hubId')
        .unsigned()
        .references('id')
        .inTable('hubs')
        .onDelete('CASCADE')
        .index();
      table.integer('authorityId')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
        .index();
      table.integer('releaseId')
        .unsigned()
        .references('id')
        .inTable('releases')
        .onDelete('CASCADE')
        .index();
      table.integer('postId')
        .unsigned()
        .references('id')
        .inTable('posts')
        .onDelete('CASCADE')
        .index();
      table.integer('toAccountId')
        .unsigned()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
        .index();
      table.integer('toHubId')
        .unsigned()
        .references('id')
        .inTable('hubs')
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
  return knex.schema.dropTableIfExists('transactions');
};
