# Open Space Design

## Purpose

Add a shared, real-time Open Space board to HEA Connect so event attendees can open a focused discussion, signal interest, and organize a conversation without leaving the event site.

## Scope

- Add `Open Space` as the third workspace tab after People Directory and My Matches.
- Let an attendee select their existing event name/email once. Store the selected participant locally for the browser session and associate it with Open Space activity.
- Use Supabase Realtime for topics, interests, and comments.
- Use Supabase anonymous authentication behind the scenes. This introduces no visible sign-in but gives each browser session a server-enforced owner identity for delete permissions.
- Make all topics, interest counts, and comments public to event participants in real time.

## Topic creation

The Open Space header has a `+ Create Topic Card` action. The modal contains:

- Required title (maximum 160 characters)
- Required category: `Co-founder Search`, `Hiring & Talent`, `Idea Exchange`, `Marketing & Growth`, `VC & Angel Advice`, or `Casual Coffee Chat`
- Required mode: `In person` or `Zoom`
- Required table for In person: `A`, `B`, `C`, or `D`
- Optional Zoom URL for Zoom sessions
- Optional details (maximum 600 characters)

Creating a topic writes the selected attendee's event profile ID and display data alongside the anonymous-auth owner ID. The former makes author badges render immediately from the static participant data; the latter is used only for authorization.

## Topic feed

Topics render in a responsive card grid ordered newest first. A card shows:

- Author avatar, name, and headline; clicking it opens/links to the author’s directory profile
- Category tag, title, and optional details
- `Table A` through `Table D` or `Zoom` location badge
- Interest count with an `I'm Interested` toggle; each anonymous session can have one interest record per topic
- Comment count and a thread toggle
- A delete action only for the anonymous-auth owner of the topic

The grid collapses from three to two to one column across desktop, tablet, and mobile breakpoints.

## Comments

Opening a thread loads the topic’s comments and subscribes to real-time inserts. A participant must have selected their event profile to post. Comments include author profile data, body, and timestamp. Comments are public and immutable in v1; topic deletion cascades to its comments and interests.

## Supabase schema and access control

Tables:

- `open_space_topics`: id, owner_id, author_participant_id, title, category, session_mode, table_code, zoom_url, details, created_at
- `open_space_interests`: id, topic_id, owner_id, participant_id, created_at; unique(topic_id, owner_id)
- `open_space_comments`: id, topic_id, owner_id, author_participant_id, body, created_at

Row-level security:

- Anyone using the app's anonymous session can select all three tables.
- Authenticated anonymous sessions can insert their own topic, interest, and comment records, with `owner_id = auth.uid()`.
- Only a topic owner can delete that topic. Cascade deletes clean up dependent interests and comments.
- Only an interest owner can delete their interest toggle.
- Comments are not edited or deleted individually in v1.

Supabase Realtime is enabled for all three tables. The public Supabase URL and anon key are Vite environment variables; no service-role key is ever placed in the browser.

## Error handling

- If Supabase configuration is missing, the Open Space tab explains that live discussion is unavailable rather than pretending changes were saved.
- Failed writes surface a visible inline error and leave the modal/thread open with entered text intact.
- Topic delete requires confirmation.
- A browser without a selected attendee profile is sent to the existing participant picker before it can create, comment, or toggle interest.

## Verification

- Unit-test topic validation and category/table enums.
- Verify RLS behavior with separate anonymous sessions: a second session can read and comment but cannot delete the first session's topic or duplicate its interest.
- Verify real-time topic, comment, and interest updates in two browser windows.
- Verify desktop and mobile card layouts and accessible modal/thread controls.
