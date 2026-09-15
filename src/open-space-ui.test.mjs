import assert from 'node:assert/strict';
import test from 'node:test';
import { participantForIdentity, savedIdentityKey } from './open-space-domain.js';

test('resolves only a valid saved participant identity', () => {
  const people = [{ id: 'luma-1', name: 'Ayoung Cho' }];
  assert.equal(savedIdentityKey, 'hea-open-space-participant-id');
  assert.deepEqual(participantForIdentity(people, 'luma-1'), people[0]);
  assert.equal(participantForIdentity(people, 'missing'), null);
});
