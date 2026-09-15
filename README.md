# HEA Connect | Networking Website for Haas Entrepreneurship Association's Back to School Event

HEA Connect is a networking experience for the Haas Entrepreneurship Association Back to School community. It helps attendees browse the directory, discover curated introductions, and participate in a shared Open Space discussion board.

The deployed site is available at [hea-connect.vercel.app](https://hea-connect.vercel.app/).

## Features

- Responsive attendee directory with search across profile, Ask, Offer, role, industry, and connection-goal fields
- Korean-to-English search alias for `디자인` → `design`
- Three curated matches per attendee, generated from survey answers and optional LinkedIn enrichment
- Grounded, structured OpenAI-written explanations for each recommendation
- Supabase-backed Open Space board for public topics, interest signals, and comments
- Berkeley Blue HEA brand lockup

## Everyday commands

```bash
npm install
npm run dev
npm test
npm run build
```

## Matching system

The matching pipeline was refined to favor useful introductions over superficial similarity. It combines attendee-provided context with optional LinkedIn enrichment, semantic scoring for complementary needs and offers, and validation before any result reaches the frontend.

Read [Matching Logic](docs/matching-logic.md) for the full scoring model, generation flow, safeguards, and data boundaries.

## Configuration

Copy `.env.example` to `.env` and fill in only the services this project uses.

- `OPENAI_API_KEY`: used only by the local match-generation script.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: used by the browser for Open Space realtime features. The anonymous key is expected to be browser-visible; never use a Supabase service-role key here.

The `.env` file is ignored by Git and remains specific to HEA Connect. Read [SECURITY.md](SECURITY.md) before adding credentials or attendee data.

## Data layout

- `src/data/matches.json` — frontend-ready generated match data. Publish only attendee fields approved for the public directory.
- `data/private/` — local attendee exports and other private inputs; ignored by Git.
- `scripts/` — CSV parsing, LinkedIn enrichment adapters, scoring, and match generation.
- `supabase/open-space.sql` — schema, access policies, and realtime setup for Open Space.

Generate matches with your local attendee and LinkedIn exports:

```bash
npm run generate:matches -- \
  --input "/path/to/attendees.csv" \
  --linkedin-data "/path/to/linkedin-export.csv" \
  --output "src/data/matches.json"
```

## Project structure

```text
src/        React UI and static match experience
scripts/    local data-processing and matching pipeline
supabase/   Open Space database SQL
data/       local generated/cache data (private inputs go in data/private)
docs/       product and implementation notes
server/     preserved legacy Express/SQLite prototype
```

`server/` and `data/hea.sqlite` are preserved legacy material. They are not required by the current Vite frontend, and the SQLite database remains ignored by Git.
