// File names for the notes created from cards. Pure module.

export const MAX_NAME_LENGTH = 100;

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;

function isControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

export interface FileName {
  name: string;
  /** True when the title was cut to fit the length limit. */
  truncated: boolean;
}

/**
 * Makes a valid note name from a title: removes characters that file systems or
 * wikilinks do not accept, trims dots and spaces, limits the length.
 */
export function toFileName(title: string, fallback: string): FileName {
  let name = Array.from(title, (char) => (isControl(char) ? ' ' : char))
    .join('')
    .replace(/[/\\]/g, '-')
    // Characters refused by Windows, and characters that break wikilinks.
    .replace(/[*"<>:|?#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');

  let truncated = false;
  const chars = Array.from(name);
  if (chars.length > MAX_NAME_LENGTH) {
    truncated = true;
    const cut = chars.slice(0, MAX_NAME_LENGTH).join('');
    const space = cut.lastIndexOf(' ');
    name = (space >= MAX_NAME_LENGTH * 0.6 ? cut.slice(0, space) : cut).replace(/[.\s]+$/, '');
  }

  if (name === '') name = fallback;
  if (WINDOWS_RESERVED.test(name)) name = `${name}_`;
  return { name, truncated };
}

/** Gives each name a unique variant, "Name (2)", "Name (3)", compared without case. */
export class NameRegistry {
  private readonly taken: Set<string>;

  constructor(taken: Iterable<string> = []) {
    this.taken = new Set([...taken].map((n) => n.toLowerCase()));
  }

  has(name: string): boolean {
    return this.taken.has(name.toLowerCase());
  }

  claim(name: string): string {
    let candidate = name;
    for (let n = 2; this.has(candidate); n++) candidate = `${name} (${n})`;
    this.taken.add(candidate.toLowerCase());
    return candidate;
  }
}
