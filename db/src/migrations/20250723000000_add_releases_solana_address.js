/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.table('releases', table => {
    table.string('solanaAddress').nullable();
  }).then(() => {
    return knex('releases').whereNotNull('mint').update('solanaAddress', knex.ref('publicKey'));
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.table('releases', table => {
    table.dropColumn('solanaAddress');
  });
};