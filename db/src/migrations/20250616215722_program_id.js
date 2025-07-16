/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.table('releases', table => {
    table.string('programId').notNullable().defaultTo(process.env.NINA_PROGRAM_ID);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.table('releases', table => {
    table.dropColumn('programId');
  });
};