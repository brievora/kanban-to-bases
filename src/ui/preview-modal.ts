import { ButtonComponent, Modal, normalizePath, setIcon, Setting, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { DateParser, TimeParser } from '../core/dates';
import type { ParsedBoard } from '../core/parser';
import { buildPlan } from '../core/plan';
import type { Plan, Warning } from '../core/plan';
import { t } from '../i18n';
import type { Strings } from '../i18n';
import { propertyNames } from '../settings';
import type { KanbanToBasesSettings } from '../settings';

/** Lists longer than this are cut, with an "and N more" line. */
const LIST_LIMIT = 12;

export interface PreviewOptions {
  file: TFile;
  board: ParsedBoard;
  settings: KanbanToBasesSettings;
  parseDate: DateParser;
  parseTime: TimeParser;
  /** Notes that already carry the board property with this board's name. */
  /** Value of the board property, unique among the notes of the vault (see main.ts). */
  boardName: string;
  /** Runs the conversion. The returned function runs once this dialog is closed. */
  onConvert: (plan: Plan, openBase: boolean) => Promise<(() => void) | null>;
}

export function defaultFolder(file: TFile): string {
  const parent = file.parent?.path ?? '/';
  return parent === '/' || parent === '' ? file.basename : `${parent}/${file.basename}`;
}

/** Normalized folder path ('' for the vault root), or null when the name is not allowed. */
export function normalizeFolder(app: App, input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '' || trimmed === '/') return '';
  const path = normalizePath(trimmed);
  if (path === '/' || path === '') return '';
  const invalid = path
    .split('/')
    .some((segment) => segment.trim() === '' || segment.startsWith('.') || segment.endsWith('.') || /[*"<>:|?\\]/.test(segment));
  if (invalid) return null;
  if (app.vault.getAbstractFileByPath(path) instanceof TFile) return null;
  return path;
}

export function warningText(s: Strings, warning: Warning): string {
  switch (warning.kind) {
    case 'renamed':
      return s.warnRenamed(warning.from, warning.to);
    case 'duplicate-column':
      return s.warnDuplicateColumn(warning.from, warning.to);
    case 'link-missing':
      return s.warnLinkMissing(warning.target);
    case 'link-duplicate':
      return s.warnLinkDuplicate(warning.target);
    case 'link-extra-lines':
      return s.warnLinkExtra(warning.target);
    case 'link-overwrite':
      return s.warnLinkOverwrite(warning.target, warning.property, warning.from, warning.to);
    case 'link-not-copied':
      return s.warnLinkNotCopied(warning.target);
    case 'links-unchanged':
      return s.warnLinksUnchanged(warning.count);
    case 'invalid-date':
      return s.warnInvalidDate(warning.card, warning.value);
    case 'time-without-date':
      return s.warnTimeWithoutDate(warning.card, warning.value);
    case 'loose-cards':
      return s.warnLooseCards(warning.count, warning.column);
    case 'ignored-lines':
      return s.warnIgnoredLines(warning.count);
    case 'settings-unreadable':
      return s.warnSettingsUnreadable;
  }
}

function sectionTitle(container: HTMLElement, text: string): void {
  container.createDiv({ cls: 'ktb-section-title', text });
}

function renderList(container: HTMLElement, items: Array<{ text: string; meta?: string }>, s: Strings): void {
  const list = container.createEl('ul', { cls: 'ktb-list' });
  const shown = items.length > LIST_LIMIT ? items.slice(0, LIST_LIMIT - 2) : items;
  for (const item of shown) {
    const li = list.createEl('li');
    li.createSpan({ cls: 'ktb-list-text', text: item.text });
    if (item.meta) li.createSpan({ cls: 'ktb-list-meta', text: item.meta });
  }
  if (shown.length < items.length) list.createEl('li', { cls: 'ktb-list-more', text: s.more(items.length - shown.length) });
}

export class PreviewModal extends Modal {
  private folderInput: string;
  private folder: string | null;
  private updateLinked = true;
  private includeArchive = false;
  private openBase = true;
  private plan: Plan | null = null;
  private summaryEl!: HTMLElement;
  private columnsEl!: HTMLElement;
  private folderErrorEl!: HTMLElement;
  private detailsEl!: HTMLElement;
  private convertButton!: ButtonComponent;
  private cancelButton!: ButtonComponent;
  private converting = false;

  constructor(
    app: App,
    private readonly options: PreviewOptions,
  ) {
    super(app);
    this.folderInput = defaultFolder(options.file);
    this.folder = normalizeFolder(app, this.folderInput);
  }

  onOpen(): void {
    const s = t();
    const { contentEl } = this;
    this.modalEl.addClass('ktb-modal');
    this.setTitle(s.previewTitle);

    const header = contentEl.createDiv({ cls: 'ktb-header' });
    header.createDiv({ cls: 'ktb-board-name', text: this.options.file.basename });
    this.summaryEl = header.createDiv({ cls: 'ktb-summary' });

    this.columnsEl = contentEl.createDiv({ cls: 'ktb-columns' });

    const options = contentEl.createDiv({ cls: 'ktb-options' });
    const folderSetting = new Setting(options)
      .setName(s.folderName)
      .setDesc(s.folderDesc)
      .addText((text) => {
        text.setValue(this.folderInput).onChange((value) => {
          this.folderInput = value;
          this.folder = normalizeFolder(this.app, value);
          this.refresh();
        });
        // Enter in the folder field converts, like the main button.
        text.inputEl.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || event.isComposing) return;
          event.preventDefault();
          void this.convert();
        });
      });
    folderSetting.settingEl.addClass('ktb-folder-setting');
    this.folderErrorEl = folderSetting.descEl.createDiv({ cls: 'ktb-error', text: s.folderInvalid });

    new Setting(options)
      .setName(s.linkedName)
      .setDesc(s.linkedDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.updateLinked).onChange((value) => {
          this.updateLinked = value;
          this.refresh();
        }),
      );

    const archiveCards = this.options.board.archive?.cards.length ?? 0;
    new Setting(options)
      .setName(s.archiveName)
      .setDesc(s.archiveDesc(archiveCards))
      .addToggle((toggle) =>
        toggle
          .setValue(this.includeArchive)
          .setDisabled(archiveCards === 0)
          .onChange((value) => {
            this.includeArchive = value;
            this.refresh();
          }),
      );

    new Setting(options).setName(s.openName).addToggle((toggle) =>
      toggle.setValue(this.openBase).onChange((value) => {
        this.openBase = value;
      }),
    );

    this.detailsEl = contentEl.createDiv({ cls: 'ktb-details' });

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    this.cancelButton = new ButtonComponent(buttons).setButtonText(s.cancel).onClick(() => this.close());
    this.convertButton = new ButtonComponent(buttons)
      .setButtonText(s.convert)
      .setCta()
      .onClick(() => void this.convert());

    this.refresh();
    // Obsidian focuses the folder field; keep the dialog scrolled to the top, where the summary is.
    this.modalEl.scrollTop = 0;
    contentEl.scrollTop = 0;
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private refresh(): void {
    const s = t();
    const { board, settings } = this.options;
    this.folderErrorEl.toggleClass('is-visible', this.folder === null);
    this.plan =
      this.folder === null
        ? null
        : buildPlan(board, {
            boardName: this.options.boardName,
            boardPath: this.options.file.path,
            folder: this.folder,
            props: propertyNames(settings),
            includeArchive: this.includeArchive,
            updateLinkedNotes: this.updateLinked,
            defaultColumn: settings.defaultColumn === '' ? s.defaultColumnValue : settings.defaultColumn,
            columnWidth: settings.columnWidth,
            labels: { untitledCard: s.untitledCard, untitledColumn: s.untitledColumn, boardView: s.boardView, tableView: s.tableView },
            existingNames: this.existingNames(this.folder),
            resolveLink: (target) => {
              const file = this.app.metadataCache.getFirstLinkpathDest(target, this.options.file.path);
              return file ? file.path : null;
            },
            readProperties: (path) => {
              const file = this.app.vault.getFileByPath(path);
              return file ? (this.app.metadataCache.getFileCache(file)?.frontmatter ?? null) : null;
            },
            parseDate: this.options.parseDate,
            parseTime: this.options.parseTime,
          });
    this.convertButton.setDisabled(this.plan === null || this.converting);
    this.renderColumns();
    this.renderDetails();
  }

  private existingNames(folder: string): string[] {
    const parent = folder === '' ? this.app.vault.getRoot() : this.app.vault.getFolderByPath(folder);
    return parent ? parent.children.map((child) => child.name) : [];
  }

  private renderColumns(): void {
    const s = t();
    const { board } = this.options;
    const totalCards = board.lanes.reduce((n, l) => n + l.cards.length, 0) + board.looseCards.length;
    this.summaryEl.setText(s.previewSummary(board.lanes.length, totalCards));
    this.columnsEl.empty();
    if (!this.plan) return;
    if (this.plan.columns.length === 0 && totalCards === 0) {
      this.columnsEl.createDiv({ cls: 'ktb-empty', text: s.emptyBoard });
      return;
    }
    const list = this.columnsEl.createEl('ul', { cls: 'ktb-chips', attr: { 'aria-label': s.columnsHeading } });
    for (const column of this.plan.columns) {
      const chip = list.createEl('li', { cls: 'ktb-chip' });
      chip.createSpan({ cls: 'ktb-chip-name', text: column.name });
      chip.createSpan({ cls: 'ktb-count', text: String(column.cards) });
      if (column.complete) chip.createSpan({ cls: 'ktb-badge', text: s.columnComplete });
      if (column.archive) chip.createSpan({ cls: 'ktb-badge', text: s.columnArchive });
    }
    if (totalCards === 0) this.columnsEl.createDiv({ cls: 'ktb-empty', text: s.emptyBoard });
  }

  private renderDetails(): void {
    const s = t();
    const plan = this.plan;
    this.detailsEl.empty();
    if (!plan) return;

    const baseLine = this.detailsEl.createDiv({ cls: 'ktb-base-line' });
    setIcon(baseLine.createSpan({ cls: 'ktb-base-icon' }), 'table');
    baseLine.createSpan({ cls: 'ktb-base-label', text: s.baseHeading });
    baseLine.createSpan({ cls: 'ktb-base-path', text: plan.base.path });

    if (plan.notes.length > 0) {
      sectionTitle(this.detailsEl, s.notesHeading(plan.notes.length));
      renderList(
        this.detailsEl,
        plan.notes.map((n) => ({ text: n.name, meta: n.status })),
        s,
      );
    }
    if (plan.links.length > 0) {
      sectionTitle(this.detailsEl, s.linksHeading(plan.links.length));
      renderList(
        this.detailsEl,
        plan.links.map((l) => ({ text: l.path.replace(/\.md$/, ''), meta: l.previousStatus !== null ? `${l.previousStatus} \u{2192} ${l.status}` : l.status })),
        s,
      );
    }

    const warnings = plan.warnings.map((w) => warningText(s, w));
    if (plan.boardName !== this.options.file.basename) {
      warnings.unshift(s.warnBoardRenamed(this.options.settings.propBoard, this.options.file.basename, plan.boardName));
    }
    if (warnings.length > 0) {
      const box = this.detailsEl.createDiv({ cls: 'ktb-warnings', attr: { role: 'status' } });
      box.createDiv({ cls: 'ktb-warnings-title', text: s.warningsHeading(warnings.length) });
      renderList(
        box,
        warnings.map((text) => ({ text })),
        s,
      );
    }
  }

  private async convert(): Promise<void> {
    if (!this.plan || this.converting) return;
    this.converting = true;
    this.convertButton.setDisabled(true).setButtonText(t().converting);
    this.cancelButton.setDisabled(true);
    let next: (() => void) | null = null;
    try {
      next = await this.options.onConvert(this.plan, this.openBase);
    } finally {
      this.close();
      next?.();
    }
  }
}
