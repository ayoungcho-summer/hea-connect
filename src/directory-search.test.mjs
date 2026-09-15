import assert from 'node:assert/strict';
import test from 'node:test';
import { filterPeople } from './directory-search.js';

const people = [
  {
    name: 'Dan Abay',
    headline: 'Founder',
    industries: ['AI / Machine Learning'],
    lookingFor: 'A technical co-founder',
    canOffer: 'Design',
    role: 'Founder / Co-founder',
    connectGoals: ['Co-founder matching'],
  },
];

test('finds English card content from a Korean design query', () => {
  assert.deepEqual(filterPeople(people, '디자인'), people);
});

test('searches Ask and Offer content as well as displayed profile metadata', () => {
  assert.deepEqual(filterPeople(people, 'technical co-founder'), people);
});
