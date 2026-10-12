import { PluginSettingTab } from 'obsidian';
import type { App, SettingDefinition, SettingDefinitionItem } from 'obsidian';
import type { PropertyNames } from './core/plan';
import { t } from './i18n';
import type KanbanToBasesPlugin from './main';
import { renderPromo } from './ui/promo';

export interface KanbanToBasesSettings {
  propStatus: string;
  propPosition: string;
  propDue: string;
  propDone: string;
  propTags: string;
  propBoard: string;
  /** Empty: the localized default ("Inbox"). */
  defaultColumn: string;
  columnWidth: number;
}

export const DEFAULT_SETTINGS: KanbanToBasesSettings = {
  propStatus: 'status',
  propPosition: 'position',
  propDue: 'due',
  propDone: 'done',
  propTags: 'tags',
  propBoard: 'board',
  defaultColumn: '',
  columnWidth: 260,
};

type PropKey = 'propStatus' | 'propPosition' | 'propDue' | 'propDone' | 'propTags' | 'propBoard';
const PROP_KEYS: PropKey[] = ['propStatus', 'propPosition', 'propDue', 'propDone', 'propTags', 'propBoard'];

export const PROPERTY_NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u;
export const MIN_COLUMN_WIDTH = 150;
export const MAX_COLUMN_WIDTH = 600;

export function propertyNames(settings: KanbanToBasesSettings): PropertyNames {
  return {
    status: settings.propStatus,
    position: settings.propPosition,
    due: settings.propDue,
    done: settings.propDone,
    tags: settings.propTags,
    board: settings.propBoard,
  };
}

/** Keeps only valid stored values, so a hand-edited data.json cannot break a conversion. */
export function sanitizeSettings(stored: unknown): KanbanToBasesSettings {
  const settings: KanbanToBasesSettings = { ...DEFAULT_SETTINGS };
  if (!stored || typeof stored !== 'object') return settings;
  const data = stored as Record<string, unknown>;
  const used = new Set<string>();
  for (const key of PROP_KEYS) {
    const value = data[key];
    if (typeof value === 'string' && PROPERTY_NAME.test(value.trim()) && !used.has(value.trim().toLowerCase())) {
      settings[key] = value.trim();
    }
    used.add(settings[key].toLowerCase());
  }
  if (typeof data.defaultColumn === 'string') settings.defaultColumn = data.defaultColumn.trim();
  const width = data.columnWidth;
  if (typeof width === 'number' && width >= MIN_COLUMN_WIDTH && width <= MAX_COLUMN_WIDTH) settings.columnWidth = Math.round(width);
  return settings;
}

export class KanbanToBasesSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: KanbanToBasesPlugin,
  ) {
    super(app, plugin);
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof KanbanToBasesSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] = typeof value === 'string' ? value.trim() : value;
    await this.plugin.saveState();
  }

  private propertySetting(key: PropKey, name: string, desc: string): SettingDefinition {
    const s = t();
    return {
      name,
      desc,
      control: {
        type: 'text',
        key,
        placeholder: DEFAULT_SETTINGS[key],
        defaultValue: DEFAULT_SETTINGS[key],
        validate: (value: string) => {
          const name = value.trim();
          if (!PROPERTY_NAME.test(name)) return s.propInvalid;
          const taken = PROP_KEYS.some((other) => other !== key && this.plugin.settings[other].toLowerCase() === name.toLowerCase());
          if (taken) return s.propDuplicate;
          return undefined;
        },
      },
    };
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = t();
    return [
      {
        type: 'group',
        heading: s.propsHeading,
        items: [
          this.propertySetting('propStatus', s.propStatus, s.propStatusDesc),
          this.propertySetting('propPosition', s.propPosition, s.propPositionDesc),
          this.propertySetting('propDue', s.propDue, s.propDueDesc),
          this.propertySetting('propDone', s.propDone, s.propDoneDesc),
          this.propertySetting('propTags', s.propTags, s.propTagsDesc),
          this.propertySetting('propBoard', s.propBoard, s.propBoardDesc),
        ],
      },
      {
        type: 'group',
        heading: s.conversionHeading,
        items: [
          {
            name: s.defaultColumn,
            desc: s.defaultColumnDesc,
            control: { type: 'text', key: 'defaultColumn', placeholder: s.defaultColumnValue },
          },
          {
            name: s.columnWidth,
            desc: s.columnWidthDesc,
            control: {
              type: 'number',
              key: 'columnWidth',
              min: MIN_COLUMN_WIDTH,
              max: MAX_COLUMN_WIDTH,
              step: 10,
              defaultValue: DEFAULT_SETTINGS.columnWidth,
              validate: (value: number) =>
                Number.isFinite(value) && value >= MIN_COLUMN_WIDTH && value <= MAX_COLUMN_WIDTH ? undefined : s.columnWidthInvalid,
            },
          },
        ],
      },
      {
        name: 'Brievora',
        searchable: false,
        render: (setting) => {
          setting.settingEl.empty();
          setting.settingEl.addClass('ktb-promo-setting');
          renderPromo(setting.settingEl, false);
        },
      },
    ];
  }
}
