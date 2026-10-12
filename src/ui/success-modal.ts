import { ButtonComponent, Modal, setIcon } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { t } from '../i18n';
import { renderPromo } from './promo';

export interface SuccessDetails {
  notes: number;
  links: number;
  base: TFile;
  openBase: (file: TFile) => Promise<void>;
}

export class SuccessModal extends Modal {
  constructor(
    app: App,
    private readonly details: SuccessDetails,
  ) {
    super(app);
  }

  onOpen(): void {
    const s = t();
    const { contentEl } = this;
    const { notes, links, base } = this.details;
    this.modalEl.addClass('ktb-modal', 'ktb-success');
    this.setTitle(s.successTitle);

    const stats = contentEl.createEl('ul', { cls: 'ktb-stats' });
    const stat = (icon: string, text: string): void => {
      const li = stats.createEl('li');
      setIcon(li.createSpan({ cls: 'ktb-stat-icon' }), icon);
      li.createSpan({ text });
    };
    stat('file-plus', s.successNotes(notes));
    if (links > 0) stat('link', s.successLinks(links));
    stat('table', base.path);

    contentEl.createEl('p', { cls: 'ktb-hint', text: s.successUndo });

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    new ButtonComponent(buttons).setButtonText(s.openBase).onClick(async () => {
      this.close();
      await this.details.openBase(base);
    });
    const done = new ButtonComponent(buttons)
      .setButtonText(s.done)
      .setCta()
      .onClick(() => this.close());

    renderPromo(contentEl, true);
    done.buttonEl.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
