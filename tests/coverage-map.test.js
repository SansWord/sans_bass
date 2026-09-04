import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

function behaviourRows(markdown) {
  let section = '';
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) section = line.slice(3).trim();
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|/);
    const id = match?.[1].trim();
    if (!match || !/^[A-Z]+\d+[a-z]?$/.test(id)) continue;
    rows.push({ section, id });
  }
  return rows;
}

function coverageRows(markdown) {
  return markdown.split('\n').flatMap((line) => {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/);
    const section = match?.[1].trim();
    if (!match || section === 'Section' || /^[-: ]+$/.test(section)) return [];
    return [{ section, id: match[2].trim(), line }];
  });
}

describe('behaviour coverage inventory', () => {
  it('maps each of the 255 baseline rows exactly once by section and old ID', () => {
    const baseline = behaviourRows(fs.readFileSync(path.join(ROOT, 'docs/behaviour.md'), 'utf8'));
    const mapped = coverageRows(fs.readFileSync(path.join(ROOT, 'docs/test-coverage.md'), 'utf8'));
    expect(baseline).toHaveLength(255);
    expect(mapped.map(({ section, id }) => `${section}\0${id}`).sort())
      .toEqual(baseline.map(({ section, id }) => `${section}\0${id}`).sort());
  });

  it('references automated test files that exist', () => {
    const markdown = fs.readFileSync(path.join(ROOT, 'docs/test-coverage.md'), 'utf8');
    const references = [...markdown.matchAll(/`(tests\/[^`#]+\.test\.js)(?:#[^`]*)?`/g)]
      .map((match) => match[1]);
    for (const reference of references) {
      expect(fs.existsSync(path.join(ROOT, reference)), reference).toBe(true);
    }
  });
});
