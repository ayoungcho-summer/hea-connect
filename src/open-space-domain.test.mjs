import assert from 'node:assert/strict';
import test from 'node:test';
import { canDeleteTopic, formatTopicLocation, OPEN_SPACE_CATEGORIES, validateTopicDraft } from './open-space-domain.js';

test('accepts the six approved categories', () => {
  assert.equal(OPEN_SPACE_CATEGORIES.length, 6);
  assert.equal(validateTopicDraft({ title: 'Find an MVP collaborator', category: 'Co-founder Search', sessionMode: 'in_person', tableCode: 'A', details: '' }), null);
});

test('requires a table only for in-person topics', () => {
  assert.match(validateTopicDraft({ title: 'Founder coffee', category: 'Casual Coffee Chat', sessionMode: 'in_person', tableCode: '', details: '' }), /table/i);
  assert.equal(validateTopicDraft({ title: 'Founder coffee', category: 'Casual Coffee Chat', sessionMode: 'zoom', tableCode: '', details: '', zoomUrl: 'https://zoom.us/j/123' }), null);
});

test('formats location and restricts delete controls to the owner', () => {
  assert.equal(formatTopicLocation({ session_mode: 'in_person', table_code: 'C' }), 'Table C');
  assert.equal(formatTopicLocation({ session_mode: 'zoom' }), 'Zoom');
  assert.equal(canDeleteTopic({ owner_id: 'owner-1' }, 'owner-1'), true);
  assert.equal(canDeleteTopic({ owner_id: 'owner-1' }, 'owner-2'), false);
});
