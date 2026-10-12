import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isKanbanBoard, parseBoard } from '../src/core/parser';

const fixture = (name: string): string => readFileSync(`test/fixtures/${name}`, 'utf8');

test('recognizes a board by its kanban-plugin frontmatter key', () => {
  assert.equal(isKanbanBoard(fixture('website.md')), true);
  assert.equal(isKanbanBoard('---\nkanban-plugin: basic\n---\n\n## To do\n'), true);
  assert.equal(isKanbanBoard('---\ntags: [work]\n---\n\n## To do\n\n- [ ] Task\n'), false);
  assert.equal(isKanbanBoard('## To do\n\n- [ ] Task\n'), false);
  assert.equal(isKanbanBoard('---\nkanban-plugin: false\n---\n'), false);
  assert.equal(parseBoard('# A plain note\n\nSome text.\n'), null);
});

test('reads columns, limits, complete marker and archive', () => {
  const board = parseBoard(fixture('website.md'));
  assert.ok(board);
  assert.deepEqual(
    board.lanes.map((l) => [l.title, l.limit, l.complete, l.cards.length]),
    [
      ['Backlog', 6, false, 4],
      ['In progress', null, false, 2],
      ['Review', null, false, 2],
      ['Done', null, true, 2],
    ],
  );
  assert.ok(board.archive);
  assert.equal(board.archive.title, 'Archive');
  assert.equal(board.archive.cards.length, 1);
  assert.equal(board.looseCards.length, 0);
  assert.equal(board.ignoredLines, 0);
  assert.equal(board.settingsUnreadable, false);
});

test('keeps checkbox state, continuation lines and source line numbers', () => {
  const board = parseBoard(fixture('website.md'));
  assert.ok(board);
  const [backlog, inProgress, review] = board.lanes;
  assert.ok(backlog && inProgress && review);
  assert.equal(backlog.cards[1]?.lines.length, 2);
  assert.equal(backlog.cards[1]?.line, 10);
  assert.equal(review.cards[1]?.checkChar, 'x');
  assert.equal(review.cards[0]?.checkChar, ' ');
  // Nested list and fenced code belong to their card.
  assert.equal(inProgress.cards[0]?.lines.length, 3);
  assert.equal(inProgress.cards[1]?.lines.length, 4);
});

test('reads board settings, frontmatter wins over the settings block', () => {
  const board = parseBoard(fixture('pipeline.md'));
  assert.ok(board);
  assert.equal(board.settings.dateFormat, 'DD.MM.YYYY');
  assert.equal(board.settings.dateTrigger, '@');

  const custom = parseBoard(
    '---\nkanban-plugin: board\ndate-trigger: "§"\n---\n\n## A\n\n- [ ] Card §{2026-10-12}\n\n%% kanban:settings\n```\n{"kanban-plugin":"board","date-trigger":"!","time-format":"h:mm a"}\n```\n%%\n',
  );
  assert.ok(custom);
  assert.equal(custom.settings.dateTrigger, '§');
  assert.equal(custom.settings.timeFormat, 'h:mm a');

  const global = parseBoard('---\nkanban-plugin: board\n---\n\n## A\n', { 'date-format': 'DD/MM/YYYY' });
  assert.equal(global?.settings.dateFormat, 'DD/MM/YYYY');
});

test('reports a settings block that cannot be read', () => {
  const board = parseBoard('---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] Card\n\n%% kanban:settings\n```\n{not json\n```\n%%\n');
  assert.equal(board?.settingsUnreadable, true);
  assert.equal(board?.lanes[0]?.cards.length, 1);
});

test('handles an empty board and an empty column', () => {
  const empty = parseBoard('---\n\nkanban-plugin: board\n\n---\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%\n');
  assert.ok(empty);
  assert.equal(empty.lanes.length, 0);
  assert.equal(empty.archive, null);

  const content = parseBoard(fixture('content.md'));
  assert.ok(content);
  assert.deepEqual(
    content.lanes.map((l) => [l.title, l.cards.length]),
    [
      ['Ideas', 7],
      ['Writing', 1],
      ['Scheduled', 0],
      ['Published', 1],
    ],
  );
  // A list item without checkbox is still a card.
  assert.equal(content.lanes[0]?.cards[6]?.checkChar, null);
});

test('detects a translated archive heading, and any heading after the last break', () => {
  const german = parseBoard('---\nkanban-plugin: board\n---\n\n## Offen\n\n- [ ] A\n\n***\n\n## Archiv\n\n- [x] B\n');
  assert.equal(german?.archive?.title, 'Archiv');
  assert.equal(german?.lanes.length, 1);

  const custom = parseBoard('---\nkanban-plugin: board\n---\n\n## Open\n\n- [ ] A\n\n***\n\n## Old stuff\n\n- [x] B\n');
  assert.equal(custom?.archive?.title, 'Old stuff');

  const notArchive = parseBoard('---\nkanban-plugin: board\n---\n\n## One\n\n***\n\n## Two\n\n- [ ] A\n\n## Three\n');
  assert.equal(notArchive?.archive, null);
  assert.equal(notArchive?.lanes.length, 3);
});

test('collects cards above the first column and counts skipped text', () => {
  const board = parseBoard(
    '---\nkanban-plugin: board\n---\n\n- [ ] Floating card\n\nSome paragraph.\n\n## A\n\nA note under the heading.\n\n- [ ] Card\n\n```\ncode\n```\n',
  );
  assert.ok(board);
  assert.equal(board.looseCards.length, 1);
  assert.equal(board.lanes[0]?.cards.length, 1);
  assert.equal(board.ignoredLines, 5);
});

test('accepts Windows line endings and a byte order mark', () => {
  const text = '\u{FEFF}---\r\nkanban-plugin: board\r\n---\r\n\r\n## To do\r\n\r\n- [ ] First\r\n- [ ] Second\r\n';
  const board = parseBoard(text);
  assert.equal(board?.lanes[0]?.cards.length, 2);
  assert.equal(board?.lanes[0]?.cards[1]?.lines[0], 'Second');
});
