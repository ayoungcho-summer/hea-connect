# Matching Logic

HEA Connect creates three high-confidence introductions for every approved attendee. It is built to find useful exchanges—not merely people with the same broad job label—and to explain each introduction using concrete, verified profile information.

## What the matcher optimizes for

The system ranks four signals:

1. An attendee's Ask is relevant to another attendee's experience.
2. An attendee's stated need is complementary to another attendee's Offer.
3. The pair selected overlapping industries.
4. The pair selected overlapping networking goals.

## End-to-end flow

```text
Approved Luma CSV
        │
        ▼
Canonical attendee profile
        │
        ├── Optional LinkedIn enrichment (cached CSV first, Apify fallback)
        ▼
Integrated matching profile
        │
        ├── OpenAI embeddings rank candidate pairs
        ├── Rule-based evidence identifies fallback candidates
        ▼
Top three candidates
        │
        ├── OpenAI Responses API writes a grounded rationale for each pair
        ├── Validation rejects invalid, duplicate, self, or unsupported results
        ▼
Static `matches.json` consumed by the React app
```

## 1. Canonical attendee profiles

`parseLumaCsv` in `scripts/matching-domain.mjs` accepts approved Luma rows only. It requires the guest ID, name, email, approval status, HEA membership, role, LinkedIn URL, connection goals, Ask, Offer, industries, and attendance fields.

Multi-select answers are cleaned into arrays, including removal of emoji prefixes. LinkedIn URLs are retained only when they are valid `linkedin.com/in/...` profiles. Every person receives a stable `luma-<guest_id>` ID, which keeps recommendations tied to the correct attendee.

## 2. Enrichment is optional by design

The generator first checks a supplied LinkedIn enrichment CSV, matching records by normalized LinkedIn hostname and path. If a cached profile is not available, the adapter can call Apify.

No enrichment record, missing URL, or failed scrape produces a `survey-only` profile rather than failing the data build. Survey answers alone are sufficient to be matched. The system keeps only a headline, a 1,600-character summary, up to five experience labels, and an optional profile image.

## 3. Candidate ranking

When embeddings are available, the generator creates vectors for three text fields per attendee:

- **Ask** — what the attendee seeks, falling back to connection goals
- **Offer** — what the attendee can help with
- **LinkedIn context** — headline, summary, and experience labels

Each candidate pair receives the following weighted components:

| Signal | Weight | Availability rule |
| --- | ---: | --- |
| Ask → candidate LinkedIn context | 30 | Both texts exist |
| Need → candidate Offer | 30 | Both texts exist |
| Shared industries | 20 | Both attendees selected industries |
| Shared connection goals | 20 | Both attendees selected goals |

Industry and goal overlap use Jaccard similarity. Text signals use cosine similarity between OpenAI embeddings. The implementation calibrates cosine values from the useful 0.10–0.60 range to 0–1 before applying weights, so normal-language profiles can meet the eligibility threshold.

Scores are normalized across only the available components. That means a survey-only attendee is not penalized simply because LinkedIn data is missing. Scores are capped at 98.

## 4. Strong matches and supported fallbacks

A score of 60 or above is a `strong` match. Lower-scoring candidates can appear only when the event data independently supports the connection:

- `shared_luma_interest`: shared industry or networking goal
- `complementary_ask_offer`: semantic Ask-to-Offer similarity of at least 0.60

This preserves valuable matches from sparse profiles while preventing arbitrary low-scoring recommendations from being presented as strong ones.

## 5. Grounded explanations

Ranking and writing are separate. The ranker selects candidates first; only then does the Responses API receive the two factual profiles plus the matching basis. The API returns a single JSON rationale written as a warm, short event introduction.

The model does not choose candidates. It is used only to turn validated evidence into readable copy. This keeps candidate selection deterministic and avoids invented reasons.

## 6. Validation contract

`validateMatches` checks every recommendation before a dataset is written:

- No more than three results per attendee
- No duplicate, self, or unknown candidate IDs
- Integer score from 0 to 100
- At least 60 for a `strong` result
- Below-threshold results only with an evidence-backed fallback type
- Rationale length from 30 to 400 characters

The output is written only after all recommendations pass these checks.

## Local fallback

`localMatches` supports controlled tests and development without model calls. It uses shared industries, shared goals, keyword Ask/Offer overlap, and LinkedIn text overlap. Its output must still clear the same threshold and validation rules.

## Privacy boundary

The following inputs must remain local and are ignored by Git:

- `.env` files and all OpenAI, Apify, and Supabase credentials
- SQLite databases
- Raw Luma exports in `data/private/`
- LinkedIn enrichment exports and caches

The committed static dataset is application content used by the live directory. Publish only fields that attendees have consented to make public.

## Verify the pipeline

```bash
npm test
```

The test suite covers CSV normalization, survey-only operation, direct Need/Offer ranking priority, fallback restrictions, structured model output, enrichment field minimization, and output limits.
