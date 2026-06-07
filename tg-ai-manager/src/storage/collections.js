/** Logical document keys shared by FileBackend and SupabaseBackend */
const COLLECTIONS = {
  settings: { file: 'settings.json', supabaseTable: 'app_settings' },
  secrets: { file: 'secrets.json', supabaseTable: 'app_secrets' },
  existing_posts: { file: 'existing_posts.json', supabaseTable: 'channel_posts' },
  processed_posts: { file: 'processed_posts.json', supabaseTable: 'processed_entries' },
  drafts: { file: 'drafts.json', supabaseTable: 'drafts' },
  scheduled: { file: 'scheduled.json', supabaseTable: 'scheduled_posts' },
  access: { file: 'access.json', supabaseTable: 'access_data' }
};

module.exports = { COLLECTIONS };
