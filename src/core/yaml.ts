// Minimal YAML writer for note frontmatter and .base files.
// Only what this plugin writes: scalars, lists of scalars and nested mappings.
// Pure module: no dependency on Obsidian, so it can be unit tested with Node.

/** A value written as is, without quoting (used for dates such as 2026-10-12). */
export interface YamlRaw {
  raw: string;
}

export type YamlScalar = string | number | boolean | YamlRaw;
export type YamlValue = YamlScalar | YamlValue[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i;
// Characters that are safe in a plain (unquoted) scalar in block context.
const SAFE_PLAIN = /^[\p{L}\p{M}][\p{L}\p{M}\p{N} _'.,()&+/!?-]*$/u;

export function isRaw(value: unknown): value is YamlRaw {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as YamlRaw).raw === 'string';
}

/** Double-quoted YAML string. JSON string syntax is valid YAML, minus two line separators. */
export function quoteDouble(text: string): string {
  return JSON.stringify(text).split(LINE_SEPARATOR).join('\\u2028').split(PARAGRAPH_SEPARATOR).join('\\u2029');
}

/** Single-quoted YAML string, used for Bases expressions that contain double quotes. */
export function quoteSingle(text: string): string {
  if (hasControlCharacter(text)) return quoteDouble(text);
  return `'${text.replace(/'/g, "''")}'`;
}

/** Line breaks and control characters can only be written escaped, in a double-quoted string. */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

export function needsQuotes(text: string): boolean {
  if (text.length === 0) return true;
  if (text !== text.trim()) return true;
  if (RESERVED.test(text)) return true;
  return !SAFE_PLAIN.test(text);
}

export function scalar(value: YamlScalar): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot write ${value} as YAML`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (isRaw(value)) return value.raw;
  if (!needsQuotes(value)) return value;
  // Single quotes keep expressions such as board == "Name" readable.
  return value.includes('"') ? quoteSingle(value) : quoteDouble(value);
}

export function key(name: string): string {
  return /^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(name) && name === name.trim() && !RESERVED.test(name)
    ? name
    : quoteDouble(name);
}

function isMap(value: YamlValue): value is YamlMap {
  return typeof value === 'object' && !Array.isArray(value) && !isRaw(value);
}

function writeValue(value: YamlValue, indent: string, out: string[], prefix: string): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(`${prefix} []`);
      return;
    }
    out.push(prefix);
    for (const item of value) writeItem(item, indent + '  ', out);
  } else if (isMap(value)) {
    out.push(prefix);
    writeMap(value, indent + '  ', out);
  } else {
    out.push(`${prefix} ${scalar(value)}`);
  }
}

function writeItem(item: YamlValue, indent: string, out: string[]): void {
  if (isMap(item)) {
    // First key on the dash line, the others aligned under it.
    const lines: string[] = [];
    writeMap(item, indent + '  ', lines);
    const [first, ...rest] = lines;
    out.push(`${indent}- ${(first ?? '').trimStart()}`, ...rest);
  } else if (Array.isArray(item)) {
    throw new Error('Nested lists are not supported');
  } else {
    out.push(`${indent}- ${scalar(item)}`);
  }
}

function writeMap(map: YamlMap, indent: string, out: string[]): void {
  for (const [name, value] of Object.entries(map)) {
    writeValue(value, indent, out, `${indent}${key(name)}:`);
  }
}

/** Serializes a mapping as a YAML document body (no `---` markers), ending with a newline. */
export function stringify(map: YamlMap): string {
  const out: string[] = [];
  writeMap(map, '', out);
  return out.join('\n') + '\n';
}
