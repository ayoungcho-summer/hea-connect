import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('renders the HEA name beside the header logo', async () => {
  const source = await readFile(new URL('./static-app-v3.jsx', import.meta.url), 'utf8');
  assert.match(source, /className="brand-name">HAAS ENTREPRENEURSHIP<br\s*\/>ASSOCIATION/);
});
