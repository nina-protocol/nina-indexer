/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
 exports.up = function(knex) {
  return Promise.all([
    knex.schema.createTable('accounts', table => {
      table.increments('id').primary();
      table.string('publicKey').unique().notNullable();
    }),
    knex.schema.createTable('hubs', table => {
      table.increments('id').primary();
      table.string('publicKey').unique().notNullable();
      table.string('handle').notNullable();
      table.json('data').notNullable();
      table.string('datetime').notNullable();
      table.integer('authorityId')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('accounts')
        .onDelete('SET NULL')
        .index();
    }),
    knex.schema.createTable('posts', table => {
      table.increments('id').primary();
      table.string('publicKey').unique().notNullable();
      table.json('data').notNullable();
      table.string('datetime').notNullable();
      table.integer('publisherId')
        .unsigned()
        .references('id')
        .inTable('accounts')
        .onDelete('SET NULL')
        .index();
      table.integer('hubId')
        .unsigned()
        .references('id')
        .inTable('hubs')
        .onDelete('SET NULL')
        .index();
    }),
    knex.schema.createTable('releases', table => {
      table.increments('id').primary();
      table.string('publicKey').unique().notNullable();
      table.string('mint').notNullable();
      table.json('metadata').notNullable();
      table.string('datetime').notNullable();
      table.integer('publisherId')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('accounts')
        .onDelete('SET NULL')
        .index();
      table.integer('hubId')
        .unsigned()
        .references('id')
        .inTable('hubs')
        .onDelete('SET NULL')
        .index();
    }),
    knex.schema.createTable('releases_collected', table => {
      table.primary(['releaseId', 'accountId']);
      table.integer('releaseId')
        .unsigned()
        .references('id')
        .inTable('releases')
        .onDelete('CASCADE')
        .index();
      table.integer('accountId')
        .unsigned()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
        .index();
    }),
    knex.schema.createTable('hubs_releases', table => {
      table.primary(['hubId', 'releaseId']);
      table.integer('hubId')
        .unsigned()
        .references('id')
        .inTable('hubs')
        .onDelete('CASCADE')
        .index();
      table.integer('releaseId')
        .unsigned()
        .references('id')
        .inTable('releases')
        .onDelete('CASCADE')
        .index();
    }),
    knex.schema.createTable('posts_releases', table => {
      table.primary(['postId', 'releaseId']);
      table.integer('postId')
        .unsigned()
        .references('id')
        .inTable('posts')
        .onDelete('CASCADE')
        .index();
      table.integer('releaseId')
        .unsigned()
        .references('id')
        .inTable('releases')
        .onDelete('CASCADE')
        .index();
    }),
    knex.schema.createTable('hubs_collaborators', table => { 
      table.primary(['hubId', 'accountId']);
      table.integer('hubId')
        .unsigned()
        .references('id')
        .inTable('hubs')
        .onDelete('CASCADE')
        .index();
      table.integer('accountId')
        .unsigned()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
        .index();        
    }),
    knex.schema.createTable('hubs_posts', table => {
      table.primary(['hubId', 'postId']);
      table.integer('hubId')
        .unsigned()
        .references('id')
        .inTable('hubs')
        .onDelete('CASCADE')
        .index();
      table.integer('postId')
        .unsigned()
        .references('id')
        .inTable('posts')
        .onDelete('CASCADE')
        .index();
    }),
  ]);

};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('hubs_collaborators')
    .dropTableIfExists('hubs_posts')
    .dropTableIfExists('hubs_releases')
    .dropTableIfExists('releases_collected')
    .dropTableIfExists('releases')
    .dropTableIfExists('posts_releases')
    .dropTableIfExists('posts')
    .dropTableIfExists('hubs')
    .dropTableIfExists('accounts');
};