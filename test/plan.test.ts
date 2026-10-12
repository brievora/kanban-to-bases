import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { simpleParseDate, simpleParseTime } from '../src/core/dates';
import { toFileName } from '../src/core/names';
import { parseBoard } from '../src/core/parser';
import { buildPlan } from '../src/core/plan';
import type { Plan, PlanOptions } from '../src/core/plan';

const fixture = (name: string): string => readFileSync(`test/fixtures/${name}`, 'utf8');

const PROPS = { status: 'status', position: 'position', due: 'due', done: 'done', tags: 'tags', board: 'board' };

function options(overrides: Partial<PlanOptions> = {}): PlanOptions {
  return {
    boardName: 'Website redesign',
    boardPath: 'Projects/Website redesign.md',
    folder: 'Projects/Website redesign',
    props: PROPS,
    includeArchive: false,
    updateLinkedNotes: true,
    defaultColumn: 'Inbox',
    columnWidth: 260,
    labels: { untitledCard: 'Untitled card', untitledColumn: 'Untitled column', boardView: 'Board', tableView: 'All cards' },
    existingNames: [],
    resolveLink: (target) => (['Client brief', 'Brand guidelines', "Lena's Bakery"].includes(target) ? `Notes/${target}.md` : null),
    parseDate: simpleParseDate,
    parseTime: simpleParseTime,
    ...overrides,
  };
}

function plan(file: string, overrides: Partial<PlanOptions> = {}): Plan {
  const board = parseBoard(fixture(file));
  assert.ok(board);
  return buildPlan(board, options(overrides));
}

/** Frontmatter and body of a planned note. */
function readNote(content: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)---\n([\s\S]*)$/.exec(content);
  assert.ok(match, `not a note with frontmatter:\n${content}`);
  return { data: parse(match[1] ?? '') as Record<string, unknown>, body: match[2] ?? '' };
}

const note = (p: Plan, name: string) => {
  const found = p.notes.find((n) => n.name === name);
  assert.ok(found, `no note named ${name}, got ${p.notes.map((n) => n.name).join(', ')}`);
  return readNote(found.content);
};

test('creates one note per card, with properties in board order', () => {
  const p = plan('website.md');
  assert.equal(p.totalCards, 10);
  assert.equal(p.notes.length, 9); // one card links to an existing note
  assert.deepEqual(p.links.map((l) => [l.path, l.status, l.values.position]), [['Notes/Client brief.md', 'Backlog', 3]]);

  const homepage = note(p, 'Homepage design');
  assert.deepEqual(homepage.data, {
    status: 'In progress',
    position: 1,
    due: '2026-10-12T14:30',
    done: false,
    tags: ['design'],
    board: 'Website redesign',
  });
  assert.equal(homepage.body, '- Desktop first\n- Mobile breakpoints at 768px\n');
  assert.deepEqual(Object.keys(homepage.data), ['status', 'position', 'due', 'done', 'tags', 'board']);
});

test('marks cards of a complete column as done and keeps inline fields', () => {
  const p = plan('website.md');
  const contract = note(p, 'Contract signed');
  assert.equal(contract.data.done, true);
  assert.equal(contract.data.budget, 4800);
  assert.equal(contract.body, '');
  assert.equal(note(p, 'Kick-off call').data.due, '2026-10-01');
});

test('renames duplicate titles and cleans forbidden characters', () => {
  const p = plan('website.md');
  assert.ok(p.notes.some((n) => n.name === 'Homepage design (2)'));
  assert.ok(p.warnings.some((w) => w.kind === 'renamed' && w.from === 'Homepage design' && w.to === 'Homepage design (2)'));
  const sitemap = note(p, 'Sitemap pages & URLs');
  assert.deepEqual(sitemap.data.tags, ['seo']);

  const content = plan('content.md', { boardName: 'Content calendar', folder: 'Content' });
  assert.ok(content.notes.some((n) => n.name === 'Q4 plan what-why'));
  assert.ok(content.notes.some((n) => n.name === 'Newsletter (2)'));
});

test('keeps the full first line in the body when the title is cut or holds links', () => {
  const content = plan('content.md', { boardName: 'Content calendar', folder: 'Content' });
  const long = content.notes.find((n) => n.name.startsWith('How I price'));
  assert.ok(long);
  assert.ok(Array.from(long.name).length <= 100);
  assert.match(readNote(long.content).body, /before the first invoice is sent/);

  const p = plan('website.md');
  const logo = note(p, 'Export logo files for the guidelines');
  assert.equal(logo.body, 'Export logo files for [[Brand guidelines|the guidelines]]\n');
  assert.equal(logo.data.done, true);
});

test('names empty cards and cards without text, and keeps plain list items', () => {
  const content = plan('content.md', { boardName: 'Content calendar', folder: 'Content' });
  assert.ok(content.notes.some((n) => n.name === 'Untitled card'));
  assert.ok(content.notes.some((n) => n.name === 'Untitled card (2)'));
  assert.ok(content.notes.some((n) => n.name === 'Plain list item without a checkbox'));
  assert.deepEqual(note(content, 'Untitled card').data.tags, ['idea', 'later']);
  assert.equal(note(content, 'Case study Oakline portfolio').data.due, '2026-10-20');
});

test('avoids names already taken in the destination folder, without case', () => {
  const p = plan('website.md', { existingNames: ['kick-off call.md', 'Website redesign.base'] });
  assert.ok(p.notes.some((n) => n.name === 'Kick-off call (2)'));
  assert.equal(p.base.path, 'Projects/Website redesign/Website redesign (2).base');
});

test('includes the archive only when asked', () => {
  const without = plan('website.md');
  assert.equal(without.archiveCards, 1);
  assert.ok(!without.columns.some((c) => c.archive));
  assert.ok(!without.notes.some((n) => n.name === 'Old moodboard'));

  const withArchive = plan('website.md', { includeArchive: true });
  assert.deepEqual(withArchive.columns.at(-1), { name: 'Archive', cards: 1, complete: false, archive: true });
  assert.equal(note(withArchive, 'Old moodboard').data.status, 'Archive');
  assert.equal(note(withArchive, 'Old moodboard').data.done, true);
});

test('handles linked notes: existing, missing, duplicate, or left unchanged', () => {
  const p = plan('pipeline.md', { boardName: 'Lead pipeline', folder: 'Sales' });
  assert.deepEqual(p.links.map((l) => l.path), ["Notes/Lena's Bakery.md"]);
  assert.ok(p.warnings.some((w) => w.kind === 'link-missing' && w.target === 'Missing prospect'));
  const missing = note(p, 'Missing prospect');
  assert.equal(missing.data.status, 'Contacted');
  assert.equal(missing.data.position, 2);

  const unchanged = plan('pipeline.md', { boardName: 'Lead pipeline', folder: 'Sales', updateLinkedNotes: false });
  assert.equal(unchanged.links.length, 0);
  assert.ok(unchanged.warnings.some((w) => w.kind === 'links-unchanged' && w.count === 1));

  const board = parseBoard('---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] [[Client brief]]\n- [ ] [[Client brief]]\n\t\tmore text\n');
  assert.ok(board);
  const dup = buildPlan(board, options());
  assert.equal(dup.links.length, 1);
  assert.ok(dup.warnings.some((w) => w.kind === 'link-duplicate'));
  assert.ok(dup.warnings.some((w) => w.kind === 'link-extra-lines'));
});

test('reads the custom date format of the pipeline board', () => {
  const p = plan('pipeline.md', { boardName: 'Lead pipeline', folder: 'Sales' });
  assert.equal(note(p, 'Helvetia Shop, online store').data.due, '2026-10-20');
  assert.equal(note(p, 'Booking app for Nordlicht Yoga').data.due, '2026-10-28T09:00');
  const oakline = note(p, 'Oakline Studio, portfolio site');
  assert.equal(oakline.data.source, 'referral');
  assert.equal(oakline.data.budget, 3500);
  assert.equal(oakline.data.contact, '[[Anna Keller]]');
  assert.equal(note(p, 'Rebrand for Atlas Legal').data.done, true);
  assert.equal(note(p, 'Rebrand for Atlas Legal').body, 'Chose a bigger agency.\n');
});

test('puts cards above the first column in the default column', () => {
  const board = parseBoard('---\nkanban-plugin: board\n---\n\n- [ ] Floating\n\n## To do\n\n- [ ] A\n');
  assert.ok(board);
  const p = buildPlan(board, options());
  assert.deepEqual(p.columns.map((c) => c.name), ['Inbox', 'To do']);
  const merged = buildPlan(board, options({ defaultColumn: 'to do' }));
  assert.deepEqual(merged.columns.map((c) => [c.name, c.cards]), [['To do', 2]]);
  assert.equal(readNote(merged.notes[1]?.content ?? '').data.position, 2);
});

test('renames duplicate and empty column names', () => {
  const board = parseBoard('---\nkanban-plugin: board\n---\n\n## Doing\n\n- [ ] A\n\n## Doing\n\n- [ ] B\n\n##\n\n- [ ] C\n');
  assert.ok(board);
  const p = buildPlan(board, options());
  assert.deepEqual(p.columns.map((c) => c.name), ['Doing', 'Doing (2)', 'Untitled column']);
  assert.ok(p.warnings.some((w) => w.kind === 'duplicate-column'));
});

test('converts an empty board to a base with no cards', () => {
  const board = parseBoard('---\n\nkanban-plugin: board\n\n---\n\n');
  assert.ok(board);
  const p = buildPlan(board, options());
  assert.equal(p.notes.length, 0);
  assert.equal(p.columns.length, 0);
  const base = parse(p.base.content) as { views: Array<{ groupOrder: string[] }> };
  assert.deepEqual(base.views[0]?.groupOrder, []);
});

test('writes notes at the vault root when the folder is empty', () => {
  const p = plan('website.md', { folder: '' });
  assert.equal(p.base.path, 'Website redesign.base');
  assert.ok(p.notes.every((n) => !n.path.includes('/')));
});

test('makes valid file names', () => {
  assert.deepEqual(toFileName('  ..Hidden: a/b\\c *?"<>| #tag [x] ^id. ', 'X'), { name: 'Hidden a-b-c tag x id', truncated: false });
  assert.equal(toFileName('CON', 'X').name, 'CON_');
  assert.equal(toFileName('', 'Untitled').name, 'Untitled');
  const long = toFileName('word '.repeat(40), 'X');
  assert.equal(long.truncated, true);
  assert.ok(long.name.length <= 100 && !long.name.endsWith(' '));
  assert.equal(Array.from(toFileName('\u{1F600}'.repeat(120), 'X').name).length, 100);
});

test('keeps inline field values that only look like numbers as text', () => {
  const board = parseBoard('---\n\nkanban-plugin: board\n\n---\n\n## To do\n\n- [ ] Client file\n\tzip:: 01234\n\tversion:: 1.10\n\thours:: 12\n\trate:: 1.5\n\tgap:: -3\n');
  assert.ok(board);
  const data = note(buildPlan(board, options()), 'Client file').data;
  assert.equal(data.zip, '01234');
  assert.equal(data.version, '1.10');
  assert.equal(data.hours, 12);
  assert.equal(data.rate, 1.5);
  assert.equal(data.gap, -3);
});

test('a card that only links to an existing file that is not a note, or to the board, keeps its link', () => {
  const board = parseBoard('---\n\nkanban-plugin: board\n\n---\n\n## To do\n\n- [ ] [[spec.pdf]]\n- [ ] [[Website redesign]]\n');
  assert.ok(board);
  const files: Record<string, string> = { 'spec.pdf': 'Docs/spec.pdf', 'Website redesign': 'Projects/Website redesign.md' };
  const p = buildPlan(board, options({ resolveLink: (target) => files[target] ?? null }));
  assert.equal(p.links.length, 0);
  assert.ok(!p.warnings.some((w) => w.kind === 'link-missing'), JSON.stringify(p.warnings));
  const spec = note(p, 'spec');
  assert.equal(spec.body, '[[spec.pdf]]\n');
  assert.equal(note(p, 'Website redesign').body, '[[Website redesign]]\n');
});

test('shows what a linked note had before and what the card does not copy to it', () => {
  const board = parseBoard('---\n\nkanban-plugin: board\n\n---\n\n## Doing\n\n- [ ] [[Client brief]] #urgent @{2026-10-14}\n- [ ] [[Brand guidelines]]\n');
  assert.ok(board);
  const props: Record<string, Record<string, unknown>> = {
    'Notes/Client brief.md': { status: 'In progress', board: 'Other board' },
    'Notes/Brand guidelines.md': { status: 'Doing' },
  };
  const p = buildPlan(board, options({ readProperties: (path) => props[path] ?? null }));
  const brief = p.links.find((l) => l.target === 'Client brief');
  assert.equal(brief?.previousStatus, 'In progress');
  assert.equal(p.links.find((l) => l.target === 'Brand guidelines')?.previousStatus, null);
  assert.ok(p.warnings.some((w) => w.kind === 'link-overwrite' && w.property === 'status' && w.from === 'In progress' && w.to === 'Doing'));
  assert.ok(p.warnings.some((w) => w.kind === 'link-overwrite' && w.property === 'board' && w.from === 'Other board'));
  assert.ok(p.warnings.some((w) => w.kind === 'link-not-copied' && w.target === 'Client brief'));
  assert.ok(!p.warnings.some((w) => w.kind === 'link-not-copied' && w.target === 'Brand guidelines'));
});

test('names the base after the board file when the board value is longer', () => {
  const p = plan('website.md', { boardName: 'Website redesign (Projects)' });
  assert.equal(p.base.path, 'Projects/Website redesign/Website redesign.base');
  assert.ok(p.base.content.includes('Website redesign (Projects)'));
  assert.ok(p.notes.every((n) => readNote(n.content).data.board === 'Website redesign (Projects)'));
});
