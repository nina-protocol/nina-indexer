/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.table('subscriptions', table => {
      table.string('page_ref').nullable();
      table.string('page_ref_type').nullable();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.table('subscriptions', table => {
      table.dropColumn('page_ref');
      table.dropColumn('page_ref_type');
    });
};