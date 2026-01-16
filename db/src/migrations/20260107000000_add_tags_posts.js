/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function (knex) {
  return knex.schema.createTable('tags_posts', table => {
    table.primary(['tagId', 'postId']);
    table.integer('postId')
      .unsigned()
      .references('id')
      .inTable('posts')
      .onDelete('CASCADE')
      .index();
    table.integer('tagId')
      .unsigned()
      .references('id')
      .inTable('tags')
      .onDelete('CASCADE')
      .index();
    table.timestamp('createdAt').defaultTo(knex.fn.now());
    table.timestamp('updatedAt').defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function (knex) {
  return knex.schema.dropTableIfExists('tags_posts');
};
