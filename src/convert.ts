// Applies a conversion plan to the vault, and undoes it.
// The original board is never modified.

import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { Plan } from './core/plan';

export interface ChangedKey {
  key: string;
  /** False when the property did not exist before the conversion. */
  existed: boolean;
  previous: unknown;
  written: unknown;
}

export interface LinkedChange {
  path: string;
  keys: ChangedKey[];
}

/** What the last conversion created or changed, kept in the plugin data for undo. */
export interface ConversionManifest {
  boardPath: string;
  boardName: string;
  date: number;
  /** Notes and base, in creation order. */
  createdFiles: string[];
  /** Folders created for the conversion, parents first. */
  createdFolders: string[];
  linked: LinkedChange[];
}

export class ConversionError extends Error {
  constructor(
    readonly original: unknown,
    readonly manifest: ConversionManifest,
  ) {
    super(original instanceof Error ? original.message : String(original));
  }
}

export interface UndoResult {
  removed: number;
  missing: number;
  restored: number;
  kept: number;
}

/** Plain copy of a frontmatter value (strings, numbers, lists, objects). */
function copy(value: unknown): unknown {
  return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function ensureFolder(app: App, folder: string, created: string[]): Promise<void> {
  if (folder === '') return;
  let path = '';
  for (const segment of folder.split('/')) {
    path = path === '' ? segment : `${path}/${segment}`;
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) continue;
    if (existing) throw new Error(`"${path}" is a file, not a folder`);
    await app.vault.createFolder(path);
    created.push(path);
  }
}

export async function applyPlan(app: App, plan: Plan, boardPath: string): Promise<{ manifest: ConversionManifest; base: TFile }> {
  const manifest: ConversionManifest = {
    boardPath,
    boardName: plan.boardName,
    date: Date.now(),
    createdFiles: [],
    createdFolders: [],
    linked: [],
  };
  try {
    await ensureFolder(app, plan.folder, manifest.createdFolders);

    for (const note of plan.notes) {
      await app.vault.create(note.path, note.content);
      manifest.createdFiles.push(note.path);
    }

    for (const link of plan.links) {
      const file = app.vault.getFileByPath(link.path);
      if (!file) continue;
      const change: LinkedChange = { path: link.path, keys: [] };
      manifest.linked.push(change);
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        change.keys = [];
        for (const [key, value] of Object.entries(link.values)) {
          const existed = Object.prototype.hasOwnProperty.call(frontmatter, key);
          change.keys.push({ key, existed, previous: existed ? copy(frontmatter[key]) : null, written: value });
          frontmatter[key] = value;
        }
      });
    }

    const base = await app.vault.create(plan.base.path, plan.base.content);
    manifest.createdFiles.push(plan.base.path);
    return { manifest, base };
  } catch (error) {
    throw new ConversionError(error, manifest);
  }
}

export async function undoConversion(app: App, manifest: ConversionManifest): Promise<UndoResult> {
  const result: UndoResult = { removed: 0, missing: 0, restored: 0, kept: 0 };

  for (const path of [...manifest.createdFiles].reverse()) {
    const file = app.vault.getFileByPath(path);
    if (file) {
      await app.fileManager.trashFile(file);
      result.removed++;
    } else {
      result.missing++;
    }
  }

  for (const change of manifest.linked) {
    const file = app.vault.getFileByPath(change.path);
    if (!(file instanceof TFile)) {
      result.missing++;
      continue;
    }
    let restored = false;
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      for (const entry of change.keys) {
        // A value edited since the conversion belongs to the user now: keep it.
        if (!sameValue(frontmatter[entry.key], entry.written)) {
          result.kept++;
          continue;
        }
        if (entry.existed) frontmatter[entry.key] = entry.previous;
        else delete frontmatter[entry.key];
        restored = true;
      }
    });
    if (restored) result.restored++;
  }

  for (const path of [...manifest.createdFolders].reverse()) {
    const folder = app.vault.getFolderByPath(path);
    if (folder && folder.children.length === 0) await app.fileManager.trashFile(folder);
  }

  return result;
}

/** Validates data read back from data.json. */
export function readManifest(value: unknown): ConversionManifest | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Partial<ConversionManifest>;
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every((p) => typeof p === 'string');
  if (typeof m.boardPath !== 'string' || typeof m.boardName !== 'string' || typeof m.date !== 'number') return null;
  if (!strings(m.createdFiles) || !strings(m.createdFolders) || !Array.isArray(m.linked)) return null;
  const linked = m.linked.filter(
    (c): c is LinkedChange => !!c && typeof c.path === 'string' && Array.isArray(c.keys) && c.keys.every((k) => typeof k?.key === 'string'),
  );
  return { ...m, linked } as ConversionManifest;
}
