import { FileView, moment, normalizePath, Notice, Plugin, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type { DateParser, TimeParser } from './core/dates';
import { parseBoard } from './core/parser';
import type { Plan } from './core/plan';
import { applyPlan, ConversionError, readManifest, undoConversion } from './convert';
import type { ConversionManifest } from './convert';
import { t } from './i18n';
import { DEFAULT_SETTINGS, KanbanToBasesSettingTab, sanitizeSettings } from './settings';
import type { KanbanToBasesSettings } from './settings';
import { PreviewModal } from './ui/preview-modal';
import { SuccessModal } from './ui/success-modal';
import { UndoModal } from './ui/undo-modal';

/** Frontmatter key that marks a board of the community Kanban plugin. */
const BOARD_KEY = 'kanban-plugin';

/** Views that show a note in a tab: the editor, and the board view of the Kanban plugin (not the side panels). */
const BOARD_VIEWS = new Set(['markdown', 'kanban']);

interface StoredData {
  settings?: unknown;
  lastConversion?: unknown;
}

/** Dates and times are read with Obsidian's moment.js, like the Kanban plugin does. */
const parseDate: DateParser = (text, format) => {
  const strict = moment(text, format, true);
  const parsed = strict.isValid() ? strict : moment(text, format);
  if (!parsed.isValid() || parsed.year() < 1900 || parsed.year() > 2200) return null;
  return parsed.format('YYYY-MM-DD');
};

/** Usual ways of writing a time, tried after the board format. Strict reading only: a loose reading took 2pm for 02:00. */
const TIME_FORMATS = ['HH:mm', 'H:mm', 'h:mm a', 'h:mma', 'h a', 'ha', 'HH[h]mm', 'H[h]mm', 'H[h]'];

const parseTime: TimeParser = (text, format) => {
  const parsed = moment(text, [format, ...TIME_FORMATS], true);
  return parsed.isValid() ? parsed.format('HH:mm') : null;
};

export default class KanbanToBasesPlugin extends Plugin {
  settings: KanbanToBasesSettings = { ...DEFAULT_SETTINGS };
  lastConversion: ConversionManifest | null = null;
  /** Header buttons of the views that show a board. */
  private readonly headerButtons = new Map<FileView, HTMLElement>();

  async onload(): Promise<void> {
    await this.loadState();
    const s = t();

    this.addCommand({
      id: 'convert-board',
      name: s.commandConvert,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isBoard(file)) return false;
        if (!checking) void this.openPreview(file);
        return true;
      },
    });

    this.addCommand({
      id: 'undo-last-conversion',
      name: s.commandUndo,
      checkCallback: (checking) => {
        if (!this.lastConversion) return false;
        if (!checking) this.confirmUndo();
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile) || !this.isBoard(file)) return;
        menu.addItem((item) =>
          item
            .setTitle(s.menuConvert)
            .setIcon('square-kanban')
            .onClick(() => void this.openPreview(file)),
        );
      }),
    );

    // Button in the header of a board, the shortest way to convert it.
    const refresh = () => this.refreshHeaderButtons();
    this.registerEvent(this.app.workspace.on('layout-change', refresh));
    this.registerEvent(this.app.workspace.on('file-open', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
    this.app.workspace.onLayoutReady(refresh);
    this.register(() => {
      for (const button of this.headerButtons.values()) button.remove();
      this.headerButtons.clear();
    });

    this.addSettingTab(new KanbanToBasesSettingTab(this.app, this));
  }

  /** Adds the button to the views that show a board, and removes it from the others. */
  private refreshHeaderButtons(): void {
    const boards = new Set<FileView>();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof FileView) || !BOARD_VIEWS.has(view.getViewType()) || !view.file || !this.isBoard(view.file)) return;
      boards.add(view);
      if (this.headerButtons.has(view)) return;
      const button = view.addAction('square-kanban', t().menuConvert, () => {
        if (view.file) void this.openPreview(view.file);
      });
      button.addClass('ktb-header-button');
      this.headerButtons.set(view, button);
    });
    for (const [view, button] of this.headerButtons) {
      if (boards.has(view)) continue;
      button.remove();
      this.headerButtons.delete(view);
    }
  }

  async loadState(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as StoredData;
    this.settings = sanitizeSettings(data.settings);
    this.lastConversion = readManifest(data.lastConversion);
  }

  async saveState(): Promise<void> {
    const data: StoredData = { settings: this.settings, lastConversion: this.lastConversion };
    await this.saveData(data);
  }

  isBoard(file: TFile): boolean {
    if (file.extension !== 'md') return false;
    const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[BOARD_KEY];
    return value !== undefined && value !== null && value !== false && value !== '';
  }

  /** Defaults set in the Kanban plugin itself (date format, triggers), when it is installed. */
  private async readKanbanDefaults(): Promise<Record<string, unknown>> {
    const path = normalizePath(`${this.app.vault.configDir}/plugins/obsidian-kanban/data.json`);
    try {
      if (!(await this.app.vault.adapter.exists(path))) return {};
      const data: unknown = JSON.parse(await this.app.vault.adapter.read(path));
      return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /**
   * Value of the board property: the file name, or the name with its folder when other notes already carry it
   * (another board with the same name, or an earlier conversion), so that each base only shows its own cards.
   */
  private boardValue(file: TFile): string {
    const folder = file.parent && file.parent.path !== '/' ? file.parent.path : '';
    const candidates = [file.basename, ...(folder !== '' ? [`${file.basename} (${folder})`] : [])];
    for (const candidate of candidates) if (this.countBoardNotes(candidate) === 0) return candidate;
    let n = 2;
    while (this.countBoardNotes(`${file.basename} (${n})`) > 0) n++;
    return `${file.basename} (${n})`;
  }

  /** Notes that already carry this board's name, for instance from an earlier conversion. */
  private countBoardNotes(boardName: string): number {
    const key = this.settings.propBoard;
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.[key] === boardName).length;
  }

  async openPreview(file: TFile): Promise<void> {
    const s = t();
    let board;
    try {
      board = parseBoard(await this.app.vault.cachedRead(file), await this.readKanbanDefaults());
    } catch (error) {
      console.error('Kanban to Bases: cannot read the board', error);
      new Notice(s.readError(error instanceof Error ? error.message : String(error)));
      return;
    }
    if (!board) {
      new Notice(s.notABoard);
      return;
    }
    new PreviewModal(this.app, {
      file,
      board,
      settings: this.settings,
      parseDate,
      parseTime,
      boardName: this.boardValue(file),
      onConvert: (plan, openBase) => this.convert(file, plan, openBase),
    }).open();
  }

  private async convert(board: TFile, plan: Plan, openBase: boolean): Promise<(() => void) | null> {
    const s = t();
    try {
      const { manifest, base } = await applyPlan(this.app, plan, board.path);
      this.lastConversion = manifest;
      await this.saveState();
      new Notice(s.noticeConverted(plan.notes.length));
      if (openBase) await this.openBase(base);
      return () =>
        new SuccessModal(this.app, {
          notes: plan.notes.length,
          links: plan.links.length,
          base,
          openBase: (file) => this.openBase(file),
        }).open();
    } catch (error) {
      console.error('Kanban to Bases: conversion failed', error);
      const manifest = error instanceof ConversionError ? error.manifest : null;
      const created = manifest ? manifest.createdFiles.length + manifest.linked.length : 0;
      if (manifest && (created > 0 || manifest.createdFolders.length > 0)) {
        this.lastConversion = manifest;
        await this.saveState();
      }
      new Notice(s.noticeFailed(error instanceof Error ? error.message : String(error), created), 0);
      return null;
    }
  }

  /** Shows the base: the tab where it is already open, or a new tab. */
  private async openBase(file: TFile): Promise<void> {
    let existing: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!existing && leaf.view instanceof FileView && leaf.view.file?.path === file.path) existing = leaf;
    });
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      this.app.workspace.setActiveLeaf(existing, { focus: true });
      return;
    }
    await this.app.workspace.getLeaf('tab').openFile(file);
  }

  private confirmUndo(): void {
    const manifest = this.lastConversion;
    if (!manifest) {
      new Notice(t().undoNothing);
      return;
    }
    new UndoModal(this.app, manifest, async () => {
      const s = t();
      const result = await undoConversion(this.app, manifest);
      this.lastConversion = null;
      await this.saveState();
      const parts = [s.undoDone(result.removed, result.restored)];
      if (result.missing > 0) parts.push(s.undoMissing(result.missing));
      if (result.kept > 0) parts.push(s.undoKept(result.kept));
      new Notice(parts.join(' '));
    }).open();
  }
}
