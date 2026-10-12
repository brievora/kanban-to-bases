import { ButtonComponent, Modal } from 'obsidian';
import type { App } from 'obsidian';
import type { ConversionManifest } from '../convert';
import { formatDate, t } from '../i18n';

export class UndoModal extends Modal {
  constructor(
    app: App,
    private readonly manifest: ConversionManifest,
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const s = t();
    const { contentEl } = this;
    const { manifest } = this;
    this.modalEl.addClass('ktb-modal');
    this.setTitle(s.undoTitle);

    contentEl.createEl('p', { text: s.undoBoard(manifest.boardName, formatDate(manifest.date)) });
    const list = contentEl.createEl('ul', { cls: 'ktb-plain-list' });
    if (manifest.createdFiles.length > 0) list.createEl('li', { text: s.undoFiles(manifest.createdFiles.length) });
    if (manifest.linked.length > 0) list.createEl('li', { text: s.undoLinks(manifest.linked.length) });

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = new ButtonComponent(buttons).setButtonText(s.cancel).onClick(() => this.close());
    const confirm = new ButtonComponent(buttons).setButtonText(s.undoConfirm).setDestructive().setCta();
    confirm.onClick(async () => {
      confirm.setDisabled(true);
      cancel.setDisabled(true);
      try {
        await this.onConfirm();
      } finally {
        this.close();
      }
    });
    cancel.buttonEl.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
