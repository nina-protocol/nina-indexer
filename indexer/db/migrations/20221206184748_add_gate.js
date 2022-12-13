/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return Promise.all([
    knex.schema.createTable('gates', table => {
      table.increments('id').primary();
      table.string('description'); 
      table.string('fileName').notNullable();
      table.integer('fileSize').notNullable();
      table.string('uri').notNullable();
      table.integer('releaseId')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('releases')
        .onDelete('CASCADE')
        .index();
    }),
  ])
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('gates');
};
