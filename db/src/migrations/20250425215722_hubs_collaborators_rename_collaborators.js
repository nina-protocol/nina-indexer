/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.table('hubs_collaborators', table => {
    table.renameColumn('can_add_collaborators', 'canAddCollaborator');
    table.renameColumn('can_add_content', 'canAddContent');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.table('hubs_collaborators', table => {
    table.renameColumn('canAddCollaborator', 'can_add_collaborators');
    table.renameColumn('canAddContent', 'can_add_content');
  });
};