# Security and Privacy

## Do not commit secrets

Keep these values in a local `.env` file or your hosting provider's encrypted environment settings:

- `OPENAI_API_KEY`
- `APIFY_TOKEN`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- Any Supabase service-role key

`.env` files are ignored by Git. `.env.example` contains placeholders only.

## Keep databases and source exports private

Never commit SQLite files, raw Luma attendee exports, LinkedIn enrichment exports, or enrichment caches. Put source attendee files under `data/private/`; that directory is excluded from Git except for its `.gitkeep` placeholder.

## Public browser configuration

`VITE_` variables are bundled into browser code. The Supabase anonymous key is intended for browser use only when row-level security is enabled. Never substitute a service-role key or any administrative database credential.

## Reporting a problem

If you find a security or privacy issue, do not open a public issue containing private data or credentials. Contact the repository owner privately with the affected file or feature and a minimal reproduction.
