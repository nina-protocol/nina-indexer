/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function (knex) {
    return Promise.all([
        knex.schema.createTable('tags', table => {
            table.increments('id').primary();
            table.string('value').notNullable();
        }),
        knex.schema.createTable('tags_content', table => {
            table.primary(['tagId', 'releaseId', 'postId']);
            table.integer('releaseId')
                .unsigned()
                .references('id')
                .inTable('releases')
                .onDelete('CASCADE')
                .index();
            table.integer('postId')
                .unsigned()
                .references('id')
                .inTable('accounts')
                .onDelete('CASCADE')
                .index();
            table.integer('tagId')
                .unsigned()
                .references('id')
                .inTable('accounts')
                .onDelete('CASCADE')
                .index();
        }),
    ]);
};
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function (knex) {
    return knex.schema.dropTableIfExists('tags');
};
