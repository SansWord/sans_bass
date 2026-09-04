import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

function behaviourRows(markdown) {
  let section = '';
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) section = line.slice(3).trim();
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|/);
    const id = match?.[1].trim();
    if (!match || !/^[A-Z]+(?:-\d+|\d+[a-z]?)$/.test(id)) continue;
    rows.push({ section, id });
  }
  return rows;
}

function coverageRows(markdown) {
  return markdown.split('\n').flatMap((line) => {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/);
    const section = match?.[1].trim();
    if (!match || section === 'Section' || /^[-: ]+$/.test(section)) return [];
    const canonical = line.match(/^\|[^|]+\|[^|]+\|\s*`([^`]+)`\s*\|/)?.[1];
    return [{ section, id: match[2].trim(), canonical, line }];
  });
}

describe('behaviour coverage inventory', () => {
  it('preserves the immutable 255-row baseline inventory exactly', () => {
    const mapped = coverageRows(fs.readFileSync(path.join(ROOT, 'docs/test-coverage.md'), 'utf8'));
    expect(mapped).toHaveLength(255);
    const digest = crypto.createHash('sha256')
      .update(JSON.stringify(mapped.map(({ section, id }) => [section, id])))
      .digest('hex');
    expect(digest).toBe('be2c6acbcc0b3804b6b62dbde181b71e372b760539c056223a06f1ac1bb958ad');
  });

  it('maps every old row to one globally unique retained scenario', () => {
    const scenarios = behaviourRows(fs.readFileSync(path.join(ROOT, 'docs/behaviour.md'), 'utf8'))
      .map(({ id }) => id);
    expect(new Set(scenarios).size).toBe(scenarios.length);
    const mapped = coverageRows(fs.readFileSync(path.join(ROOT, 'docs/test-coverage.md'), 'utf8'));
    for (const row of mapped) expect(scenarios, `${row.section} / ${row.id}`).toContain(row.canonical);
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
