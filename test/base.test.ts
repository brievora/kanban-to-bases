import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { buildBase, expressionProperty, expressionString } from '../src/core/base';
import { quoteDouble, quoteSingle, scalar, stringify } from '../src/core/yaml';

const PROPS = { status: 'status', position: 'position', due: 'due', done: 'done', tags: 'tags', board: 'board' };

interface BaseFile {
  filters: { and: string[] };
  views: Array<Record<string, unknown>>;
}

test('writes a base with a native Kanban view and a table', () => {
  const text = buildBase({
    boardName: 'Website redesign',
    props: PROPS,
    columns: ['To do', 'Doing', 'Done'],
    columnWidth: 260,
    boardView: 'Board',
    tableView: 'All cards',
  });
  const base = parse(text) as BaseFile;
  assert.deepEqual(base, {
    filters: { and: ['board == "Website redesign"'] },
    views: [
      {
        type: 'kanban',
        name: 'Board',
        groupBy: { property: 'status', direction: 'ASC' },
        groupOrder: ['To do', 'Doing', 'Done'],
        columnWidth: 260,
        order: ['file.name', 'due', 'tags'],
        sort: [{ property: 'position', direction: 'ASC' }],
      },
      {
        type: 'table',
        name: 'All cards',
        order: ['file.name', 'status', 'due', 'done', 'tags'],
        sort: [
          { property: 'status', direction: 'ASC' },
          { property: 'position', direction: 'ASC' },
        ],
      },
    ],
  });
  assert.match(text, /^ {4}- 'board == "Website redesign"'$/m);
});

test('escapes quotes, colons and other YAML characters in names', () => {
  const names = ["Lena's bakery", 'Q4: "plan" #1', 'yes', '2026', '- dash', 'a\\b', 'Ünïcödé 日本', 'tab\there', 'line\nbreak'];
  const text = buildBase({ boardName: names[1] ?? '', props: PROPS, columns: names, columnWidth: 300, boardView: 'Tableau', tableView: 'Toutes les cartes' });
  const base = parse(text) as BaseFile;
  assert.deepEqual(base.views[0]?.groupOrder, names);
  assert.equal(base.filters.and[0], 'board == "Q4: \\"plan\\" #1"');
});

test('uses bracket access for property names that are not identifiers', () => {
  assert.equal(expressionProperty('board'), 'board');
  assert.equal(expressionProperty('kanban board'), 'note["kanban board"]');
  assert.equal(expressionProperty('due-date'), 'note["due-date"]');
  assert.equal(expressionString('say "hi" \\ bye'), '"say \\"hi\\" \\\\ bye"');
  const text = buildBase({
    boardName: 'B',
    props: { ...PROPS, board: 'kanban board', status: 'column name' },
    columns: ['A'],
    columnWidth: 260,
    boardView: 'Board',
    tableView: 'All',
  });
  const base = parse(text) as BaseFile;
  assert.equal(base.filters.and[0], 'note["kanban board"] == "B"');
  assert.deepEqual(base.views[0]?.groupBy, { property: 'column name', direction: 'ASC' });
});

test('round-trips scalars through a YAML parser', () => {
  const values = ['plain', 'Lena\'s', 'a: b', 'a #b', '#tag', 'true', 'No', '~', 'null', '12', '1.5', '0x1F', '1_000', '2026-10-12', ' padded ', '', '[x]', '{x}', '*star', '&amp', '!bang', '%pct', '@at', '`tick`', '"quoted"', "it's \"both\"", 'é', '\u{2028}'];
  for (const value of values) {
    const doc = stringify({ key: value, list: [value] });
    assert.deepEqual(parse(doc), { key: value, list: [value] }, doc);
  }
  assert.equal(scalar(3), '3');
  assert.equal(scalar(false), 'false');
  assert.equal(scalar({ raw: '2026-10-12' }), '2026-10-12');
  assert.equal(quoteSingle("it's"), "'it''s'");
  assert.equal(quoteDouble('a"b'), '"a\\"b"');
  assert.equal(stringify({ 'needs: quote': 1, list: [] }), '"needs: quote": 1\nlist: []\n');
});
