import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/data/matches.json', import.meta.url);
const data = JSON.parse(await readFile(path, 'utf8'));
const invalid = /^(true|false|null|undefined|\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-\d{2})$/i;
for (const person of data.participants) person.experiences = person.experiences.map(value => String(value).split(',').map(part => part.trim()).filter(part => part && !invalid.test(part)).join(', ')).filter(Boolean);
await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
