// Turns the raw text of one card into a title, a note body and metadata.
// Pure module: no dependency on Obsidian.

import type { DateParser, TimeParser } from './dates';
import type { BoardSettings, RawCard } from './parser';
import { indentWidth } from './parser';

export interface CardLink {
  /** Link target as written, without heading, block reference or alias. */
  target: string;
}

export interface CardIssue {
  kind: 'invalid-date' | 'time-without-date';
  value: string;
}

export interface CardInfo {
  /** Readable title from the first line: Markdown removed, not yet a valid file name. */
  title: string;
  /** First line with its Markdown kept and the metadata removed. */
  firstLine: string;
  /** True when the first line holds links or embeds that a file name cannot keep. */
  firstLineHasLinks: boolean;
  /** Note body: the other lines of the card, cleaned. */
  body: string;
  /** Due date as YYYY-MM-DD or YYYY-MM-DDTHH:mm. */
  due: string | null;
  tags: string[];
  /** Inline fields (`key:: value`) moved to properties, in order of appearance. */
  fields: Array<[string, string]>;
  blockId: string | null;
  /** Set when the card only holds a link to a note. */
  link: CardLink | null;
  checked: boolean;
  issues: CardIssue[];
}

export interface CardContext {
  settings: BoardSettings;
  parseDate: DateParser;
  parseTime: TimeParser;
  /** Lowercase property names that inline fields must not overwrite. */
  reservedKeys: Set<string>;
}

interface Edit {
  start: number;
  end: number;
  /** Replacement on the first line (metadata removed). */
  title: string;
  /** Replacement on other lines (metadata kept as plain text). */
  body: string;
}

const BR = /<br\s*\/?>/gi;
const FENCE = /^\s*(`{3,}|~{3,})/;
// Tag terminators, as in the Kanban plugin: whitespace and ASCII or general punctuation, except - _ /.
const TAG = /(^|\s)#([^\s\u{2000}-\u{206F}\u{2E00}-\u{2E7F}'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\]+)/gu;
const BLOCK_ID = /(^|\s)\^([A-Za-z0-9-]+)\s*$/;
const FIELD_KEY = /^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u;
const LINE_FIELD = /^([\p{L}\p{N}_][\p{L}\p{N}_ -]*?)\s*::\s*(.*)$/u;
const BRACKET_FIELD = /\[([^[\]():]+?)::([^\]]*)\]|\(([^[\]():]+?)::([^)]*)\)/g;
const TASKS_DUE = /(^|\s)(?:\u{1F4C5}|\u{1F4C6}|\u{1F5D3}\u{FE0F}?) *(\d{4}-\d{2}-\d{2})/gu;
const WIKILINK_ONLY = /^\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]$/;
const MDLINK_ONLY = /^\[[^\]]*\]\(([^)\s]+)\)$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces inline code spans with placeholder characters of the same length. */
function maskCode(line: string): string {
  return line.replace(/`[^`]*`/g, (span) => '\u0001'.repeat(span.length));
}

function applyEdits(line: string, edits: Edit[], which: 'title' | 'body'): string {
  let out = line;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit[which] + out.slice(edit.end);
  }
  return out;
}

function overlaps(edits: Edit[], start: number, end: number): boolean {
  return edits.some((e) => start < e.end && end > e.start);
}

function linkText(inner: string): string {
  const [target = '', alias] = inner.split('|');
  if (alias !== undefined && alias.trim() !== '') return alias.trim();
  const name = target.split('/').pop() ?? target;
  return name.replace(/\.md$/i, '').replace(/[#^]+/g, ' ').trim();
}

/** Plain text of a Markdown line, for titles. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => linkText(inner))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~|==)/g, '')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~=])/g, '$1')
    .replace(/^\s*(?:[>]\s*)+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Removes the common indentation of continuation lines (Kanban indents them with a tab or 4 spaces). */
function dedent(lines: string[]): string[] {
  const widths = lines.filter((l) => l.trim() !== '').map(indentWidth).filter((w) => w > 0);
  if (widths.length === 0) return lines;
  const remove = Math.min(...widths);
  return lines.map((line) => {
    let width = 0;
    let index = 0;
    while (index < line.length && width < remove) {
      const char = line[index];
      if (char === ' ') width++;
      else if (char === '\t') width += 4 - (width % 4);
      else break;
      index++;
    }
    // A tab that went past the indentation to remove leaves its extra columns as spaces.
    return ' '.repeat(Math.max(0, width - remove)) + line.slice(index);
  });
}

function parseLinkTarget(text: string): CardLink | null {
  const wiki = WIKILINK_ONLY.exec(text);
  if (wiki?.[1]) return { target: wiki[1].trim() };
  const md = MDLINK_ONLY.exec(text);
  if (md?.[1] && !/^[a-z][a-z0-9+.-]*:/i.test(md[1])) {
    let target = md[1];
    try {
      target = decodeURIComponent(target);
    } catch {
      // Keep the raw target when it is not valid percent-encoding.
    }
    target = target.replace(/#.*$/, '');
    if (/\.md$/i.test(target)) return { target: target.replace(/\.md$/i, '') };
  }
  return null;
}

export function analyzeCard(card: RawCard, context: CardContext): CardInfo {
  const { settings, parseDate, parseTime, reservedKeys } = context;
  const [firstRaw = '', ...restRaw] = card.lines;
  // <br> splits a line in two, like the Kanban plugin does.
  const lines = [firstRaw, ...dedent(restRaw)].flatMap((line) => line.split(BR)).map((l) => l.replace(/\s+$/, ''));
  const titleIndex = lines.findIndex((l) => l.trim() !== '');

  const info: CardInfo = {
    title: '',
    firstLine: '',
    firstLineHasLinks: false,
    body: '',
    due: null,
    tags: [],
    fields: [],
    blockId: null,
    link: null,
    checked: card.checkChar !== null && card.checkChar !== ' ',
    issues: [],
  };

  const trigger = escapeRegExp(settings.dateTrigger);
  const timeTrigger = escapeRegExp(settings.timeTrigger);
  const dateBrace = new RegExp(`(^|\\s)${trigger}\\{([^}\\n]+)\\}`, 'g');
  const dateWiki = new RegExp(`(^|\\s)${trigger}\\[\\[([^\\]\\n]+)\\]\\]`, 'g');
  const dateMd = new RegExp(`(^|\\s)${trigger}\\[([^\\]\\n]+)\\]\\(([^)\\n]+)\\)`, 'g');
  const timeBrace = new RegExp(`(^|\\s)${timeTrigger}\\{([^}\\n]+)\\}`, 'g');

  // Written from the regex callbacks below; an object keeps TypeScript from narrowing them to null.
  const found: { date: string | null; time: string | null } = { date: null, time: null };
  const pendingTimes: Array<{ value: string; inTitle: boolean }> = [];
  const tags = new Set<string>();
  const fieldKeys = new Set<string>();
  const output: string[] = [];
  let inFence = false;

  const addField = (rawKey: string, rawValue: string): boolean => {
    const name = rawKey.trim();
    const lower = name.toLowerCase();
    if (!FIELD_KEY.test(name) || reservedKeys.has(lower) || fieldKeys.has(lower)) return false;
    fieldKeys.add(lower);
    info.fields.push([name, rawValue.trim()]);
    return true;
  };

  lines.forEach((line, index) => {
    const isTitle = index === titleIndex;
    if (FENCE.test(line)) {
      inFence = !inFence;
      if (!isTitle) output.push(line);
      return;
    }
    if (inFence) {
      output.push(line);
      return;
    }

    // Whole-line inline field (Dataview style): moved to properties.
    const lineField = LINE_FIELD.exec(line.trim());
    if (!isTitle && lineField?.[1] !== undefined && addField(lineField[1], lineField[2] ?? '')) return;

    const masked = maskCode(line);
    const edits: Edit[] = [];
    const run = (regex: RegExp, handle: (match: RegExpExecArray, start: number, end: number) => void): void => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(masked)) !== null) {
        const lead = match[1] ?? '';
        const start = match.index + lead.length;
        const end = match.index + match[0].length;
        if (!overlaps(edits, start, end)) handle(match, start, end);
        if (match[0].length === 0) regex.lastIndex++;
      }
    };

    // Longer trigger first, so that @@{time} is not read as a date when triggers overlap.
    const readTime = (): void =>
      run(timeBrace, (m, start, end) => {
        const value = (m[2] ?? '').trim();
        const parsed = parseTime(value, settings.timeFormat);
        if (!parsed) return;
        found.time ??= parsed;
        pendingTimes.push({ value, inTitle: isTitle });
        edits.push({ start, end, title: '', body: value });
      });
    const readDates = (): void => {
      run(dateBrace, (m, start, end) => {
        const value = (m[2] ?? '').trim();
        const parsed = parseDate(value, settings.dateFormat);
        if (!parsed) {
          info.issues.push({ kind: 'invalid-date', value });
          return;
        }
        found.date ??= parsed;
        edits.push({ start, end, title: '', body: value });
      });
      run(dateWiki, (m, start, end) => {
        const inner = (m[2] ?? '').trim();
        const target = (inner.split('|')[0] ?? '').split('/').pop() ?? '';
        const parsed = parseDate(target.replace(/\.md$/i, '').trim(), settings.dateFormat);
        if (!parsed) {
          info.issues.push({ kind: 'invalid-date', value: inner });
          return;
        }
        found.date ??= parsed;
        edits.push({ start, end, title: '', body: `[[${inner}]]` });
      });
      run(dateMd, (m, start, end) => {
        const label = (m[2] ?? '').trim();
        const parsed = parseDate(label, settings.dateFormat);
        if (!parsed) {
          info.issues.push({ kind: 'invalid-date', value: label });
          return;
        }
        found.date ??= parsed;
        edits.push({ start, end, title: '', body: `[${label}](${m[3] ?? ''})` });
      });
    };
    if (settings.timeTrigger.length >= settings.dateTrigger.length) {
      readTime();
      readDates();
    } else {
      readDates();
      readTime();
    }

    run(TASKS_DUE, (m, start, end) => {
      const parsed = parseDate(m[2] ?? '', 'YYYY-MM-DD');
      if (!parsed) return;
      found.date ??= parsed;
      // Tasks plugin syntax stays in the body, where it still means something.
      edits.push({ start, end, title: '', body: line.slice(start, end) });
    });

    run(TAG, (m, start, end) => {
      const tag = m[2] ?? '';
      if (/^\d+$/.test(tag)) return; // "#12" is a number, not a tag, in Obsidian.
      tags.add(tag);
      edits.push({ start, end, title: '', body: line.slice(start, end) });
    });

    BRACKET_FIELD.lastIndex = 0;
    let field: RegExpExecArray | null;
    while ((field = BRACKET_FIELD.exec(masked)) !== null) {
      const name = field[1] ?? field[3] ?? '';
      const value = field[2] ?? field[4] ?? '';
      const start = field.index;
      const end = start + field[0].length;
      if (!overlaps(edits, start, end) && addField(name, value)) edits.push({ start, end, title: '', body: '' });
    }

    const blockId = BLOCK_ID.exec(masked);
    if (blockId) {
      info.blockId ??= blockId[2] ?? null;
      const start = blockId.index + (blockId[1] ?? '').length;
      if (!overlaps(edits, start, line.length)) edits.push({ start, end: line.length, title: '', body: '' });
    }

    if (isTitle) {
      const firstLine = applyEdits(line, edits, 'title').replace(/\s+/g, ' ').trim();
      const field = LINE_FIELD.exec(firstLine);
      if (field?.[1] !== undefined && addField(field[1], field[2] ?? '')) {
        info.firstLine = '';
      } else {
        info.firstLine = firstLine;
      }
    } else {
      output.push(applyEdits(line, edits, 'body').replace(/[ \t]+$/, ''));
    }
  });

  // A time without a date stays as text: it cannot become a due date on its own. A time taken out of the first
  // line (the note name) goes to the top of the body, so it is not lost.
  if (found.time !== null && found.date === null) {
    for (const t of pendingTimes) info.issues.push({ kind: 'time-without-date', value: t.value });
    const fromTitle = pendingTimes.filter((t) => t.inTitle).map((t) => t.value);
    if (fromTitle.length > 0) output.unshift(fromTitle.join(' '));
  }
  if (found.date !== null) info.due = found.time !== null ? `${found.date}T${found.time}` : found.date;

  info.tags = [...tags];
  info.link = parseLinkTarget(info.firstLine);
  info.firstLineHasLinks = /!?\[\[[^\]]+\]\]|!?\[[^\]]*\]\([^)]*\)/.test(info.firstLine);
  info.title = stripMarkdown(info.firstLine);

  while (output.length > 0 && (output[0] ?? '').trim() === '') output.shift();
  while (output.length > 0 && (output[output.length - 1] ?? '').trim() === '') output.pop();
  info.body = output.join('\n');
  return info;
}
