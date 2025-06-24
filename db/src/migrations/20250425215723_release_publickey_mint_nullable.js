/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.alterTable('releases', (table) => {
    table.string('publicKey').nullable().alter();
    table.string('mint').nullable().alter();
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.alterTable('releases', (table) => {
    table.string('publicKey').notNullable().alter();
    table.string('mint').notNullable().alter();
  });
} 