/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function(knex) {
  await knex.schema.table('hubs_releases', table => {
    table.timestamp('created_at').nullable();
    table.timestamp('updated_at').nullable();
  });
  await knex.schema.alterTable('hubs_releases', table => {
    table.timestamp('created_at').defaultTo(knex.fn.now()).alter();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.table('hubs_releases', table => {
    table.dropColumn('created_at');
    table.dropColumn('updated_at');
  });
};
