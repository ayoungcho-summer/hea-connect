import OpenAI from 'openai';
import { emptyEnrichment, localMatches, MATCH_COUNT, MATCH_THRESHOLD, validateMatches } from './matching-domain.mjs';

const text = value => typeof value === 'string' ? value.trim() : '';
const truncate = (value, max) => text(value).slice(0, max);
const experienceLabel = experience => {
  if (typeof experience === 'string') return truncate(experience, 160);
  const title = text(experience?.title || experience?.position || experience?.jobTitle);
  const company = text(experience?.companyName || experience?.company || experience?.company?.name);
  return [title, company].filter(Boolean).join(', ');
};

export function selectLinkedInFields(row) {
  const experiences = (row?.experiences || row?.experience || row?.positions || []).map(experienceLabel).filter(Boolean).slice(0, 5);
  return { headline: truncate(row?.headline || row?.occupation || row?.title, 300), summary: truncate(row?.summary || row?.about || row?.description, 1600), experiences, source: 'apify' };
}

export function createEnricher({ apify }) {
  return { async enrich(url) {
    if (!url) return emptyEnrichment();
    try {
      const profile = await apify.scrapeLinkedIn(url);
      const selected = selectLinkedInFields(profile);
      return selected.headline || selected.summary || selected.experiences.length ? selected : emptyEnrichment();
    } catch { return emptyEnrichment(); }
  }};
}

export function parseRecommendationOutput(output) {
  const cleaned = String(output).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed) ? parsed : (parsed.matches || parsed);
}

export function createApifyRestClient(token) {
  if (!token) return { scrapeLinkedIn: async () => { throw new Error('APIFY_TOKEN is not configured'); } };
  return { async scrapeLinkedIn(url) {
    const actor = 'harvestapi~linkedin-profile-scraper';
    const response = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileScraperMode: 'Profile details no email ($4 per 1k)', urls: [url] })
    });
    if (!response.ok) throw new Error(`Apify request failed (${response.status})`);
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows[0]) throw new Error('Apify returned no profile');
    return rows[0];
  }};
}

const rationaleFormat = { type: 'json_schema', name: 'networking_rationale', strict: true, schema: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', minLength: 50, maxLength: 400 } } } };
export const normalizeEvidence = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const evidenceFor = person => {
  // Every key in the response schema needs real source text. Survey-only attendees
  // legitimately lack LinkedIn fields, so their verified role is used as a factual
  // fallback instead of rejecting an otherwise valid recommendation batch.
  const fallback = person.role || 'HEA event attendee';
  return {
    need: person.lookingFor || fallback,
    offer: person.canOffer || fallback,
    goals: (person.connectGoals || []).join('; ') || fallback,
    industries: (person.industries || []).join('; ') || fallback,
    linkedinHeadline: person.linkedInData?.headline || fallback,
    linkedinSummary: person.linkedInData?.summary || fallback,
    experiences: (person.linkedInData?.experiences || []).join('; ') || fallback
  };
};
const profileForModel = person => ({ ...person, evidence: Object.fromEntries(Object.entries(evidenceFor(person)).filter(([, value]) => String(value || '').trim())) });
const askText = person => person.lookingFor || (person.connectGoals || []).join(' ');
const offerText = person => person.canOffer || '';
const linkedInText = person => [person.linkedInData?.headline, person.linkedInData?.summary, ...(person.linkedInData?.experiences || [])].filter(Boolean).join(' ');
const jaccard = (left, right) => {
  const leftSet = new Set(left || []); const rightSet = new Set(right || []);
  const union = new Set([...leftSet, ...rightSet]);
  return union.size ? [...leftSet].filter(value => rightSet.has(value)).length / union.size : 0;
};
const cosine = (left, right) => {
  if (!left || !right) return 0;
  let dot = 0; let leftMagnitude = 0; let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) { dot += left[index] * right[index]; leftMagnitude += left[index] ** 2; rightMagnitude += right[index] ** 2; }
  return leftMagnitude && rightMagnitude ? Math.max(0, dot / Math.sqrt(leftMagnitude * rightMagnitude)) : 0;
};
// Text-embedding cosine scores cluster well below 1 even for genuinely related
// profiles. Map the useful 0.10–0.60 range to 0–1 before applying the rubric's
// 30-point semantic components; otherwise a 60-point overall threshold rejects
// nearly every normal-language profile.
const calibratedSemanticSimilarity = (left, right) => Math.min(1, Math.max(0, (cosine(left, right) - 0.10) / 0.50));

export function createEmbeddingRanker({ openai }) {
  const vectors = new Map();
  const textFor = (person, field) => ({ ask: askText(person), offer: offerText(person), linkedIn: linkedInText(person) })[field];
  const vectorFor = (person, field) => vectors.get(`${person.id}:${field}`);
  return {
    async prepare(people) {
      const records = people.flatMap(person => ['ask', 'offer', 'linkedIn'].map(field => ({ key: `${person.id}:${field}`, text: textFor(person, field) })).filter(record => record.text));
      for (let start = 0; start < records.length; start += 100) {
        const batch = records.slice(start, start + 100);
        const response = await openai.embeddings.create({ model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input: batch.map(record => record.text) });
        response.data.forEach((item, index) => vectors.set(batch[index].key, item.embedding));
      }
    },
    rank(subject, candidates) {
      const ranked = candidates.map(candidate => {
        const askToLinkedInAvailable = Boolean(askText(subject) && linkedInText(candidate));
        const needToOfferAvailable = Boolean(subject.lookingFor && offerText(candidate));
        const sharedIndustries = (subject.industries || []).filter(industry => (candidate.industries || []).includes(industry));
        const sharedGoals = (subject.connectGoals || []).filter(goal => (candidate.connectGoals || []).includes(goal));
        const needToOfferSimilarity = calibratedSemanticSimilarity(vectorFor(subject, 'ask'), vectorFor(candidate, 'offer'));
        const components = [
          { weight: 30, active: askToLinkedInAvailable, value: calibratedSemanticSimilarity(vectorFor(subject, 'ask'), vectorFor(candidate, 'linkedIn')) },
          { weight: 30, active: needToOfferAvailable, value: needToOfferSimilarity },
          { weight: 20, active: Boolean(subject.industries?.length && candidate.industries?.length), value: jaccard(subject.industries, candidate.industries) },
          { weight: 20, active: Boolean(subject.connectGoals?.length && candidate.connectGoals?.length), value: jaccard(subject.connectGoals, candidate.connectGoals) }
        ];
        const activeWeight = components.filter(component => component.active).reduce((sum, component) => sum + component.weight, 0);
        const rawScore = components.reduce((sum, component) => sum + (component.active ? component.weight * component.value : 0), 0);
        // Survey-only profiles should be scored from the fields they actually supplied,
        // rather than being penalized solely for a missing LinkedIn record.
        const score = activeWeight ? Math.round(Math.min(98, rawScore * (100 / activeWeight))) : 0;
        const lumaBasis = sharedIndustries.length ? { matchType: 'shared_luma_interest', anchor: `Shared industry: ${sharedIndustries.join(', ')}` }
          : sharedGoals.length ? { matchType: 'shared_luma_interest', anchor: `Shared networking goal: ${sharedGoals.join(', ')}` }
            : needToOfferAvailable && needToOfferSimilarity >= 0.60 ? { matchType: 'complementary_ask_offer', anchor: 'A’s stated ask is meaningfully related to B’s stated offer.' }
              : null;
        return { participantId: candidate.id, score, lumaBasis };
      }).sort((left, right) => right.score - left.score);
      const strong = ranked.filter(match => match.score >= MATCH_THRESHOLD).map(match => ({ ...match, matchType: 'strong' }));
      const lumaFallback = ranked.filter(match => match.score < MATCH_THRESHOLD && match.lumaBasis).map(match => ({ ...match, matchType: match.lumaBasis.matchType }));
      return [...strong, ...lumaFallback].slice(0, MATCH_COUNT);
    }
  };
}

export function createMatcher({ openai, rankCandidates = null }) {
  return { async recommend(subject, candidates) {
    const selected = rankCandidates ? rankCandidates(subject, candidates) : localMatches(subject, candidates).map(match => ({ ...match, matchType: 'strong' }));
    const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const matches = [];
    for (const selectedMatch of selected) {
      const candidate = candidateById.get(selectedMatch.participantId);
      let rawOutput = '';
      try {
        const response = await openai.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', text: { format: rationaleFormat }, input: [
          { role: 'system', content: 'You are a warm, sharp startup event host introducing two attendees. Write a short, natural matching rationale (2–3 sentences) explaining why they should meet.\n\nTONE & STYLE GUIDELINES:\n- Write like a real human super-connector making a warm intro. Keep it casual, professional, and easy to read.\n- NEVER use stiff robotic templates (e.g., "User A brings X perspective, while User B brings Y perspective").\n- Use natural connecting phrases like "A great person to chat with...", "Feels like a natural match because...", or "They can easily swap notes on...".\n- Focus strictly on concrete details (e.g., "UC Berkeley ecosystem", "frontend architecture") without copying survey answers verbatim.\n- If their backgrounds are different, highlight the fun of sharing complementary perspectives (e.g., product strategy vs. technical scaling).\n\nFEW-SHOT EXAMPLES OF NATURAL RATIONALES:\n\nExample 1 (Direct Skill/Need Match):\n"Shirley is eager to tap into the local founder scene, and connecting with Ayoung offers direct insight into navigating the UC Berkeley startup ecosystem. They’ll easily find common ground discussing early-stage community building and founder resources."\n\nExample 2 (Complementary Match):\n"While Ayoung is focused on EdTech and Frances brings a strong finance background, their meeting is a great chance to cross-pollinate ideas. Frances’ experience with business monetization can offer Ayoung practical insights as she plans her early product roadmap."\n\nExample 3 (Peer Founder Match):\n"With both June and Alex building early-stage tech products, this is a solid peer match for sharing founder-level challenges. They can dive right into swapping strategies on initial hiring and managing tech stacks."' },
          { role: 'user', content: JSON.stringify({ userA: profileForModel(subject), userB: profileForModel(candidate), matchBasis: selectedMatch.lumaBasis?.anchor || 'Strong combined profile match' }) }
        ] });
        rawOutput = response.output_text;
        const result = parseRecommendationOutput(rawOutput);
        if (!result || typeof result.reason !== 'string' || result.reason.trim().length < 50) {
          console.error(`[Rationale validation failed] ${subject.id} -> ${candidate.id}. Raw OpenAI response:`, rawOutput);
          throw new Error('OpenAI returned an invalid rationale JSON payload.');
        }
        matches.push({ participantId: candidate.id, score: selectedMatch.score, reason: result.reason.trim(), matchType: selectedMatch.matchType });
      } catch (error) {
        console.error(`[Rationale generation failed] ${subject.id} -> ${candidate.id}. Raw OpenAI response: ${rawOutput}`, error);
        throw new Error(`Unable to generate rationale for ${subject.name} and ${candidate.name}: ${error.message}`);
      }
    }
    return validateMatches(subject.id, matches, new Set(candidates.map(candidate => candidate.id)));
  }};
}

export function createOpenAiClient(apiKey) { return apiKey ? new OpenAI({ apiKey, timeout: 60000, maxRetries: 1 }) : null; }
