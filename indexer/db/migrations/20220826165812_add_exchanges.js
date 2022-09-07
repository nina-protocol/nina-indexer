/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return Promise.all([
    knex.schema.createTable('exchanges', table => {
      table.increments('id').primary();
      table.string('publicKey').unique().notNullable();
      table.boolean('isSale').notNullable();
      table.decimal('expectedAmount').notNullable();
      table.decimal('initializerAmount').notNullable();
      table.boolean('cancelled').notNullable();
      table.string('createdAt').notNullable();
      table.string('updatedAt');
      table.integer('initializerId')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('accounts')
        .onDelete('SET NULL')
        .index();
      table.integer('completedById')
        .unsigned()
        .references('id')
        .inTable('accounts')
        .onDelete('SET NULL')
        .index();
      table.integer('releaseId')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('releases')
        .onDelete('SET NULL')
        .index();
  }),
]);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('exchanges')

};
