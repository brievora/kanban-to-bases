// Date and time reading for card metadata.
// The plugin passes functions backed by Obsidian's moment.js; this module provides
// a small fallback that understands the numeric moment tokens, used in unit tests.

/** Returns the date as YYYY-MM-DD, or null when the text does not match the format. */
export type DateParser = (text: string, format: string) => string | null;
/** Returns the time as HH:mm, or null when the text does not match the format. */
export type TimeParser = (text: string, format: string) => string | null;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

interface Token {
  pattern: string;
  field?: 'year' | 'year2' | 'month' | 'monthName' | 'day' | 'hour' | 'hour12' | 'minute' | 'second' | 'meridiem';
}

const TOKENS: Array<[string, Token]> = [
  ['YYYY', { pattern: '(\\d{4})', field: 'year' }],
  ['YY', { pattern: '(\\d{2})', field: 'year2' }],
  ['MMMM', { pattern: '([A-Za-z]+)', field: 'monthName' }],
  ['MMM', { pattern: '([A-Za-z]{3})\\.?', field: 'monthName' }],
  ['MM', { pattern: '(\\d{2})', field: 'month' }],
  ['M', { pattern: '(\\d{1,2})', field: 'month' }],
  ['Do', { pattern: '(\\d{1,2})(?:st|nd|rd|th)', field: 'day' }],
  ['DD', { pattern: '(\\d{2})', field: 'day' }],
  ['D', { pattern: '(\\d{1,2})', field: 'day' }],
  ['HH', { pattern: '(\\d{2})', field: 'hour' }],
  ['H', { pattern: '(\\d{1,2})', field: 'hour' }],
  ['hh', { pattern: '(\\d{2})', field: 'hour12' }],
  ['h', { pattern: '(\\d{1,2})', field: 'hour12' }],
  ['mm', { pattern: '(\\d{2})', field: 'minute' }],
  ['m', { pattern: '(\\d{1,2})', field: 'minute' }],
  ['ss', { pattern: '(\\d{2})', field: 'second' }],
  ['s', { pattern: '(\\d{1,2})', field: 'second' }],
  ['A', { pattern: '(AM|PM|am|pm)', field: 'meridiem' }],
  ['a', { pattern: '(am|pm|AM|PM)', field: 'meridiem' }],
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(format: string): { regex: RegExp; fields: Array<Token['field']> } {
  let pattern = '';
  const fields: Array<Token['field']> = [];
  let i = 0;
  while (i < format.length) {
    if (format[i] === '[') {
      const end = format.indexOf(']', i);
      if (end > i) {
        pattern += escapeRegExp(format.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    const match = TOKENS.find(([name]) => format.startsWith(name, i));
    if (match) {
      pattern += match[1].pattern;
      fields.push(match[1].field);
      i += match[0].length;
    } else {
      pattern += escapeRegExp(format.charAt(i));
      i++;
    }
  }
  return { regex: new RegExp(`^${pattern}$`), fields };
}

function readParts(text: string, format: string): Map<string, string> | null {
  const { regex, fields } = compile(format);
  const match = regex.exec(text.trim());
  if (!match) return null;
  const parts = new Map<string, string>();
  fields.forEach((field, index) => {
    const value = match[index + 1];
    if (field && value !== undefined) parts.set(field, value);
  });
  return parts;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export const simpleParseDate: DateParser = (text, format) => {
  const parts = readParts(text, format);
  if (!parts) return null;
  let year = Number(parts.get('year') ?? NaN);
  if (Number.isNaN(year) && parts.has('year2')) year = 2000 + Number(parts.get('year2'));
  let month = Number(parts.get('month') ?? NaN);
  const monthName = parts.get('monthName')?.toLowerCase();
  if (monthName) month = MONTHS.findIndex((m) => m.startsWith(monthName.slice(0, 3))) + 1;
  const day = Number(parts.get('day') ?? NaN);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
};

export const simpleParseTime: TimeParser = (text, format) => {
  const parts = readParts(text, format);
  if (!parts) return null;
  let hour = Number(parts.get('hour') ?? parts.get('hour12') ?? NaN);
  const minute = Number(parts.get('minute') ?? 0);
  const meridiem = parts.get('meridiem')?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
};
