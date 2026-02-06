/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex('hubs_releases')
    .whereNotNull('created_at')
    .update({ created_at: null, updated_at: null });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex('hubs_releases')
    .whereNull('created_at')
    .update({ created_at: knex.fn.now(), updated_at: knex.fn.now() });
};
