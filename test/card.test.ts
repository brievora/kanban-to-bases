import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCard, stripMarkdown } from '../src/core/card';
import type { CardContext } from '../src/core/card';
import { simpleParseDate, simpleParseTime } from '../src/core/dates';
import { DEFAULT_BOARD_SETTINGS } from '../src/core/parser';
import type { RawCard } from '../src/core/parser';

const context = (settings = {}): CardContext => ({
  settings: { ...DEFAULT_BOARD_SETTINGS, ...settings },
  parseDate: simpleParseDate,
  parseTime: simpleParseTime,
  reservedKeys: new Set(['status', 'position', 'due', 'done', 'tags', 'board', 'aliases']),
});

const card = (lines: string[], checkChar: string | null = ' '): RawCard => ({ lines, checkChar, line: 1 });

test('extracts date, time, tags and block id from the first line', () => {
  const info = analyzeCard(card(['Homepage design @{2026-10-12} @@{14:30} #design #client/acme ^b7k2p1']), context());
  assert.equal(info.title, 'Homepage design');
  assert.equal(info.due, '2026-10-12T14:30');
  assert.deepEqual(info.tags, ['design', 'client/acme']);
  assert.equal(info.blockId, 'b7k2p1');
  assert.equal(info.body, '');
  assert.equal(info.checked, false);
});

test('turns <br> and indented lines into a clean body', () => {
  const info = analyzeCard(
    card(['Write homepage copy @{2026-10-14}', '\tDraft the hero.<br>Keep it short.', '\t- point one', '\t\t- nested']),
    context(),
  );
  assert.equal(info.title, 'Write homepage copy');
  assert.equal(info.due, '2026-10-14');
  assert.equal(info.body, 'Draft the hero.\nKeep it short.\n- point one\n\t- nested');
});

test('splits a one-line card that uses <br> like older boards', () => {
  const info = analyzeCard(card(['Case study @[[2026-10-20]] #case-study<br>Ask Anna for a quote.<br>Add screenshots. ^cs01']), context());
  assert.equal(info.title, 'Case study');
  assert.equal(info.due, '2026-10-20');
  assert.equal(info.body, 'Ask Anna for a quote.\nAdd screenshots.');
  assert.equal(info.blockId, 'cs01');
});

test('reads a custom date trigger and format', () => {
  const info = analyzeCard(card(['Send invoice §{15/10/2026} ¤{9:05 pm}']), context({ dateTrigger: '§', timeTrigger: '¤', dateFormat: 'DD/MM/YYYY', timeFormat: 'h:mm a' }));
  assert.equal(info.due, '2026-10-15T21:05');
  assert.equal(info.title, 'Send invoice');
});

test('keeps dates written in body lines as plain text', () => {
  const info = analyzeCard(card(['Prepare launch', '\tCall the printer @{2026-10-09} at @@{10:00}']), context());
  assert.equal(info.due, '2026-10-09T10:00');
  assert.equal(info.body, 'Call the printer 2026-10-09 at 10:00');
});

test('leaves a date that does not match the format and reports it', () => {
  const info = analyzeCard(card(['Review @{next week}']), context());
  assert.equal(info.due, null);
  assert.equal(info.title, 'Review @{next week}');
  assert.deepEqual(info.issues, [{ kind: 'invalid-date', value: 'next week' }]);
});

test('reports a time without a date and keeps it in the text', () => {
  const info = analyzeCard(card(['Stand-up @@{09:30}']), context());
  assert.equal(info.due, null);
  assert.deepEqual(info.issues, [{ kind: 'time-without-date', value: '09:30' }]);
  assert.equal(info.title, 'Stand-up');
  assert.equal(info.body, '09:30');
});

test('reads the due date of the Tasks plugin', () => {
  const info = analyzeCard(card(['Renew domain \u{1F4C5} 2026-11-02']), context());
  assert.equal(info.due, '2026-11-02');
  assert.equal(info.title, 'Renew domain');
});

test('ignores tags and dates inside code', () => {
  const info = analyzeCard(card(['Launch post `#not-a-tag` @{2026-10-02}', '\t```', '\tssh deploy@staging #nope @{2026-01-01}', '\t```']), context());
  assert.deepEqual(info.tags, []);
  assert.equal(info.due, '2026-10-02');
  assert.equal(info.title, 'Launch post #not-a-tag');
  assert.equal(info.body, '```\nssh deploy@staging #nope @{2026-01-01}\n```');
});

test('does not read numbers, headings links or URLs as tags', () => {
  const info = analyzeCard(card(['Fix issue #12 in [[Notes#Bugs]] see https://example.com/#top #bug']), context());
  assert.deepEqual(info.tags, ['bug']);
});

test('moves inline fields to properties, except reserved names', () => {
  const info = analyzeCard(
    card(['Oakline Studio [source:: referral] #warm', '\tbudget:: 3500', '\tcontact:: [[Anna Keller]]', '\tstatus:: hot', '\tFirst call went well.']),
    context(),
  );
  assert.deepEqual(info.fields, [
    ['source', 'referral'],
    ['budget', '3500'],
    ['contact', '[[Anna Keller]]'],
  ]);
  assert.equal(info.title, 'Oakline Studio');
  assert.equal(info.body, 'status:: hot\nFirst call went well.');
});

test('detects a card that only links to a note', () => {
  assert.deepEqual(analyzeCard(card(['[[Client brief]]']), context()).link, { target: 'Client brief' });
  assert.deepEqual(analyzeCard(card(['[[Clients/Acme|Acme Inc.]] #client']), context()).link, { target: 'Clients/Acme' });
  assert.deepEqual(analyzeCard(card(['[[Brief#Scope]]']), context()).link, { target: 'Brief' });
  assert.deepEqual(analyzeCard(card(['[Brief](Projects/Brief%20v2.md)']), context()).link, { target: 'Projects/Brief v2' });
  assert.equal(analyzeCard(card(['Read [[Client brief]] first']), context()).link, null);
  assert.equal(analyzeCard(card(['![[diagram.png]]']), context()).link, null);
  assert.equal(analyzeCard(card(['[Site](https://example.com)']), context()).link, null);
});

test('marks first lines that hold links, and strips Markdown from the title', () => {
  const info = analyzeCard(card(['Export logo files for [[Brand guidelines|the guidelines]] **now**']), context());
  assert.equal(info.title, 'Export logo files for the guidelines now');
  assert.equal(info.firstLineHasLinks, true);
  assert.equal(stripMarkdown('Launch _italic_ and *em* ~~old~~ ==mark== <b>bold</b> [site](https://x.y) ![img](a.png)'), 'Launch italic and em old mark bold site');
  assert.equal(stripMarkdown('snake_case_name stays'), 'snake_case_name stays');
});

test('treats any checkbox character other than a space as checked', () => {
  assert.equal(analyzeCard(card(['Done'], 'x'), context()).checked, true);
  assert.equal(analyzeCard(card(['Cancelled'], '-'), context()).checked, true);
  assert.equal(analyzeCard(card(['Open'], ' '), context()).checked, false);
  assert.equal(analyzeCard(card(['No box'], null), context()).checked, false);
});

test('gives an empty title to an empty card or a card made of tags only', () => {
  assert.equal(analyzeCard(card(['']), context()).title, '');
  const tagsOnly = analyzeCard(card(['#idea #later']), context());
  assert.equal(tagsOnly.title, '');
  assert.deepEqual(tagsOnly.tags, ['idea', 'later']);
});
