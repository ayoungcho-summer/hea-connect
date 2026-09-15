import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyEnrichment, localMatches, parseLumaCsv, validateMatches } from './matching-domain.mjs';
import { createEmbeddingRanker, createEnricher, parseRecommendationOutput } from './adapters.mjs';
import { enrichmentFromApifyCsv, generateMatches } from './generate-matches.mjs';

const header = ['guest_id','name','email','approval_status','Are you a member of HEA?','Which best describes you?','LinkedIn Profile','What are you hoping to connect around?','What are you looking for? (ex: Looking for a frontend developer)','What can you offer? (ex:Available for design/marketing projects)','Which industries are you interested in?','Are you participating in-person or via zoom?'];
const row = (id, name, email, role, industries, ask, offer) => [id,name,email,'approved','Yes',role,`https://www.linkedin.com/in/${id}/`,'🤝 Finding Co-founders / Talent',ask,offer,industries,'in-person'];
const fixtureCsv = [header, row('gst-one','Ada Founder','ada@example.com','Founder / Co-founder','🤖 AI / Machine Learning','Technical co-founder','Fundraising guidance'), row('gst-two','Bea Builder','bea@example.com','Builder / Engineer / Designer','🤖 AI / Machine Learning','Fundraising guidance','Technical co-founder'), row('gst-three','Cal Investor','cal@example.com','Investor / VC','💳 FinTech','Portfolio founders','Investor introductions'), row('gst-four','Dee Student','dee@example.com','Student / Aspiring Entrepreneur','🎓 Education / EdTech','Product feedback','User research'), row('gst-five','Eli Founder','eli@example.com','Founder / Co-founder','🛍️ Consumer / Retail','Design partner','Consumer growth'), row('gst-six','Fox Builder','fox@example.com','Builder / Engineer / Designer','💻 Software / SaaS','Product direction','Rapid prototypes')].map(cells => cells.join(',')).join('\n');

test('parses approved Luma rows into canonical attendees', () => {
  const people = parseLumaCsv(fixtureCsv);
  assert.equal(people.length, 6);
  assert.equal(people[0].email, 'ada@example.com');
  assert.deepEqual(people[0].industries, ['AI / Machine Learning']);
  assert.equal(people[0].linkedIn, 'https://www.linkedin.com/in/gst-one/');
});

test('filters local matches below the 60-point threshold', () => {
  const people = parseLumaCsv(fixtureCsv);
  const matches = localMatches(people[0], people);
  assert.equal(matches.length, 1);
  assert.equal(new Set(matches.map(match => match.participantId)).size, 1);
  assert.ok(matches.every(match => match.participantId !== people[0].id && match.score >= 60 && match.score <= 100 && match.reason.length >= 30 && match.reason.length <= 400));
});

test('uses survey-only context after a failed scraper call', async () => {
  const enrich = createEnricher({ apify: { scrapeLinkedIn: async () => { throw new Error('blocked'); } } });
  assert.deepEqual(await enrich.enrich('https://www.linkedin.com/in/ada/'), emptyEnrichment());
});

test('ranks direct Ask-to-LinkedIn and Need-to-Offer signals above weaker overlaps', async () => {
  const vector = text => /frontend|engineering/i.test(text) ? [1, 0] : /education/i.test(text) ? [0, 1] : [0.2, 0.2];
  const ranker = createEmbeddingRanker({ openai: { embeddings: { create: async ({ input }) => ({ data: input.map(text => ({ embedding: vector(text) })) }) } } });
  const subject = { id: 'subject', lookingFor: 'frontend engineering partner', canOffer: 'strategy', industries: ['Education / EdTech'], connectGoals: ['Finding Co-founders / Talent'], linkedInData: { experiences: [] } };
  const direct = { id: 'direct', lookingFor: '', canOffer: 'frontend engineering', industries: ['FinTech'], connectGoals: [], linkedInData: { headline: 'Software engineering lead', experiences: [] } };
  const overlapOnly = { id: 'overlap', lookingFor: '', canOffer: 'fundraising', industries: ['Education / EdTech'], connectGoals: ['Finding Co-founders / Talent'], linkedInData: { headline: 'Education researcher', experiences: [] } };
  await ranker.prepare([subject, direct, overlapOnly]);
  assert.equal(ranker.rank(subject, [direct, overlapOnly])[0].participantId, 'direct');
});

test('rejects model matches containing unknown or self ids', () => {
  assert.throws(() => validateMatches('luma-gst-one', [{ participantId: 'luma-gst-one', score: 91, reason: 'A sufficiently long reason string for validation.' }], new Set(['luma-gst-two'])), /invalid/i);
});

test('permits a below-threshold result only with a verified Luma fallback type', () => {
  const fallback = [{ participantId: 'luma-gst-two', score: 48, matchType: 'shared_luma_interest', reason: 'They selected the same event focus, providing a concrete reason to compare their approaches.' }];
  assert.doesNotThrow(() => validateMatches('luma-gst-one', fallback, new Set(['luma-gst-two'])));
  assert.throws(() => validateMatches('luma-gst-one', [{ ...fallback[0], matchType: 'strong' }], new Set(['luma-gst-two'])), /invalid/i);
});

test('accepts fenced JSON arrays returned by the model', () => {
  assert.deepEqual(parseRecommendationOutput('```json\n[{"participantId":"luma-gst-two","score":88,"reason":"A sufficiently long model-generated recommendation reason."}]\n```'), [{ participantId: 'luma-gst-two', score: 88, reason: 'A sufficiently long model-generated recommendation reason.' }]);
});

test('keeps a single rationale JSON object intact', () => {
  assert.deepEqual(parseRecommendationOutput('{"reason":"A natural, sufficiently long matching rationale for this pair."}'), { reason: 'A natural, sufficiently long matching rationale for this pair.' });
});


test('keeps only matching fields and profile image from Apify CSV', () => {
  const data = enrichmentFromApifyCsv('linkedinUrl,headline,about,experiences/0/title,experiences/0/companyName,profilePicHighQuality\nhttps://www.linkedin.com/in/ada/,Founder,Builds tools,CEO,Example Co,https://images.example/ada.jpg');
  assert.deepEqual(data.get('linkedin.com/in/ada'), { headline: 'Founder', summary: 'Builds tools', experiences: ['CEO, Example Co'], profileImage: 'https://images.example/ada.jpg', source: 'apify' });
});

test('writes up to three matches per approved attendee above the score threshold', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hea-matches-'));
  const csvPath = join(directory, 'attendees.csv');
  const outputPath = join(directory, 'matches.json');
  await writeFile(csvPath, fixtureCsv);
  const output = await generateMatches({ csvPath, writePath: outputPath, enrich: async () => emptyEnrichment(), recommend: async (subject, candidates) => localMatches(subject, candidates) });
  assert.equal(output.participants.length, 6);
  assert.equal(Object.keys(output.matchesByParticipantId).length, 6);
  assert.ok(output.participants.every(person => output.matchesByParticipantId[person.id].length <= 3 && output.matchesByParticipantId[person.id].every(match => match.score >= 60)));
  assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).generatedAt, output.generatedAt);
});
