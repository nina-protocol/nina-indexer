exports.up = (knex) =>
  knex.schema.alterTable('accounts', (table) => {
    table.timestamp('deleted_at').nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('accounts', (table) => {
    table.dropColumn('deleted_at');
  });
