/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return Promise.all([
    // Accounts table indexes
    knex.schema.alterTable('accounts', table => {
      table.index('displayName');
      table.index('handle');
    }),
    
    // Hubs table indexes
    knex.schema.raw('CREATE INDEX idx_hubs_handle ON hubs (handle)'),
    knex.schema.raw('CREATE INDEX idx_hubs_display_name ON hubs ((data->>\'displayName\'))'),
    
    // Tags table index
    knex.schema.alterTable('tags', table => {
      table.index('value');
    }),
    
    // Releases table indexes for search
    knex.schema.raw('CREATE INDEX idx_releases_metadata_name ON releases ((metadata->>\'name\'))'),
    knex.schema.raw('CREATE INDEX idx_releases_metadata_artist ON releases ((metadata->\'properties\'->>\'artist\'))'),
    knex.schema.raw('CREATE INDEX idx_releases_metadata_title ON releases ((metadata->\'properties\'->>\'title\'))'),
    
    // GIN indexes for JSON fields
    knex.schema.raw('CREATE INDEX idx_hubs_data_gin ON hubs USING GIN (data)'),
    knex.schema.raw('CREATE INDEX idx_releases_metadata_gin ON releases USING GIN (metadata)')
  ]);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return Promise.all([
    // Drop Accounts table indexes
    knex.schema.alterTable('accounts', table => {
      table.dropIndex('displayName');
      table.dropIndex('handle');
    }),
    
    // Drop Hubs table indexes
    knex.schema.raw('DROP INDEX IF EXISTS idx_hubs_handle'),
    knex.schema.raw('DROP INDEX IF EXISTS idx_hubs_display_name'),
    
    // Drop Tags table index
    knex.schema.alterTable('tags', table => {
      table.dropIndex('value');
    }),
    
    // Drop Releases table indexes
    knex.schema.raw('DROP INDEX IF EXISTS idx_releases_metadata_name'),
    knex.schema.raw('DROP INDEX IF EXISTS idx_releases_metadata_artist'),
    knex.schema.raw('DROP INDEX IF EXISTS idx_releases_metadata_title'),
    
    // Drop GIN indexes
    knex.schema.raw('DROP INDEX IF EXISTS idx_hubs_data_gin'),
    knex.schema.raw('DROP INDEX IF EXISTS idx_releases_metadata_gin')
  ]);
}; 