/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return Promise.all([
    knex.schema.createTable('releases_revenue_share', table => {
      table.primary(['releaseId', 'accountId']);
      table.integer('releaseId')
        .unsigned()
        .references('id')
        .inTable('releases')
        .onDelete('CASCADE')
        .index();
      table.integer('accountId')
        .unsigned()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
        .index();
    })
  ]);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('releases_revenue_share')
};
