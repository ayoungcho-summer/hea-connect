# Open Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time Supabase-backed Open Space board where HEA attendees can create public discussion topics, signal interest, comment, and delete only their own topics without a visible login.

**Architecture:** The static Vite app keeps the selected Luma participant in browser storage and silently creates a Supabase anonymous-auth session. A small Open Space data module owns Supabase calls and converts database rows into UI models; a dedicated React component renders the feed, creation modal, and thread panel. Supabase RLS enforces session ownership for writes and deletes while Realtime pushes all public board changes to every connected browser.

**Tech Stack:** React 19, Vite 7, `@supabase/supabase-js`, Supabase Postgres/RLS/Realtime, lucide-react, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-15-open-space-design.md`

## Global Constraints

- Keep the existing static matching pipeline and `src/data/matches.json` unchanged.
- Do not put a Supabase service-role key in the frontend; use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Enable Supabase Anonymous Sign-Ins; attendees must not see an authentication screen.
- Category values are exactly `Co-founder Search`, `Hiring & Talent`, `Idea Exchange`, `Marketing & Growth`, `VC & Angel Advice`, and `Casual Coffee Chat`.
- In-person topics require exactly one table code: `A`, `B`, `C`, or `D`; Zoom topics may store an optional HTTPS Zoom URL.
- Strong match and Open Space features must remain usable on mobile.
- The repository currently has no Git worktree at `hea-connect`; do not add commit steps unless one is initialized.

---

## File structure

| File | Responsibility |
| --- | --- |
| `supabase/open-space.sql` | Topic, interest, and comment schema; indexes; RLS policies; Realtime publication statements. |
| `.env.example` | Documents public Vite Supabase environment variable names without secrets. |
| `src/open-space-domain.js` | Category/mode/table constants, form validation, row-to-view-model conversion, and ownership helpers. |
| `src/open-space-domain.test.mjs` | Unit tests for validation, allowed enums, location display, and ownership behavior. |
| `src/supabase-client.js` | Creates the Supabase browser client and anonymous session only when public environment values exist. |
| `src/open-space-service.js` | Isolated CRUD, interest toggle, comment fetch/create, and Realtime subscription API. |
| `src/open-space.jsx` | Open Space UI and local browser identity picker/session state. |
| `src/static-app-v3.jsx` | Adds the third tab and renders `OpenSpace`. |
| `src/styles.css` | Open Space grid, modal, thread, and mobile styles. |

## Task 1: Provision the Supabase contract

**Files:**
- Create: `supabase/open-space.sql`
- Create: `.env.example`
- Modify: `package.json`

**Interfaces:**
- Produces tables `open_space_topics`, `open_space_interests`, and `open_space_comments` consumed by `src/open-space-service.js`.
- Produces Vite environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` consumed by `src/supabase-client.js`.

- [ ] **Step 1: Add the failing domain test file and the Supabase dependency declaration**

Create `src/open-space-domain.test.mjs` with an import that intentionally fails until the domain module exists:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { OPEN_SPACE_CATEGORIES, validateTopicDraft } from './open-space-domain.js';

test('accepts the six approved categories', () => {
  assert.equal(OPEN_SPACE_CATEGORIES.length, 6);
  assert.equal(validateTopicDraft({ title: 'Find an MVP collaborator', category: 'Co-founder Search', sessionMode: 'in_person', tableCode: 'A', details: '' }), null);
});
```

Add `"@supabase/supabase-js": "^2.49.0"` under `dependencies` in `package.json`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test src/open-space-domain.test.mjs`

Expected: FAIL because `src/open-space-domain.js` does not exist.

- [ ] **Step 3: Write the Supabase SQL migration**

Create `supabase/open-space.sql` containing:

```sql
create table public.open_space_topics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  author_participant_id text not null,
  title text not null check (char_length(title) between 3 and 160),
  category text not null check (category in ('Co-founder Search', 'Hiring & Talent', 'Idea Exchange', 'Marketing & Growth', 'VC & Angel Advice', 'Casual Coffee Chat')),
  session_mode text not null check (session_mode in ('in_person', 'zoom')),
  table_code text check (table_code in ('A', 'B', 'C', 'D')),
  zoom_url text,
  details text not null default '' check (char_length(details) <= 600),
  created_at timestamptz not null default now(),
  check ((session_mode = 'in_person' and table_code is not null and zoom_url is null) or (session_mode = 'zoom' and table_code is null))
);

create table public.open_space_interests (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.open_space_topics(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  participant_id text not null,
  created_at timestamptz not null default now(),
  unique(topic_id, owner_id)
);

create table public.open_space_comments (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.open_space_topics(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  author_participant_id text not null,
  body text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);

create index open_space_topics_created_at_idx on public.open_space_topics (created_at desc);
create index open_space_interests_topic_id_idx on public.open_space_interests (topic_id);
create index open_space_comments_topic_created_at_idx on public.open_space_comments (topic_id, created_at);

alter table public.open_space_topics enable row level security;
alter table public.open_space_interests enable row level security;
alter table public.open_space_comments enable row level security;

create policy "authenticated users can read topics" on public.open_space_topics for select to authenticated using (true);
create policy "owners can create topics" on public.open_space_topics for insert to authenticated with check (owner_id = auth.uid());
create policy "owners can delete topics" on public.open_space_topics for delete to authenticated using (owner_id = auth.uid());

create policy "authenticated users can read interests" on public.open_space_interests for select to authenticated using (true);
create policy "owners can create interests" on public.open_space_interests for insert to authenticated with check (owner_id = auth.uid());
create policy "owners can delete interests" on public.open_space_interests for delete to authenticated using (owner_id = auth.uid());

create policy "authenticated users can read comments" on public.open_space_comments for select to authenticated using (true);
create policy "owners can create comments" on public.open_space_comments for insert to authenticated with check (owner_id = auth.uid());

alter publication supabase_realtime add table public.open_space_topics;
alter publication supabase_realtime add table public.open_space_interests;
alter publication supabase_realtime add table public.open_space_comments;
```

- [ ] **Step 4: Add public configuration documentation**

Create `.env.example`:

```dotenv
# Public browser configuration only. Never put a service-role key here.
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 5: Install and verify the dependency**

Run: `npm install`

Run: `npm ls @supabase/supabase-js`

Expected: a single installed `@supabase/supabase-js` version.

## Task 2: Build and test the Open Space domain layer

**Files:**
- Create: `src/open-space-domain.js`
- Modify: `src/open-space-domain.test.mjs`

**Interfaces:**
- Produces `OPEN_SPACE_CATEGORIES`, `TABLE_CODES`, `validateTopicDraft(draft)`, `formatTopicLocation(topic)`, and `canDeleteTopic(topic, ownerId)`.
- Consumed by `src/open-space-service.js` and `src/open-space.jsx`.

- [ ] **Step 1: Extend the failing test coverage**

Add tests for invalid values and ownership:

```js
import { canDeleteTopic, formatTopicLocation, validateTopicDraft } from './open-space-domain.js';

test('requires a table only for in-person topics', () => {
  assert.match(validateTopicDraft({ title: 'Founder coffee', category: 'Casual Coffee Chat', sessionMode: 'in_person', tableCode: '', details: '' }), /table/i);
  assert.equal(validateTopicDraft({ title: 'Founder coffee', category: 'Casual Coffee Chat', sessionMode: 'zoom', tableCode: '', details: '', zoomUrl: 'https://zoom.us/j/123' }), null);
});

test('formats location and restricts delete controls to the owner', () => {
  assert.equal(formatTopicLocation({ session_mode: 'in_person', table_code: 'C' }), 'Table C');
  assert.equal(canDeleteTopic({ owner_id: 'owner-1' }, 'owner-1'), true);
  assert.equal(canDeleteTopic({ owner_id: 'owner-1' }, 'owner-2'), false);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test src/open-space-domain.test.mjs`

Expected: FAIL because validation and location helpers do not exist.

- [ ] **Step 3: Implement the small pure domain module**

Define constants and validation that returns `null` on success or a user-facing string on failure. Enforce title length 3–160, details length at most 600, the exact six categories, the exact mode values, table A–D for `in_person`, and an optional HTTPS URL only for `zoom`.

```js
export const TABLE_CODES = ['A', 'B', 'C', 'D'];
export const OPEN_SPACE_CATEGORIES = ['Co-founder Search', 'Hiring & Talent', 'Idea Exchange', 'Marketing & Growth', 'VC & Angel Advice', 'Casual Coffee Chat'];

export function formatTopicLocation(topic) {
  return topic.session_mode === 'zoom' ? 'Zoom' : `Table ${topic.table_code}`;
}
```

- [ ] **Step 4: Run the focused tests and the existing suite**

Run: `node --test src/open-space-domain.test.mjs`

Run: `npm test`

Expected: all tests PASS.

## Task 3: Isolate Supabase client and Realtime data operations

**Files:**
- Create: `src/supabase-client.js`
- Create: `src/open-space-service.js`
- Create: `src/open-space-service.test.mjs`

**Interfaces:**
- `getSupabaseClient(): SupabaseClient | null` returns null when public variables are absent.
- `ensureAnonymousSession(client): Promise<string>` returns the authenticated `user.id`.
- `createOpenSpaceService(client)` returns `{ listTopics, createTopic, deleteTopic, toggleInterest, listComments, createComment, subscribe }`.
- `subscribe({ onTopicChange, onInterestChange, onCommentChange }): () => void` returns an unsubscribe function.

- [ ] **Step 1: Write service tests against a narrow fake client**

Create a fake query builder in `src/open-space-service.test.mjs` and assert payload ownership is injected by service methods:

```js
test('creates a topic with the current owner and participant identity', async () => {
  const calls = [];
  const service = createOpenSpaceService(fakeClient(calls));
  await service.createTopic({ ownerId: 'auth-1', participantId: 'luma-1', title: 'MVP feedback', category: 'Idea Exchange', sessionMode: 'in_person', tableCode: 'B', details: '' });
  assert.deepEqual(calls[0].payload, { owner_id: 'auth-1', author_participant_id: 'luma-1', title: 'MVP feedback', category: 'Idea Exchange', session_mode: 'in_person', table_code: 'B', zoom_url: null, details: '' });
});
```

- [ ] **Step 2: Run the focused service test and verify it fails**

Run: `node --test src/open-space-service.test.mjs`

Expected: FAIL because `createOpenSpaceService` does not exist.

- [ ] **Step 3: Implement the browser client**

In `src/supabase-client.js`, use `createClient` from `@supabase/supabase-js`. Return `null` if either Vite variable is absent. `ensureAnonymousSession` must reuse an existing session and otherwise call `client.auth.signInAnonymously()`; throw the Supabase error intact on failure.

- [ ] **Step 4: Implement service CRUD and Realtime subscription**

Make `listTopics()` select topics with nested interest and comment counts, ordered `created_at` descending. Implement inserts/deletes with database column names matching the SQL. For interest toggles, query by topic and owner, delete an existing row, or insert a new row. Subscribe to `postgres_changes` for INSERT/UPDATE/DELETE on each of the three tables and invoke the corresponding callback. Surface Supabase errors by throwing them; do not create local fallback records.

- [ ] **Step 5: Run service tests and the full suite**

Run: `node --test src/open-space-service.test.mjs`

Run: `npm test`

Expected: all tests PASS.

## Task 4: Add the Open Space UI and browser identity flow

**Files:**
- Create: `src/open-space.jsx`
- Modify: `src/static-app-v3.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- `OpenSpace({ participants, onOpenProfile }): ReactElement` owns topic feed, topic modal, comment thread, browser participant selection, and service state.
- `onOpenProfile(participantId)` switches to the directory and filters/scrolls to the author card.

- [ ] **Step 1: Add component-level validation tests before rendering the feature**

Add a testable exported helper in `src/open-space.jsx`:

```js
export const savedIdentityKey = 'hea-open-space-participant-id';
export function participantForIdentity(participants, id) {
  return participants.find((participant) => participant.id === id) || null;
}
```

Test that a missing/stale stored ID returns `null` and a valid one returns the exact participant.

- [ ] **Step 2: Run the identity helper test and verify it fails**

Run: `node --test src/open-space-ui.test.mjs`

Expected: FAIL because the component/helper does not exist.

- [ ] **Step 3: Implement `OpenSpace`**

Build the following states:

1. Configuration unavailable: show a clear card explaining that live Open Space is not configured.
2. Loading/error/empty feed: show a loading state, an inline retry message on failed fetch, and an empty-board invitation.
3. Identity picker: a searchable/selectable attendee control saves the participant ID in `localStorage`; creating, commenting, and interest toggling opens it if no participant is selected.
4. Topic modal: title, six-category select, In person/Zoom segmented control, Table A–D select or Zoom URL field, details textarea, inline validation, and write-in-progress state.
5. Topic cards: author badge/photo/name/headline, title/category, location, interest toggle and count, comment count/thread toggle, and conditional delete with confirmation.
6. Thread: comments in creation order and a comment composer that retains text after an error.

Use `ensureAnonymousSession` immediately before the first write. Subscribe on mount, refresh the feed after a Realtime event, and unsubscribe on unmount.

- [ ] **Step 4: Integrate the tab into the existing app**

In `src/static-app-v3.jsx`:

```jsx
<button className={tab === 'open-space' ? 'active' : ''} onClick={() => setTab('open-space')}>Open Space</button>
```

Add a matching workspace tab and render:

```jsx
<OpenSpace participants={people} onOpenProfile={(participantId) => { setQuery(byId.get(participantId)?.name || ''); setTab('directory'); }} />
```

Keep existing Directory and My Matches behavior intact.

- [ ] **Step 5: Add scoped Open Space styling**

Use namespaced `.open-space-*` selectors. Build a 3/2/1 card grid, reserve the HEA navy/olive/gold palette, use category labels with distinct restrained color treatments, and ensure interactive controls have visible focus styles. On mobile, stack the create controls, full-width modal fields, and comment composer.

- [ ] **Step 6: Run unit tests and production build**

Run: `npm test`

Run: `npm run build`

Expected: all tests PASS and Vite completes without warnings or errors.

## Task 5: Configure and manually verify shared Realtime behavior

**Files:**
- Modify: local `.env` only (never commit)
- Use: `supabase/open-space.sql`

**Interfaces:**
- Browser environment supplies `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

- [ ] **Step 1: Create a Supabase project and enable Anonymous Sign-Ins**

In Supabase Dashboard, create/select the project, navigate to Authentication → Providers → Anonymous, and enable it. Copy the Project URL and anon/publishable key.

- [ ] **Step 2: Apply the schema**

Open Supabase SQL Editor, paste the entire contents of `supabase/open-space.sql`, execute it once, and confirm all three tables appear in Table Editor with RLS enabled.

- [ ] **Step 3: Configure local public variables**

Add the following to local `.env` without exposing the values in terminal output:

```dotenv
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

- [ ] **Step 4: Run two-browser Realtime verification**

Run: `npm run dev -- --host 127.0.0.1 --port 3000`

In Browser A, select an attendee, create an `Idea Exchange` topic at `Table A`, toggle interest, and post a comment. In Browser B, load the same page with a different attendee, verify all three changes appear without refresh, add a comment, and verify Browser A receives it. Confirm Browser B cannot see or use Browser A’s delete button; Browser A deletes the topic and both feeds remove it.

- [ ] **Step 5: Verify mobile layout and error states**

At a 390px viewport, confirm the Open Space grid is one column, all modal controls remain visible, the thread composer is usable, and no horizontal scroll occurs. Temporarily remove a public Supabase environment variable, reload, and verify the explicit configuration message appears.

## Plan self-review

- Spec coverage: Task 1 covers schema/RLS/Realtime; Task 2 covers topic rules; Task 3 covers data transport; Task 4 covers all tab, card, modal, thread, identity, delete, and responsive UI requirements; Task 5 covers project configuration and real-browser Realtime verification.
- Placeholder scan: no TBD/TODO steps; all files, function names, constraints, and verification commands are named explicitly.
- Type consistency: `OpenSpace` consumes participant objects from `static-app-v3.jsx`; service payload fields exactly match `supabase/open-space.sql`; domain constants are consumed by both service/UI.
