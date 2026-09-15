import assert from 'node:assert/strict';
import test from 'node:test';
import { toTopicPayload } from './open-space-service.js';

test('creates a topic payload with the current owner and participant identity', () => {
  assert.deepEqual(toTopicPayload({
    ownerId: 'auth-1', participantId: 'luma-1', title: 'MVP feedback', category: 'Idea Exchange', sessionMode: 'in_person', tableCode: 'B', details: ''
  }), {
    owner_id: 'auth-1', author_participant_id: 'luma-1', title: 'MVP feedback', category: 'Idea Exchange', session_mode: 'in_person', table_code: 'B', zoom_url: null, details: ''
  });
});
