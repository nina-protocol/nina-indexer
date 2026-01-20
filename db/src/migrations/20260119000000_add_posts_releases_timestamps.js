/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.table('posts_releases', table => {
    table.string('created_at').nullable();
    table.string('updated_at').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.table('posts_releases', table => {
    table.dropColumn('created_at');
    table.dropColumn('updated_at');
  });
};
