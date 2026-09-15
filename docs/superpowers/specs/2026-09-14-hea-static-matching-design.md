# HEA Connect Static Matching Design

## Goal

Replace the mock, server-backed prototype with a deployable static event directory generated from the supplied Luma CSV and real LinkedIn enrichment. The published application must contain no database, API server, or API credentials.

## Inputs and trust boundaries

`scripts/generate-matches.mjs` receives a CSV path through `--input`. It accepts only approved Luma rows, parses the event-specific survey columns, and normalizes blank or malformed LinkedIn URLs to `null`. Personal data is processed locally during the generation command; the source CSV, raw Apify output, credentials, and unselected match candidates are not committed or published.

The generator sends LinkedIn profile URLs to Apify and bounded, sanitized profile fields to OpenAI. It treats all scraped and survey text as untrusted data, never as instructions. `.env` holds `OPENAI_API_KEY`; Apify is accessed through its MCP client during a generation run. Neither value is written to JSON or browser code.

## Generation pipeline

1. Parse CSV rows into a canonical attendee profile: id, name, email, HEA membership, role, goals, ask, offer, industries, attendance, and LinkedIn URL.
2. Fetch each valid URL through the configured Apify LinkedIn Profile Scraper. Retain only `headline`, `summary`, and a concise list of experience titles/company names. Persist no raw scrape result.
3. If an individual scrape has no usable result, produce the profile with an empty LinkedIn enrichment field and a `survey-only` source marker. A failed profile must not stop the remaining attendees.
4. Build an integrated profile in which the survey material is 60% of matching context and LinkedIn enrichment is 40%. Ask OpenAI to return five distinct participant ids, relative integer scores (0–100), and concise Korean-or-English reasons, validating every id and score.
5. If OpenAI is unavailable, generate deterministic five-person fallback matches using the same weighted context. This permits local preview and ensures every attendee has results.
6. Write `src/data/matches.json`, including a `generatedAt` timestamp, participant directory fields needed by the UI, and a mapping of attendee id to five match records.

## JSON contract

```json
{
  "generatedAt": "2026-09-14T00:00:00.000Z",
  "participants": [{ "id": "luma-gst-...", "name": "...", "email": "...", "experiences": ["Founder, Example"], "headline": "..." }],
  "matchesByParticipantId": {
    "luma-gst-...": [{ "participantId": "luma-gst-...", "score": 91, "reason": "..." }]
  }
}
```

The public UI does not display email addresses, raw survey responses, raw LinkedIn summaries, or any credentials.

## Static frontend

Vite imports the generated JSON at build time. The directory and Ask/Offer views use generated participant data and have no `/api` fetches, polling, registration flow, or mutation controls. The matching view supports email lookup plus an accessible searchable name picker. It immediately renders the chosen attendee’s five recommendations as cards showing name, headline / previous roles, score, match reason, and an optional external LinkedIn link.

## Failure handling

- Invalid CSV structure: fail before writing JSON with an explicit missing-column error.
- Missing or invalid LinkedIn URL: use survey-only matching for that attendee.
- Apify profile failure: record a non-sensitive warning and continue.
- OpenAI failure or invalid response: use deterministic fallback matching for the affected run.
- Missing generated JSON in development: display a clear instruction to run the generator.

## Verification

Node tests cover CSV normalization, malformed URLs, missing scraper results, exact five unique matches excluding the subject, scores/rationale validation, and the JSON contract. Build and browser smoke checks confirm the generated UI has no API request dependency and supports both email and name selection.

## Constraints

- The supplied CSV is the input source of truth; it is never copied into the repository.
- Generation must handle all 70 approved rows.
- Each match recommendation uses 60% Luma survey context and 40% LinkedIn enrichment when available.
- A scrape or model failure must degrade to survey-only/deterministic matching, not stop output generation.
- `src/data/matches.json` is the only generated data consumed by the shipped frontend.
