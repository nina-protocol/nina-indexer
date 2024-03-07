/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function (knex) {
  return Promise.all([
      knex.schema.dropTable('tags_content'),
      knex.schema.createTable('tags_releases', table => {
          table.primary(['tagId', 'releaseId']);
          table.integer('releaseId')
              .unsigned()
              .references('id')
              .inTable('releases')
              .onDelete('CASCADE')
              .index();
          table.integer('tagId')
              .unsigned()
              .references('id')
              .inTable('tags')
              .onDelete('CASCADE')
              .index();
      }),
  ]);
};
/**
* @param { import("knex").Knex } knex
* @returns { Promise<void> }
*/
export const down = function (knex) {
  return knex.schema.dropTableIfExists('tags_releases');
};
