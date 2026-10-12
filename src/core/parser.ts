// Reads the Markdown file of a board made with the community Kanban plugin.
// Pure module: works on the file text only, no dependency on Obsidian.
//
// Format summary (written by the Kanban plugin):
//   frontmatter with `kanban-plugin: board` (older boards: `basic`)
//   one heading per column, with an optional limit suffix: `## To do (5)`
//   an optional `**Complete**` line under the heading marks a "done" column
//   one list item per card, continuation lines indented
//   archive: a thematic break `***` followed by a heading (`## Archive`, translated)
//   settings: `%% kanban:settings` + a fenced JSON block + `%%` at the end of the file

export interface BoardSettings {
  dateTrigger: string;
  timeTrigger: string;
  dateFormat: string;
  timeFormat: string;
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  dateTrigger: '@',
  timeTrigger: '@@',
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
};

export interface RawCard {
  /** First line: text after the list marker and checkbox. Next lines: continuation lines, not yet dedented. */
  lines: string[];
  /** Character between the checkbox brackets, or null for a list item without checkbox. */
  checkChar: string | null;
  /** 1-based line number of the list item in the file. */
  line: number;
}

export interface RawLane {
  /** Heading text, without the limit suffix. May be empty. */
  title: string;
  /** Card limit from the `(N)` suffix, or null. */
  limit: number | null;
  /** True when the column is marked with `**Complete**`. */
  complete: boolean;
  cards: RawCard[];
  line: number;
}

export interface ParsedBoard {
  lanes: RawLane[];
  /** The archive section, or null when the board has none. */
  archive: RawLane | null;
  /** Cards placed above the first heading. The Kanban plugin does not show them. */
  looseCards: RawCard[];
  settings: BoardSettings;
  /** Number of non-blank lines outside cards that were skipped (text, code, comments). */
  ignoredLines: number;
  /** True when the settings block exists but its JSON cannot be read. */
  settingsUnreadable: boolean;
}

/** "Archive" and "Complete" in the languages the Kanban plugin translates them to. */
const ARCHIVE_TITLES = ['archive', 'archiv', 'archivio', 'arquivado', 'архивировать', '归档', 'アーカイブ', '보관됨'];
const COMPLETE_TITLES = ['complete', 'fertiggestellt', 'completato', 'concluído', 'выполнено', '完成', '完了', '완료됨'];

const FRONTMATTER_KEY = 'kanban-plugin';
const SETTING_KEYS: Record<string, keyof BoardSettings> = {
  'date-trigger': 'dateTrigger',
  'time-trigger': 'timeTrigger',
  'date-format': 'dateFormat',
  'time-format': 'timeFormat',
};

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const LIST_ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CHECKBOX = /^\[([^\]])\](?:[ \t]+(.*))?$/;
const BR = /<br\s*\/?>/gi;

/** Removes an optional pair of quotes around a frontmatter scalar. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

interface Frontmatter {
  end: number; // index of the first line after the frontmatter
  values: Map<string, string>;
}

function readFrontmatter(lines: string[]): Frontmatter | null {
  if (lines[0]?.trimEnd() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trimEnd();
    if (line === '---' || line === '...') {
      const values = new Map<string, string>();
      for (const entry of lines.slice(1, i)) {
        const match = /^([A-Za-z][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(entry);
        if (match?.[1] && match[2] !== undefined) values.set(match[1], unquote(match[2]));
      }
      return { end: i + 1, values };
    }
  }
  return null;
}

function splitLines(markdown: string): string[] {
  const text = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function isTruthyFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== 'null' && v !== '~';
}

/** True when the text is a board of the Kanban plugin (frontmatter key `kanban-plugin`). */
export function isKanbanBoard(markdown: string): boolean {
  const frontmatter = readFrontmatter(splitLines(markdown));
  return isTruthyFlag(frontmatter?.values.get(FRONTMATTER_KEY));
}

/** Reads the `%% kanban:settings` block. Returns the line index where it starts, or -1. */
function readSettingsBlock(lines: string[], from: number): { start: number; json: Record<string, unknown> | null } {
  for (let i = lines.length - 1; i >= from; i--) {
    if (/^%%[ \t]*kanban:settings/.test((lines[i] ?? '').trim())) {
      const block = lines.slice(i + 1);
      const open = block.findIndex((l) => /^`{3,}|^~{3,}/.test(l.trim()));
      const close = open < 0 ? -1 : block.findIndex((l, index) => index > open && /^`{3,}|^~{3,}/.test(l.trim()));
      if (open < 0 || close < 0) return { start: i, json: null };
      try {
        const parsed: unknown = JSON.parse(block.slice(open + 1, close).join('\n'));
        return { start: i, json: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null };
      } catch {
        return { start: i, json: null };
      }
    }
  }
  return { start: -1, json: null };
}

function applySettings(target: BoardSettings, source: Record<string, unknown> | Map<string, string>): void {
  const entries = source instanceof Map ? [...source.entries()] : Object.entries(source);
  for (const [name, value] of entries) {
    const field = SETTING_KEYS[name];
    if (field && typeof value === 'string' && value.trim() !== '') target[field] = value.trim();
  }
}

/** Column width of a line's leading whitespace, tabs counting to the next multiple of 4. */
export function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width++;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

const isBlank = (line: string): boolean => line.trim() === '';

type Block =
  | { type: 'heading'; text: string; line: number }
  | { type: 'break'; line: number }
  | { type: 'item'; card: RawCard }
  | { type: 'text'; text: string; line: number; count: number };

/** Splits the body into headings, thematic breaks, list items and other text. */
function tokenize(lines: string[], offset: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const lineNo = offset + i + 1;
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence?.[1]) {
      // Top-level code block: skipped as a whole.
      const marker = fence[1];
      let j = i + 1;
      while (j < lines.length && !(lines[j] ?? '').trim().startsWith(marker)) j++;
      const end = Math.min(j + 1, lines.length);
      blocks.push({ type: 'text', text: '', line: lineNo, count: lines.slice(i, end).filter((l) => !isBlank(l)).length });
      i = end;
      continue;
    }
    if (line.trim().startsWith('%%')) {
      // Obsidian comment: skipped until the closing %%.
      let j = i;
      const opensAndCloses = line.trim().length > 2 && line.trim().endsWith('%%');
      if (!opensAndCloses) {
        j = i + 1;
        while (j < lines.length && !(lines[j] ?? '').trim().endsWith('%%')) j++;
      }
      const end = Math.min(j + 1, lines.length);
      blocks.push({ type: 'text', text: '', line: lineNo, count: lines.slice(i, end).filter((l) => !isBlank(l)).length });
      i = end;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', text: (heading[2] ?? '').trim(), line: lineNo });
      i++;
      continue;
    }
    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ type: 'break', line: lineNo });
      i++;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const [, indent = '', marker = '', spaces = '', rest = ''] = item;
      const spaceWidth = spaces === '' ? 1 : indentWidth(spaces) > 4 ? 1 : indentWidth(spaces);
      const contentColumn = indent.length + marker.length + spaceWidth;
      const cardLines = [rest];
      let j = i + 1;
      let previousBlank = false;
      while (j < lines.length) {
        const next = lines[j] ?? '';
        if (isBlank(next)) {
          previousBlank = true;
          cardLines.push('');
          j++;
          continue;
        }
        const width = indentWidth(next);
        const continues =
          width >= contentColumn ||
          (!previousBlank && width < contentColumn && !LIST_ITEM.test(next) && !HEADING.test(next) && !THEMATIC_BREAK.test(next) && !FENCE.test(next) && !next.trim().startsWith('%%'));
        if (!continues) break;
        cardLines.push(next);
        previousBlank = false;
        j++;
      }
      while (cardLines.length > 1 && isBlank(cardLines[cardLines.length - 1] ?? '')) cardLines.pop();
      blocks.push({ type: 'item', card: toCard(cardLines, lineNo) });
      // Blank lines that ended the item stay unconsumed: the outer loop skips them.
      i = i + cardLines.length;
      continue;
    }
    blocks.push({ type: 'text', text: line.trim(), line: lineNo, count: 1 });
    i++;
  }
  return blocks;
}

function toCard(lines: string[], line: number): RawCard {
  const [first = '', ...rest] = lines;
  const checkbox = CHECKBOX.exec(first);
  if (checkbox) {
    return { lines: [checkbox[2] ?? '', ...rest], checkChar: checkbox[1] ?? ' ', line };
  }
  return { lines: [first, ...rest], checkChar: null, line };
}

function laneTitle(text: string): { title: string; limit: number | null } {
  const clean = text.replace(BR, ' ').replace(/\s+/g, ' ').trim();
  const match = /^(.*?)\s*\((\d+)\)$/.exec(clean);
  if (!match) return { title: clean, limit: null };
  return { title: (match[1] ?? '').trim(), limit: Number(match[2]) };
}

function isCompleteMarker(text: string): boolean {
  const inner = /^\*\*(.+)\*\*$/.exec(text)?.[1] ?? text;
  return COMPLETE_TITLES.includes(inner.trim().toLowerCase());
}

/**
 * Parses a Kanban board. Returns null when the text is not a board.
 * `globalSettings` are the Kanban plugin's own defaults, overridden by the board's settings.
 */
export function parseBoard(markdown: string, globalSettings: Record<string, unknown> = {}): ParsedBoard | null {
  const lines = splitLines(markdown);
  const frontmatter = readFrontmatter(lines);
  if (!frontmatter || !isTruthyFlag(frontmatter.values.get(FRONTMATTER_KEY))) return null;

  const settingsBlock = readSettingsBlock(lines, frontmatter.end);
  const settings: BoardSettings = { ...DEFAULT_BOARD_SETTINGS };
  applySettings(settings, globalSettings);
  if (settingsBlock.json) applySettings(settings, settingsBlock.json);
  applySettings(settings, frontmatter.values);

  const bodyEnd = settingsBlock.start >= 0 ? settingsBlock.start : lines.length;
  const blocks = tokenize(lines.slice(frontmatter.end, bodyEnd), frontmatter.end);

  const board: ParsedBoard = {
    lanes: [],
    archive: null,
    looseCards: [],
    settings,
    ignoredLines: 0,
    settingsUnreadable: settingsBlock.start >= 0 && settingsBlock.json === null,
  };

  const lastHeading = blocks.reduce((last, block, index) => (block.type === 'heading' ? index : last), -1);
  let current: RawLane | null = null;
  let previous: Block | null = null;

  blocks.forEach((block, index) => {
    switch (block.type) {
      case 'heading': {
        const afterBreak = previous?.type === 'break';
        const known = ARCHIVE_TITLES.includes(block.text.trim().toLowerCase());
        if (afterBreak && board.archive === null && (known || index === lastHeading)) {
          current = { title: block.text.replace(BR, ' ').trim(), limit: null, complete: false, cards: [], line: block.line };
          board.archive = current;
        } else {
          const { title, limit } = laneTitle(block.text);
          current = { title, limit, complete: false, cards: [], line: block.line };
          board.lanes.push(current);
        }
        break;
      }
      case 'item':
        if (current) current.cards.push(block.card);
        else board.looseCards.push(block.card);
        break;
      case 'text':
        if (current && current.cards.length === 0 && block.text !== '' && isCompleteMarker(block.text)) {
          current.complete = true;
        } else {
          board.ignoredLines += block.count;
        }
        break;
      case 'break':
        break;
    }
    previous = block;
  });

  return board;
}
