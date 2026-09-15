# HEA Connect | Networking Website for Haas Entrepreneurship Association's Back to School Event

HEA Connect is a networking experience for the Haas Entrepreneurship Association Back to School community. It helps attendees browse the directory, discover curated introductions, and participate in a shared Open Space discussion board.

The deployed site is available at [hea-connect.vercel.app](https://hea-connect.vercel.app/).

## Features

- Responsive attendee directory with search across profile, Ask, Offer, role, industry, and connection-goal fields
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

The matching pipeline was refined to favor useful introductions over superficial similarity. It separates **who should meet** from **how that connection is explained**: deterministic, evidence-based ranking selects candidates first; OpenAI only writes the final, grounded introduction.

### 1. Attendee intake from Luma

The offline generator reads an exported Luma CSV and keeps only approved attendees. It requires the guest ID, name, email, HEA membership, role, LinkedIn URL, networking goals, Ask, Offer, industries, and attendance mode.

- Multi-select Luma answers become clean arrays and survey emoji prefixes are removed.
- LinkedIn URLs are accepted only for valid `linkedin.com/in/...` profiles.
- Each attendee receives a stable `luma-<guest_id>` identifier so saved matches stay linked to the right person.
- The generator writes a frontend-ready `src/data/matches.json` file, allowing the deployed directory to remain fast and static.

### 2. Optional LinkedIn enrichment with Apify

LinkedIn data enriches matching but is never required to participate. The generator first checks a locally supplied enrichment CSV, matching profiles through normalized LinkedIn URLs. If no cached record is found, it can use Apify's LinkedIn Profile Scraper.

Only matching-relevant fields are retained: headline, a summary capped at 1,600 characters, up to five experience labels, and an optional profile image. Missing URLs, unavailable profiles, and failed Apify requests return a `survey-only` profile rather than failing the event dataset. This keeps matching inclusive for attendees who supplied only the event survey.

### 3. Candidate ranking and why it is structured this way

Each attendee is compared with every other attendee. The ranker uses OpenAI embeddings for semantic similarity and four weighted signals:

| Signal | Weight | Why it matters |
| --- | ---: | --- |
| Attendee Ask → candidate LinkedIn context | 30 | Finds experience relevant to the attendee's stated need. |
| Attendee need → candidate Offer | 30 | Favors introductions where one person can concretely help the other. |
| Shared industries | 20 | Preserves useful domain context without making it the sole criterion. |
| Shared networking goals | 20 | Captures intent such as co-founder search, advice, or collaboration. |

Industry and goal overlap use Jaccard similarity. Ask/Offer and experience comparisons use cosine similarity between embeddings. The similarity is calibrated from its useful 0.10–0.60 range before applying the weights, because raw embedding scores cluster below one even when profiles are meaningfully related.

Scores are normalized using only signals available for both people. This was an intentional choice: an attendee without LinkedIn enrichment should not lose points solely because their profile is survey-only. Results are capped at 98 and a `strong` match must score at least 60.

Below that threshold, a pair is eligible only when there is explicit evidence in event data: either a shared Luma industry/goal (`shared_luma_interest`) or a semantic Ask-to-Offer relationship of at least 0.60 (`complementary_ask_offer`). The fallback prevents sparse profiles from being excluded while avoiding unsupported low-quality introductions.

### 4. OpenAI rationale generation and safeguards

After ranking, the Responses API receives the selected pair's factual fields and the exact match basis. It must return a short JSON rationale, not choose new candidates. The prompt asks for a warm, natural event-host voice while limiting content to provided profile evidence.

Before publishing, every recommendation is validated: up to three unique candidates per attendee; no self or unknown IDs; integer scores from 0–100; a 60-point minimum for `strong` results; evidence-backed fallback types only; and a 30–400 character reason. This prevents malformed model output from entering the static site.

### 5. Regenerate matches

```bash
npm run generate:matches -- \
  --input "/path/to/approved-luma-attendees.csv" \
  --linkedin-data "/path/to/linkedin-export.csv" \
  --output "src/data/matches.json"
```

The script batches enrichment with four concurrent workers, batches embedding requests in groups of 100 records, and generates recommendation batches with ten concurrent workers. It requires `OPENAI_API_KEY`; `APIFY_TOKEN` is needed only when cached enrichment data is insufficient.

Read [Matching Logic](docs/matching-logic.md) for the full scoring model, generation flow, safeguards, and data boundaries.

## Open Space with Supabase

Open Space is the live bulletin board for attendee-led conversations. It is separate from the static matching dataset because topics, comments, and interest signals must update in real time.

### Client identity and realtime updates

The browser initializes Supabase only when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present. It creates an anonymous Supabase Auth session for each visitor. That anonymous user ID is stored as `owner_id`, while the attendee selected in the interface is stored separately as the visible author identity.

The frontend subscribes to Postgres changes on `open_space_topics`, `open_space_interests`, and `open_space_comments`. A new topic, comment, or interest signal refreshes the board for connected visitors without a page refresh.

### Database model and access rules

`supabase/open-space.sql` creates three tables:

- `open_space_topics`: title, category, session mode, table or Zoom location, details, author attendee ID, and anonymous owner ID
- `open_space_interests`: one interest signal per anonymous user per topic
- `open_space_comments`: comments associated with a topic and author attendee ID

Row-level security is enabled on all three tables. Authenticated anonymous sessions may read the board, but inserts must use the caller's `auth.uid()` as `owner_id`; only that owner can delete their topic or remove their own interest signal. Database checks enforce valid categories, a 3–160 character topic title, required table selection for in-person sessions, and 600-character detail/comment limits. The client validates that any supplied Zoom link uses HTTPS.

### Configure Supabase

1. Create a Supabase project and enable anonymous sign-ins in its Auth settings.
2. Run `supabase/open-space.sql` in the Supabase SQL editor.
3. Add the project URL and anonymous key to your local `.env` file.
4. Enable the three tables in the `supabase_realtime` publication, as included in the SQL file.

The anonymous key is intentionally browser-visible and is safe only with row-level security enabled. Never use a Supabase service-role key in a `VITE_` variable or in client code.

## Configuration

Copy `.env.example` to `.env` and fill in only the services this project uses.

- `OPENAI_API_KEY`: used only by the local match-generation script.
- `OPENAI_MODEL`: optional Responses API model override; defaults to `gpt-4o-mini`.
- `OPENAI_EMBEDDING_MODEL`: optional embedding model override; defaults to `text-embedding-3-small`.
- `APIFY_TOKEN`: optional; used only when the generator must fetch a LinkedIn profile instead of reading a supplied enrichment export.
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
