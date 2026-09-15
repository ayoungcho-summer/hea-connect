import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createApifyRestClient, createEmbeddingRanker, createEnricher, createMatcher, createOpenAiClient } from './adapters.mjs';
import { buildIntegratedProfile, emptyEnrichment, localMatches, MATCH_COUNT, parseCsv, parseLumaCsv, validateMatches } from './matching-domain.mjs';

const publicPerson = person => ({ id: person.id, name: person.name, email: person.email, heaMember: person.heaMember, role: person.role, linkedIn: person.linkedIn, connectGoals: person.connectGoals, lookingFor: person.lookingFor, canOffer: person.canOffer, industries: person.industries, attendance: person.attendance, headline: person.linkedInData.headline || person.role, experiences: person.linkedInData.experiences, profileImage: person.linkedInData.profileImage || '' });
const limit = async (items, count, task) => {
  const results = []; let index = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => { while (index < items.length) { const current = index; index += 1; results[current] = await task(items[current]); } }));
  return results;
};
const canonicalUrl = value => { try { const url = new URL(value); return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '').toLowerCase()}`; } catch { return null; } };
const validExperiencePart = value => { const text = String(value || '').trim(); return text && !/^(true|false|null|undefined|\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-\d{2})$/i.test(text) ? text : ''; };

export function enrichmentFromApifyCsv(csvText) {
  const [headers, ...rows] = parseCsv(csvText.replace(/^\uFEFF/, ''));
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const get = (row, name) => row[index[name]]?.trim() || '';
  const profiles = new Map();
  for (const row of rows) {
    const key = canonicalUrl(get(row, 'linkedinUrl') || get(row, 'linkedinPublicUrl'));
    if (!key) continue;
    const experiences = Array.from({ length: 10 }, (_, position) => [validExperiencePart(get(row, `experiences/${position}/title`)), validExperiencePart(get(row, `experiences/${position}/companyName`))].filter(Boolean).join(', ')).filter(Boolean).slice(0, 5);
    const profile = { headline: get(row, 'headline') || get(row, 'jobTitle'), summary: get(row, 'about').slice(0, 1600), experiences, profileImage: get(row, 'profilePicHighQuality'), source: 'apify' };
    if (profile.headline || profile.summary || profile.experiences.length) profiles.set(key, profile);
  }
  return profiles;
}

export async function generateMatches({ csvPath, writePath, enrich, recommend, prepareRanker }) {
  const people = parseLumaCsv(await readFile(csvPath, 'utf8'));
  if (people.length <= MATCH_COUNT) throw new Error(`At least ${MATCH_COUNT + 1} approved attendees are required to create matches.`);
  const enriched = await limit(people, 4, async person => buildIntegratedProfile(person, await enrich(person)));
  if (prepareRanker) await prepareRanker(enriched);
  const matchesByParticipantId = Object.fromEntries(await limit(enriched, 10, async subject => {
    const candidates = enriched.filter(candidate => candidate.id !== subject.id);
    if (!recommend) throw new Error('OpenAI rationale generation is required; no matcher was configured.');
    const matches = await recommend(subject, candidates);
    return [subject.id, validateMatches(subject.id, matches, new Set(candidates.map(candidate => candidate.id)))];
  }));
  const output = { generatedAt: new Date().toISOString(), participants: enriched.map(publicPerson), matchesByParticipantId };
  await mkdir(dirname(writePath), { recursive: true });
  await writeFile(writePath, `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

function option(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
async function main() {
  const input = option('--input');
  if (!input) throw new Error('Usage: npm run generate:matches -- --input /path/to/attendees.csv');
  const output = option('--output', 'src/data/matches.json');
  const apifyCsvPaths = (option('--linkedin-data', '') || '').split(',').map(value => value.trim()).filter(Boolean);
  const cachedProfiles = new Map();
  for (const path of apifyCsvPaths) for (const [key, profile] of enrichmentFromApifyCsv(await readFile(resolve(path), 'utf8'))) cachedProfiles.set(key, profile);
  const apify = createApifyRestClient(process.env.APIFY_TOKEN);
  const remoteEnrich = createEnricher({ apify }).enrich;
  const enrich = async person => {
    const direct = cachedProfiles.get(canonicalUrl(person.linkedIn));
    if (direct) return direct;
    const nameTokens = person.name.toLowerCase().match(/[a-z]{3,}/g) || [];
    const identifyingTokens = nameTokens.length > 1 ? [nameTokens[0], nameTokens.at(-1)] : nameTokens;
    const byName = [...cachedProfiles.entries()].find(([url]) => identifyingTokens.length && identifyingTokens.every(token => url.includes(token)));
    return byName?.[1] || remoteEnrich(person.linkedIn);
  };
  const openai = createOpenAiClient(process.env.OPENAI_API_KEY);
  if (!openai) throw new Error('OPENAI_API_KEY is required to generate factual match rationales.');
  const ranker = openai ? createEmbeddingRanker({ openai }) : null;
  const recommend = openai ? createMatcher({ openai, rankCandidates: ranker.rank }).recommend : null;
  const result = await generateMatches({ csvPath: resolve(input), writePath: resolve(output), enrich, recommend, prepareRanker: ranker?.prepare });
  const surveyOnly = result.participants.filter(person => !person.experiences.length && person.headline === person.role).length;
  console.log(`Generated ${result.participants.length} attendees and ${result.participants.length * MATCH_COUNT} matches (${surveyOnly} survey-only profiles).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error.message); process.exitCode = 1; });

export { emptyEnrichment };
