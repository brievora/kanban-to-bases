// Builds the conversion plan: which notes to create, which linked notes to update,
// and the content of the .base file. Pure module: the vault is reached through callbacks.

import { buildBase } from './base';
import { analyzeCard } from './card';
import type { CardInfo } from './card';
import type { DateParser, TimeParser } from './dates';
import { NameRegistry, toFileName } from './names';
import type { ParsedBoard, RawCard } from './parser';
import { stringify } from './yaml';
import type { YamlMap, YamlValue } from './yaml';

export interface PropertyNames {
  status: string;
  position: string;
  due: string;
  done: string;
  tags: string;
  board: string;
}

export interface PlanOptions {
  boardName: string;
  boardPath: string;
  /** Destination folder, '' for the vault root. Already normalized. */
  folder: string;
  props: PropertyNames;
  includeArchive: boolean;
  updateLinkedNotes: boolean;
  /** Column for cards placed above the first heading. */
  defaultColumn: string;
  columnWidth: number;
  labels: { untitledCard: string; untitledColumn: string; boardView: string; tableView: string };
  /** Names (with extension) of the files already in the destination folder. */
  existingNames: Iterable<string>;
  /** Path of the existing file a link points to (a note or any other file), or null. */
  resolveLink: (target: string) => string | null;
  /** Current properties of an existing note, to show what a linked note loses. */
  readProperties?: (path: string) => Record<string, unknown> | null;
  parseDate: DateParser;
  parseTime: TimeParser;
}

export interface PlannedNote {
  path: string;
  name: string;
  status: string;
  content: string;
  line: number;
}

export interface PlannedLink {
  path: string;
  target: string;
  status: string;
  /** Properties to set on the linked note. */
  values: Record<string, string | number>;
  /** Column the linked note had before, when the conversion changes it. */
  previousStatus: string | null;
  line: number;
}

export interface PlannedColumn {
  name: string;
  cards: number;
  complete: boolean;
  archive: boolean;
}

export type Warning =
  | { kind: 'renamed'; from: string; to: string }
  | { kind: 'duplicate-column'; from: string; to: string }
  | { kind: 'link-missing'; target: string; name: string }
  | { kind: 'link-duplicate'; target: string }
  | { kind: 'link-extra-lines'; target: string }
  | { kind: 'link-overwrite'; target: string; property: string; from: string; to: string }
  | { kind: 'link-not-copied'; target: string }
  | { kind: 'links-unchanged'; count: number }
  | { kind: 'invalid-date'; card: string; value: string }
  | { kind: 'time-without-date'; card: string; value: string }
  | { kind: 'loose-cards'; count: number; column: string }
  | { kind: 'ignored-lines'; count: number }
  | { kind: 'settings-unreadable' };

export interface Plan {
  boardName: string;
  folder: string;
  columns: PlannedColumn[];
  notes: PlannedNote[];
  links: PlannedLink[];
  base: { path: string; content: string };
  archiveCards: number;
  totalCards: number;
  warnings: Warning[];
}

/** Property names Obsidian gives a meaning to, never overwritten by inline fields. */
const OBSIDIAN_KEYS = ['tags', 'aliases', 'cssclasses', 'tag', 'alias', 'cssclass'];

function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

/** Inline field values: numbers stay numbers, everything else is text. A value that would not read back the same
 * as a number (01234, 1.10) stays text, so no digit is lost. */
function fieldValue(value: string): YamlValue {
  return /^-?\d+(?:\.\d+)?$/.test(value) && value.length < 16 && String(Number(value)) === value ? Number(value) : value;
}

interface Group {
  status: string;
  complete: boolean;
  archive: boolean;
  cards: RawCard[];
}

export function buildPlan(board: ParsedBoard, options: PlanOptions): Plan {
  const { props, labels } = options;
  const warnings: Warning[] = [];
  const propNames = [props.status, props.position, props.due, props.done, props.tags, props.board];
  const reservedKeys = new Set([...propNames, ...OBSIDIAN_KEYS].map((k) => k.toLowerCase()));
  const context = { settings: board.settings, parseDate: options.parseDate, parseTime: options.parseTime, reservedKeys };

  // Column names become the values of the status property: they must be unique and not empty.
  const statuses = new NameRegistry();
  const groups: Group[] = [];
  const claimStatus = (title: string): string => {
    const wanted = title === '' ? labels.untitledColumn : title;
    const status = statuses.claim(wanted);
    if (status !== wanted) warnings.push({ kind: 'duplicate-column', from: wanted, to: status });
    return status;
  };

  for (const lane of board.lanes) {
    groups.push({ status: claimStatus(lane.title), complete: lane.complete, archive: false, cards: [...lane.cards] });
  }
  if (board.looseCards.length > 0) {
    const column = options.defaultColumn.trim() === '' ? labels.untitledColumn : options.defaultColumn.trim();
    const existing = groups.find((g) => g.status.toLowerCase() === column.toLowerCase());
    if (existing) existing.cards.push(...board.looseCards);
    else groups.unshift({ status: statuses.claim(column), complete: false, archive: false, cards: [...board.looseCards] });
    warnings.push({ kind: 'loose-cards', count: board.looseCards.length, column: existing?.status ?? column });
  }
  if (board.archive && options.includeArchive) {
    groups.push({ status: claimStatus(board.archive.title), complete: false, archive: true, cards: [...board.archive.cards] });
  }

  const noteNames = new NameRegistry(
    [...options.existingNames].filter((n) => n.toLowerCase().endsWith('.md')).map((n) => n.slice(0, -3)),
  );
  const notes: PlannedNote[] = [];
  const links: PlannedLink[] = [];
  const linkedPaths = new Set<string>();
  let unchangedLinks = 0;

  const frontmatter = (status: string, position: number, info: CardInfo, done: boolean): YamlMap => {
    const map: YamlMap = { [props.status]: status, [props.position]: position };
    if (info.due) map[props.due] = { raw: info.due };
    map[props.done] = done;
    if (info.tags.length > 0) map[props.tags] = info.tags;
    map[props.board] = options.boardName;
    for (const [name, value] of info.fields) map[name] = fieldValue(value);
    return map;
  };

  const addNote = (wantedName: string, status: string, map: YamlMap, body: string, line: number): void => {
    const name = noteNames.claim(wantedName);
    if (name !== wantedName) warnings.push({ kind: 'renamed', from: wantedName, to: name });
    const content = `---\n${stringify(map)}---\n${body === '' ? '' : `${body}\n`}`;
    notes.push({ path: joinPath(options.folder, `${name}.md`), name, status, content, line });
  };

  for (const group of groups) {
    group.cards.forEach((card, index) => {
      const position = index + 1;
      const info = analyzeCard(card, context);
      const label = info.title === '' ? labels.untitledCard : info.title;
      for (const issue of info.issues) warnings.push({ kind: issue.kind, card: label, value: issue.value });
      const done = info.checked || group.complete;

      if (info.link) {
        const target = info.link.target;
        const path = options.resolveLink(target);
        if (path !== null && path.toLowerCase().endsWith('.md') && path !== options.boardPath) {
          if (info.body !== '') warnings.push({ kind: 'link-extra-lines', target });
          if (!options.updateLinkedNotes) {
            unchangedLinks++;
            return;
          }
          if (linkedPaths.has(path)) {
            warnings.push({ kind: 'link-duplicate', target });
            return;
          }
          linkedPaths.add(path);
          // What the linked note had before: shown in the preview, given back by undo.
          const current = options.readProperties?.(path) ?? null;
          const text = (value: unknown): string | null => {
            if (value === undefined || value === null || value === '') return null;
            return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
          };
          const before = text(current?.[props.status]);
          const previousStatus = before !== null && before !== group.status ? before : null;
          if (previousStatus !== null) warnings.push({ kind: 'link-overwrite', target, property: props.status, from: previousStatus, to: group.status });
          const otherBoard = text(current?.[props.board]);
          if (otherBoard !== null && otherBoard !== options.boardName) {
            warnings.push({ kind: 'link-overwrite', target, property: props.board, from: otherBoard, to: options.boardName });
          }
          if (info.due !== null || info.tags.length > 0 || info.fields.length > 0) warnings.push({ kind: 'link-not-copied', target });
          links.push({
            path,
            target,
            status: group.status,
            values: { [props.status]: group.status, [props.position]: position, [props.board]: options.boardName },
            previousStatus,
            line: card.line,
          });
          return;
        }
        const base = target.split('/').pop() ?? target;
        if (path === null) {
          // Link to a note that does not exist yet: create it under that name, so the link resolves.
          const { name } = toFileName(base, labels.untitledCard);
          warnings.push({ kind: 'link-missing', target, name });
          addNote(name, group.status, frontmatter(group.status, position, info, done), info.body, card.line);
          return;
        }
        // Link to a file that is not a note (a PDF, an image) or to the board itself: the card becomes a note named
        // after the file, with the link at the top, so nothing points to a note that should not exist.
        const { name } = toFileName(base.replace(/\.[^.]+$/, ''), labels.untitledCard);
        const body = [info.firstLine, info.body].filter((part) => part !== '').join('\n\n');
        addNote(name, group.status, frontmatter(group.status, position, info, done), body, card.line);
        return;
      }

      const { name, truncated } = toFileName(info.title, labels.untitledCard);
      // Keep the full first line in the note when the file name cannot hold it all.
      const keepFirstLine = (truncated || info.firstLineHasLinks) && info.firstLine !== '';
      const body = keepFirstLine ? [info.firstLine, info.body].filter((p) => p !== '').join('\n\n') : info.body;
      addNote(name, group.status, frontmatter(group.status, position, info, done), body, card.line);
    });
  }

  if (unchangedLinks > 0) warnings.push({ kind: 'links-unchanged', count: unchangedLinks });
  if (board.ignoredLines > 0) warnings.push({ kind: 'ignored-lines', count: board.ignoredLines });
  if (board.settingsUnreadable) warnings.push({ kind: 'settings-unreadable' });

  const baseNames = new NameRegistry(
    [...options.existingNames].filter((n) => n.toLowerCase().endsWith('.base')).map((n) => n.slice(0, -5)),
  );
  // The base is named after the board file, even when the board property needs a longer, unique value.
  const boardFile = (options.boardPath.split('/').pop() ?? '').replace(/\.md$/i, '') || options.boardName;
  const baseName = baseNames.claim(toFileName(boardFile, labels.untitledCard).name);
  const base = {
    path: joinPath(options.folder, `${baseName}.base`),
    content: buildBase({
      boardName: options.boardName,
      props,
      columns: groups.map((g) => g.status),
      columnWidth: options.columnWidth,
      boardView: labels.boardView,
      tableView: labels.tableView,
    }),
  };

  return {
    boardName: options.boardName,
    folder: options.folder,
    columns: groups.map((g) => ({ name: g.status, cards: g.cards.length, complete: g.complete, archive: g.archive })),
    notes,
    links,
    base,
    archiveCards: board.archive?.cards.length ?? 0,
    totalCards: board.lanes.reduce((n, l) => n + l.cards.length, 0) + board.looseCards.length,
    warnings,
  };
}
