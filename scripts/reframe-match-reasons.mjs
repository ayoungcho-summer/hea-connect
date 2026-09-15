import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/data/matches.json', import.meta.url);
const data = JSON.parse(await readFile(path, 'utf8'));
const people = new Map(data.participants.map(person => [person.id, person]));
const short = text => String(text || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '').slice(0, 180);
const cleanOffer = value => short(value)
  .replace(/^I(?:'m| am) happy to offer\s*/i, '')
  .replace(/^I can (?:help with|offer)\s*/i, '')
  .replace(/^Available for\s*/i, '')
  .replace(/^Expertise in\s*/i, '')
  .replace(/^Looking for\s*/i, '');
const cleanNeed = value => short(value)
  .replace(/^Target Persona:\s*/i, '')
  .replace(/^Looking for\s*/i, '');

for (const subject of data.participants) {
  data.matchesByParticipantId[subject.id] = data.matchesByParticipantId[subject.id].map(match => {
    const candidate = people.get(match.participantId);
    const experience = short(candidate.experiences?.[0] || candidate.headline || candidate.role);
    const need = cleanNeed(subject.lookingFor || subject.industries?.[0] || 'building meaningful connections');
    const offer = cleanOffer(candidate.canOffer || candidate.lookingFor || 'their relevant perspective');
    const firstName = candidate.name.split(/\s+/)[0];
    return { ...match, reason: `You’re looking for ${need}. ${firstName} brings experience as ${experience} and can share perspective on ${offer}. Start by comparing how that experience could help move your next step forward.`.slice(0, 400) };
  });
}

await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Reframed ${data.participants.length * 5} user-centered match reasons.`);
