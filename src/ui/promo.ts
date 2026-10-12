import { t } from '../i18n';

/**
 * Static note about the plugin's publisher: text and a link, nothing loaded from the network.
 * Shown at the bottom of the settings and of the success dialog (declared in the README).
 */
export function renderPromo(container: HTMLElement, compact: boolean): HTMLElement {
  const s = t();
  const box = container.createDiv({ cls: compact ? 'ktb-promo is-compact' : 'ktb-promo' });
  box.createSpan({ text: `${s.promoText} ` });
  box.createEl('a', {
    text: s.promoLink,
    href: s.promoUrl,
    cls: 'external-link',
    attr: { target: '_blank', rel: 'noopener' },
  });
  return box;
}
