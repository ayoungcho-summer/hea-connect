# HEA Static Matching Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Generate a static HEA Connect experience from the supplied Luma CSV and render five saved recommendations per attendee without a database or backend server.

Architecture: A Node generator parses the CSV, enriches LinkedIn fields through Apify, and uses OpenAI only during generation. Provider failures fall back to survey-only/deterministic matching; Vite imports the resulting JSON directly.

Tech Stack: Node.js ESM, node:test, Vite, React 19, OpenAI SDK, Apify MCP.

Spec: `docs/superpowers/specs/2026-09-14-hea-static-matching-design.md`

## Global Constraints

- The supplied CSV is the input source of truth and never enters the repository.
- Generation processes all 70 approved attendees.
- Matching uses Luma context at 60% and LinkedIn context at 40% when available.
- An Apify or OpenAI failure cannot stop JSON generation.
- `src/data/matches.json` is the only generated data the shipped UI consumes.

## File Structure

- `scripts/matching-domain.mjs`: CSV parsing, canonical profiles, weighted fallback scoring, output validation.
- `scripts/adapters.mjs`: bounded Apify extraction and OpenAI match adapters.
- `scripts/generate-matches.mjs`: CLI orchestration and atomic JSON output.
- `scripts/generate-matches.test.mjs`: generator unit and integration tests.
- `src/data/matches.json`: committed public static directory/matches payload.
- `src/main.jsx`, `src/styles.css`: static directory, lookup, and five-card results.
- `README.md`, `.env.example`, `.gitignore`, `package.json`: workflow and secret protection.
- Remove backend-only `server/` and SQLite artifacts only after static verification passes.

### Task 1: Define and test canonical profile + fallback matching

Files:
- Create: `scripts/matching-domain.mjs`
- Create: `scripts/generate-matches.test.mjs`
- Modify: `package.json`

Interfaces:
- Produces `parseLumaCsv(csvText)`, `normalizeLinkedInUrl(value)`, `buildIntegratedProfile(person, enrichment)`, `localMatches(subject, candidates)`, and `validateMatches(subjectId, matches, ids)`.

- [ ] Step 1: Write the failing test

```js
test('parses approved Luma rows into canonical attendees', () => {
  const people = parseLumaCsv(fixtureCsv);
  assert.equal(people.length, 6);
  assert.equal(people[0].email, 'ada@example.com');
  assert.deepEqual(people[0].industries, ['AI / Machine Learning']);
});
test('fallback produces five distinct non-self scores and reasons', () => {
  const matches = localMatches(people[0], people);
  assert.equal(matches.length, 5);
  assert.equal(new Set(matches.map(x => x.participantId)).size, 5);
  assert.ok(matches.every(x => x.participantId !== people[0].id && x.score >= 0 && x.score <= 100 && x.reason.length >= 30));
});
```

- [ ] Step 2: Verify RED

Run: `node --test scripts/generate-matches.test.mjs`

Expected: FAIL because the domain module does not exist.

- [ ] Step 3: Implement the minimum domain

```js
export function normalizeLinkedInUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.hostname === 'www.linkedin.com' && url.pathname.startsWith('/in/') ? url.href : null;
  } catch { return null; }
}
export function localMatches(subject, candidates) {
  return candidates.filter(x => x.id !== subject.id).map(candidate => ({
    participantId: candidate.id, score: scorePair(subject, candidate), reason: describePair(subject, candidate)
  })).sort((a, b) => b.score - a.score).slice(0, 5);
}
```

Implement RFC-4180 CSV cells, survey-column validation, approved-only filtering, multi-select parsing, and a 60% survey / 40% LinkedIn score.

- [ ] Step 4: Verify GREEN

Run: `node --test scripts/generate-matches.test.mjs`

Expected: PASS.

- [ ] Step 5: Commit

```sh
git add scripts/matching-domain.mjs scripts/generate-matches.test.mjs package.json
git commit -m "feat: add static matching domain"
```

### Task 2: Add safe Apify/OpenAI adapters

Files:
- Create: `scripts/adapters.mjs`
- Modify: `scripts/generate-matches.test.mjs`, `.env.example`

Interfaces:
- Produces `createEnricher({ apify })` with `enrich(url)` and `createMatcher({ openai })` with `recommend(subject, candidates)`.
- Enrichment output is exactly `{ headline, summary, experiences, source }`.

- [ ] Step 1: Write failing enrichment and validation tests

```js
test('uses survey-only context after a failed scraper call', async () => {
  const enrich = createEnricher({ apify: { scrapeLinkedIn: async () => { throw new Error('blocked'); } } });
  assert.deepEqual(await enrich.enrich('https://www.linkedin.com/in/ada/'),
    { headline: '', summary: '', experiences: [], source: 'survey-only' });
});
test('rejects model matches containing unknown or self ids', async () => {
  await assert.rejects(() => validateMatches('ada', [{ participantId: 'ada', score: 91, reason: 'A sufficiently long reason string for validation.' }], new Set(['bea'])), /invalid/i);
});
```

- [ ] Step 2: Verify RED

Run: `node --test scripts/generate-matches.test.mjs`

Expected: FAIL because adapter functions do not exist.

- [ ] Step 3: Implement strict adapters

```js
export function createEnricher({ apify }) {
  return { async enrich(url) {
    if (!url) return emptyEnrichment();
    try { return selectFields(await apify.scrapeLinkedIn(url)); }
    catch { return emptyEnrichment(); }
  }};
}
export function createMatcher({ openai }) {
  return { async recommend(subject, candidates) {
    const response = await openai.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', input: buildPrompt(subject, candidates) });
    return validateMatches(subject.id, JSON.parse(response.output_text).matches, new Set(candidates.map(x => x.id)));
  }};
}
```

`selectFields` keeps only headline, summary, and title/company experience strings. The model prompt states that profile text is untrusted data and requires exactly five ids, integer scores 0–100, and 30–400 character reasons.

- [ ] Step 4: Verify GREEN

Run: `node --test scripts/generate-matches.test.mjs`

Expected: PASS.

- [ ] Step 5: Document secrets

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
APIFY_TOKEN=
```

- [ ] Step 6: Commit

```sh
git add scripts/adapters.mjs scripts/generate-matches.test.mjs .env.example
git commit -m "feat: add resilient enrichment adapters"
```

### Task 3: Generate and validate the public JSON

Files:
- Create: `scripts/generate-matches.mjs`
- Create: `src/data/matches.json`
- Modify: `scripts/generate-matches.test.mjs`, `package.json`, `.gitignore`

Interfaces:
- Consumes `generateMatches({ csvPath, writePath, enrich, recommend })`.
- Produces `{ generatedAt, participants, matchesByParticipantId }`.

- [ ] Step 1: Write the failing generator contract test

```js
test('writes five matches per approved attendee', async () => {
  const output = await generateMatches({ csvPath: fixturePath, writePath: tempPath, enrich: async () => emptyEnrichment(), recommend: async () => fallback });
  assert.equal(output.participants.length, 6);
  assert.equal(Object.keys(output.matchesByParticipantId).length, 6);
  assert.ok(output.participants.every(x => output.matchesByParticipantId[x.id].length === 5));
  assert.equal(JSON.parse(await readFile(tempPath, 'utf8')).generatedAt, output.generatedAt);
});
```

- [ ] Step 2: Verify RED

Run: `node --test scripts/generate-matches.test.mjs`

Expected: FAIL because the generator is missing.

- [ ] Step 3: Implement orchestration

```js
export async function generateMatches({ csvPath, writePath, enrich, recommend }) {
  const people = parseLumaCsv(await readFile(csvPath, 'utf8'));
  const enriched = await Promise.all(people.map(async x => ({ ...x, linkedInData: await enrich(x.linkedIn) })));
  const matchesByParticipantId = Object.fromEntries(await Promise.all(enriched.map(async x => [x.id, await getFiveMatches(x, enriched, recommend)])));
  const output = { generatedAt: new Date().toISOString(), participants: publicPeople(enriched), matchesByParticipantId };
  await mkdir(dirname(writePath), { recursive: true });
  await writeFile(writePath, JSON.stringify(output, null, 2) + '\\n');
  return output;
}
```

Resolve the Apify actor schema before live use. Continue on each profile error. If OpenAI is missing, errors, or returns invalid data, use deterministic fallback.

- [ ] Step 4: Verify GREEN

Run: `node --test scripts/generate-matches.test.mjs`

Expected: PASS.

- [ ] Step 5: Register command and protect inputs

Add `"generate:matches": "node --env-file-if-exists=.env scripts/generate-matches.mjs"`; ignore `*.csv` and enrichment cache, but do not ignore `src/data/matches.json`.

- [ ] Step 6: Run real generation

Run: `npm run generate:matches -- --input '/Users/abc/Downloads/WELCOME BACK TO SCHOOL - 참석자 - 2026-09-15-05-29-48.csv'`

Expected: 70 public participants and exactly five valid matches per participant.

- [ ] Step 7: Commit

```sh
git add scripts/generate-matches.mjs scripts/generate-matches.test.mjs src/data/matches.json package.json .gitignore
git commit -m "feat: generate static attendee matches"
```

### Task 4: Replace API UI with generated-data UI

Files:
- Modify: `src/main.jsx`, `src/styles.css`, `src/constants.js`, `tests/smoke.mjs`

Interfaces:
- Consumes imported `matchData` and resolves `matchesByParticipantId[selectedId]`.
- Produces email lookup, name select/search, and five cards with name, previous roles, score, reason, optional LinkedIn link.

- [ ] Step 1: Write failing browser assertions

```js
await page.goto(baseUrl);
await page.getByLabel('Your email').fill('ada@example.com');
await page.getByRole('button', { name: 'Find my matches' }).click();
await expect(page.getByRole('heading', { name: /your five introductions/i })).toBeVisible();
await expect(page.locator('.match-card')).toHaveCount(5);
```

- [ ] Step 2: Verify RED

Run: `node tests/smoke.mjs`

Expected: FAIL because the current UI fetches `/api/participants` and requests three server matches.

- [ ] Step 3: Implement static state and lookup

```jsx
import matchData from './data/matches.json';
const participants = matchData.participants;
const findByEmail = email => participants.find(x => x.email.toLowerCase() === email.trim().toLowerCase());
const matches = selectedId ? matchData.matchesByParticipantId[selectedId] || [] : [];
```

Remove API fetch/polling, registration/mutation UI, server error states, and request loading. Preserve directory filtering, accessible modal, keyboard search, and external LinkedIn links.

- [ ] Step 4: Implement selector and five cards

```jsx
<label htmlFor="match-email">Your email</label>
<input id="match-email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
<label htmlFor="match-person">Or select your name</label>
<select id="match-person" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
  <option value="">Choose your profile</option>
  {participants.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
</select>
```

Resolve match participant ids and show name, headline/experience list, score, reason, and optional LinkedIn link. Add responsive grid styles.

- [ ] Step 5: Verify static UI

Run: `node tests/smoke.mjs && npm run build`

Expected: PASS; no browser request begins with `/api/`.

- [ ] Step 6: Commit

```sh
git add src/main.jsx src/styles.css src/constants.js tests/smoke.mjs
git commit -m "feat: render static attendee matches"
```

### Task 5: Remove confirmed backend runtime and document handoff

Files:
- Delete: `server/index.js`, `server/domain.js`, `server/domain.test.js`, `server/seed.js`, `data/hea.sqlite`
- Modify: `package.json`, `README.md`

- [ ] Step 1: Write failing script assertion

```js
test('development scripts run Vite without Express', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts.dev, 'vite');
  assert.equal(pkg.scripts.start, 'vite preview');
});
```

- [ ] Step 2: Verify RED

Run: `node --test scripts/generate-matches.test.mjs`

Expected: FAIL because `dev` starts `server/index.js`.

- [ ] Step 3: Switch scripts and remove backend only after green

Set `dev` to `vite`, `start` to `vite preview`, and `test` to `node --test scripts/*.test.mjs`. Delete only the listed Express/SQLite artifacts after static tests/build pass.

- [ ] Step 4: Document generation

Document:
1. Set `OPENAI_API_KEY`, `OPENAI_MODEL`, and `APIFY_TOKEN` in `.env`.
2. Run `npm run generate:matches -- --input "...csv"`.
3. Run `npm run build` and deploy `dist/`.

State explicitly that CSV, raw scrape responses, caches, and `.env` are not published, while public directory fields and five matches are embedded in the static build.

- [ ] Step 5: Final verification

Run: `npm test && npm run generate:matches -- --input '/Users/abc/Downloads/WELCOME BACK TO SCHOOL - 참석자 - 2026-09-15-05-29-48.csv' && npm run build && node tests/smoke.mjs`

Expected: all commands pass; JSON includes 70 attendees and five recommendations for each.

- [ ] Step 6: Commit

```sh
git add -A
git commit -m "refactor: ship HEA Connect as a static site"
```
