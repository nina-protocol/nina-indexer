/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.table('hubs_collaborators', table => {
    table.boolean('can_add_content').defaultTo(true);
    table.boolean('can_add_collaborators').defaultTo(true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.table('hubs_collaborators', table => {
    table.dropColumn('can_add_content');
    table.dropColumn('can_add_collaborators');
  });
};