export const OPEN_SPACE_CATEGORIES = ['Co-founder Search', 'Hiring & Talent', 'Idea Exchange', 'Marketing & Growth', 'VC & Angel Advice', 'Casual Coffee Chat'];
export const TABLE_CODES = ['A', 'B', 'C', 'D'];
export const SESSION_MODES = ['in_person', 'zoom'];
export const savedIdentityKey = 'hea-open-space-participant-id';

const clean = value => String(value || '').trim();

export function validateTopicDraft(draft) {
  const title = clean(draft.title);
  const details = clean(draft.details);
  if (title.length < 3 || title.length > 160) return 'Topic title must be between 3 and 160 characters.';
  if (!OPEN_SPACE_CATEGORIES.includes(draft.category)) return 'Choose a valid category.';
  if (!SESSION_MODES.includes(draft.sessionMode)) return 'Choose In person or Zoom.';
  if (draft.sessionMode === 'in_person' && !TABLE_CODES.includes(draft.tableCode)) return 'Choose a table from A to D.';
  if (draft.sessionMode === 'zoom' && clean(draft.zoomUrl)) {
    try { if (new URL(draft.zoomUrl).protocol !== 'https:') return 'Zoom link must use HTTPS.'; }
    catch { return 'Enter a valid Zoom link.'; }
  }
  if (details.length > 600) return 'Details must be 600 characters or fewer.';
  return null;
}

export function formatTopicLocation(topic) {
  return topic.session_mode === 'zoom' ? 'Zoom' : `Table ${topic.table_code}`;
}

export function canDeleteTopic(topic, ownerId) {
  return Boolean(ownerId && topic?.owner_id === ownerId);
}

export function participantForIdentity(participants, id) {
  return participants.find((participant) => participant.id === id) || null;
}
