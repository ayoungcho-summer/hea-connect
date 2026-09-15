const requiredColumns = ['guest_id', 'name', 'email', 'approval_status', 'Are you a member of HEA?', 'Which best describes you?', 'LinkedIn Profile', 'What are you hoping to connect around?', 'What are you looking for? (ex: Looking for a frontend developer)', 'What can you offer? (ex:Available for design/marketing projects)', 'Which industries are you interested in?', 'Are you participating in-person or via zoom?'];
const emojiPrefix = /^[^\p{L}\p{N}]+\s*/u;
export const MATCH_COUNT = 3;
export const MATCH_THRESHOLD = 60;
const splitMulti = value => String(value || '').split(',').map(item => item.trim().replace(emojiPrefix, '')).filter(Boolean);
const words = value => new Set(String(value || '').toLowerCase().match(/[a-z]{3,}/g) || []);
const overlap = (left, right) => [...words(left)].filter(word => words(right).has(word));

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; }
    else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) { if (character === '\r' && text[index + 1] === '\n') index += 1; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += character;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function normalizeLinkedInUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase()) && url.pathname.startsWith('/in/') ? url.href : null;
  } catch { return null; }
}

export function parseLumaCsv(text) {
  const [headers, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
  const indexes = Object.fromEntries(headers.map((header, index) => [header.trim(), index]));
  const missing = requiredColumns.filter(column => indexes[column] === undefined);
  if (missing.length) throw new Error(`Missing required CSV columns: ${missing.join(', ')}`);
  return rows.map(cells => Object.fromEntries(headers.map((header, index) => [header.trim(), (cells[index] || '').trim()])))
    .filter(record => record.approval_status.toLowerCase() === 'approved')
    .map(record => ({
      id: `luma-${record.guest_id}`,
      name: record.name,
      email: record.email.toLowerCase(),
      heaMember: record['Are you a member of HEA?'] === 'Yes' ? 'Yes' : 'No',
      role: record['Which best describes you?'] || 'Other',
      linkedIn: normalizeLinkedInUrl(record['LinkedIn Profile']),
      connectGoals: splitMulti(record['What are you hoping to connect around?']),
      lookingFor: record['What are you looking for? (ex: Looking for a frontend developer)'],
      canOffer: record['What can you offer? (ex:Available for design/marketing projects)'],
      industries: splitMulti(record['Which industries are you interested in?']),
      attendance: /zoom/i.test(record['Are you participating in-person or via zoom?']) ? 'zoom' : 'in-person'
    })).filter(person => person.name && person.email);
}

export function emptyEnrichment() { return { headline: '', summary: '', experiences: [], profileImage: '', source: 'survey-only' }; }

export function buildIntegratedProfile(person, enrichment = emptyEnrichment()) {
  return { ...person, linkedInData: enrichment, matchingContext: { surveyWeight: 0.6, linkedinWeight: enrichment.source === 'apify' ? 0.4 : 0, survey: { industries: person.industries, goals: person.connectGoals, lookingFor: person.lookingFor, canOffer: person.canOffer }, linkedin: enrichment } };
}

export function localMatches(subject, candidates) {
  return candidates.filter(candidate => candidate.id !== subject.id).map(candidate => {
    const sharedIndustries = candidate.industries.filter(industry => subject.industries.includes(industry));
    const sharedGoals = candidate.connectGoals.filter(goal => subject.connectGoals.includes(goal));
    const complementary = [...new Set([...overlap(subject.lookingFor, candidate.canOffer), ...overlap(subject.canOffer, candidate.lookingFor)])];
    const linkedInOverlap = overlap(`${subject.linkedInData?.headline || ''} ${subject.linkedInData?.summary || ''}`, `${candidate.linkedInData?.headline || ''} ${candidate.linkedInData?.summary || ''}`);
    const surveyScore = Math.min(100, 45 + sharedIndustries.length * 16 + sharedGoals.length * 10 + complementary.length * 6 + (subject.role !== candidate.role ? 4 : 0));
    const linkedInScore = Math.min(100, 45 + linkedInOverlap.length * 10);
    const hasLinkedIn = subject.linkedInData?.source === 'apify' && candidate.linkedInData?.source === 'apify';
    const score = Math.round(Math.min(98, hasLinkedIn ? surveyScore * 0.6 + linkedInScore * 0.4 : surveyScore));
    const connection = sharedIndustries.length ? `You both care about ${sharedIndustries.slice(0, 2).join(' and ')}.` : `${candidate.name.split(' ')[0]} brings a complementary ${candidate.industries[0] || 'entrepreneurial'} perspective.`;
    return { participantId: candidate.id, score, reason: `${connection} Their offer of ${candidate.canOffer || 'community insight'} connects well with your interest in ${subject.lookingFor || 'building meaningful connections'}.`.slice(0, 400) };
  }).filter(match => match.score >= MATCH_THRESHOLD).sort((left, right) => right.score - left.score).slice(0, MATCH_COUNT);
}

export function validateMatches(subjectId, matches, candidateIds) {
  if (!Array.isArray(matches) || matches.length > MATCH_COUNT || new Set(matches.map(match => match.participantId)).size !== matches.length) throw new Error(`Invalid recommendations: expected up to ${MATCH_COUNT} unique matches.`);
  return matches.map(match => {
    const matchType = match.matchType || 'strong';
    const validType = ['strong', 'shared_luma_interest', 'complementary_ask_offer'].includes(matchType);
    const allowedBelowThreshold = matchType === 'shared_luma_interest' || matchType === 'complementary_ask_offer';
    if (!candidateIds.has(match.participantId) || match.participantId === subjectId || !Number.isInteger(match.score) || match.score < 0 || (!allowedBelowThreshold && match.score < MATCH_THRESHOLD) || match.score > 100 || !validType || typeof match.reason !== 'string' || match.reason.trim().length < 30 || match.reason.length > 400) throw new Error('Invalid recommendation returned by matcher.');
    return { participantId: match.participantId, score: match.score, reason: match.reason.trim(), matchType };
  }).sort((left, right) => right.score - left.score);
}
