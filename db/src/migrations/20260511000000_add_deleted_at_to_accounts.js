/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.alterTable('accounts', (table) => {
    table.timestamp('deleted_at').nullable();
  });

};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.alterTable('accounts', (table) => {
    table.dropColumn('deleted_at');
  });
};
