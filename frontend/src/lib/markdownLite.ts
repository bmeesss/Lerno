/**
 * Minimal, safe markdown parsing for AI answers.
 *
 * Lerno AI replies contain light markdown and the occasional formula. This
 * parser keeps rendering React-safe: input is split into tokens and rendered as
 * React elements, so no HTML is ever injected and model output can never
 * smuggle markup into the page.
 *
 * Supported: headings, paragraphs, unordered/ordered (and nested) lists, bold,
 * italic, strikethrough, inline code, fenced code blocks, blockquotes, simple
 * pipe tables, dividers, safe links and LaTeX-ish math (`$…$`, `\[…\]`).
 */
import { formatMath } from './mathLite';

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string }
  | { kind: 'strike'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'math'; value: string }
  | { kind: 'link'; value: string; href: string };

export interface ListItem {
  inline: InlineToken[];
  /** Nested list under this item (one level is the common case; nesting is unlimited). */
  children: MarkdownBlock[];
}

export type MarkdownBlock =
  | { kind: 'paragraph'; inline: InlineToken[] }
  | { kind: 'heading'; level: number; inline: InlineToken[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'code'; language: string | null; code: string }
  | { kind: 'quote'; blocks: MarkdownBlock[] }
  | {
      kind: 'table';
      align: ('left' | 'center' | 'right')[];
      header: InlineToken[][];
      rows: InlineToken[][][];
    }
  | { kind: 'math'; value: string }
  | { kind: 'divider' };

const UL = /^[-*+•]\s+/;
const OL = /^(\d{1,3})[.)]\s+/;
const HEADING = /^\s{0,3}(#{1,6})\s+/;
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const QUOTE = /^\s*>\s?/;
const DIVIDER = /^\s*(?:-\s*-\s*-[-\s]*|\*\s*\*\s*\*[*\s]*|_\s*_\s*_[_\s]*)$/;
const MATH_OPEN = /^\s*(?:\$\$|\\\[)/;
const MATH_CLOSE = /(?:\$\$|\\\])/;

/** Delimiters that turn a span into a formula. */
const INLINE_MATH = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$([^$\n]+?)\$/;

const BOLD = /\*\*([\s\S]+?)\*\*|__([\s\S]+?)__/;
const ITALIC = /\*([^*\n]+?)\*|_([^_\n]+?)_/;
const STRIKE = /~~([\s\S]+?)~~/;
const CODE = /`([^`\n]+?)`/;
const LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/;

/** Markdown escapes (`\*`, `\_`, `\$` …) must not be visible in the answer. */
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!$~>])/g;

/** Only these protocols may become a real link. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  return null;
}

function pushText(tokens: InlineToken[], value: string): void {
  if (!value) return;
  const last = tokens.at(-1);
  if (last && last.kind === 'text') last.value += value;
  else tokens.push({ kind: 'text', value });
}

/** Guards against treating currency or plain prose as a formula. */
function looksLikeMath(value: string): boolean {
  if (value.length === 0 || value.length > 160) return false;
  if (/^\s|\s$/.test(value)) return false;
  return /[=^_{}\\]|\d\s*[+\-*/]\s*\d/.test(value);
}

interface InlineCandidate {
  regex: RegExp;
  build: (match: RegExpExecArray) => InlineToken | null;
  /** Context check, used where a regex lookbehind would be needed. */
  guard?: (match: RegExpExecArray, at: number, input: string) => boolean;
}

const INLINE_CANDIDATES: InlineCandidate[] = [
  { regex: CODE, build: (m) => ({ kind: 'code', value: m[1]! }) },
  {
    regex: INLINE_MATH,
    build: (m) => {
      const raw = m[1] ?? m[2] ?? m[3] ?? '';
      // \( … \) and \[ … \] are always math; $ … $ needs a sanity check.
      if (m[1] === undefined && m[2] === undefined && !looksLikeMath(raw)) return null;
      return { kind: 'math', value: formatMath(raw) };
    },
  },
  {
    regex: LINK,
    build: (m) => {
      const href = safeHref(m[2]!);
      if (!href) return null;
      return { kind: 'link', value: m[1]!.trim() || href, href };
    },
  },
  { regex: BOLD, build: (m) => ({ kind: 'bold', value: (m[1] ?? m[2] ?? '').trim() }) },
  { regex: STRIKE, build: (m) => ({ kind: 'strike', value: m[1]! }) },
  {
    regex: ITALIC,
    guard: (m, at, input) => {
      const before = at > 0 ? input[at - 1]! : '';
      if (/[\w]/.test(before)) return false; // snake_case stays plain text
      const after = input[at + m[0].length];
      return after === undefined || !/[\w]/.test(after);
    },
    build: (m) => ({ kind: 'italic', value: (m[1] ?? m[2] ?? '').trim() }),
  },
];

/**
 * Splits a line into text/bold/italic/code/math/link tokens. Anything that is
 * not a recognised marker stays literal text — including unmatched ones.
 *
 * The earliest match wins; ties are broken by the candidate order above, so
 * `**bold**` is never mistaken for `*italic*`.
 */
export function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = line;

  while (rest.length > 0) {
    let best: { at: number; length: number; token: InlineToken } | null = null;

    for (const candidate of INLINE_CANDIDATES) {
      const regex = new RegExp(
        candidate.regex.source,
        candidate.regex.flags.includes('g') ? candidate.regex.flags : `${candidate.regex.flags}g`,
      );
      let match: RegExpExecArray | null;
      let found: { at: number; length: number; token: InlineToken } | null = null;
      while ((match = regex.exec(rest)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex += 1;
          continue;
        }
        if (candidate.guard && !candidate.guard(match, match.index, rest)) continue;
        const token = candidate.build(match);
        if (!token) continue;
        found = { at: match.index, length: match[0].length, token };
        break;
      }
      if (found && (best === null || found.at < best.at)) best = found;
    }

    if (!best) {
      pushText(tokens, rest.replace(ESCAPE, '$1'));
      break;
    }

    if (best.at > 0) pushText(tokens, rest.slice(0, best.at).replace(ESCAPE, '$1'));
    tokens.push(best.token);
    rest = rest.slice(best.at + best.length);
  }

  return tokens;
}

interface ListLine {
  indent: number;
  ordered: boolean;
  number: number;
  text: string;
}

function parseListLine(raw: string): ListLine | null {
  const line = raw.replace(/\t/g, '  ');
  const indent = line.length - line.trimStart().length;
  const trimmed = line.trim();

  const ordered = OL.exec(trimmed);
  if (ordered) {
    return {
      indent: Math.floor(indent / 2),
      ordered: true,
      number: Number.parseInt(ordered[1]!, 10),
      text: trimmed.replace(OL, ''),
    };
  }

  if (UL.test(trimmed)) {
    return {
      indent: Math.floor(indent / 2),
      ordered: false,
      number: 1,
      text: trimmed.replace(UL, ''),
    };
  }

  return null;
}

/** Builds (possibly nested) list blocks from consecutive list lines. */
function buildLists(lines: ListLine[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let cursor = 0;

  const build = (depth: number): MarkdownBlock | null => {
    const first = lines[cursor];
    if (!first) return null;
    const ordered = first.ordered;
    const start = first.number;
    const items: ListItem[] = [];

    while (cursor < lines.length) {
      const line = lines[cursor]!;
      if (line.indent > depth) {
        const nested = build(line.indent);
        const lastItem = items.at(-1);
        if (nested && lastItem) lastItem.children.push(nested);
        else cursor += 1; // never stall on an unexpected line
        continue;
      }
      if (line.indent < depth || line.ordered !== ordered) break;
      items.push({ inline: parseInline(line.text), children: [] });
      cursor += 1;
    }

    if (items.length === 0) return null;
    return { kind: 'list', ordered, start, items };
  };

  while (cursor < lines.length) {
    const block = build(lines[cursor]!.indent);
    if (!block) {
      cursor += 1;
      continue;
    }
    blocks.push(block);
  }

  return blocks;
}

function splitRow(line: string): InlineToken[][] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()));
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function parseTableAlign(line: string): ('left' | 'center' | 'right')[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => {
      const value = cell.trim();
      const left = value.startsWith(':');
      const right = value.endsWith(':');
      if (left && right) return 'center' as const;
      if (right) return 'right' as const;
      return 'left' as const;
    });
}

function isBlockStart(line: string): boolean {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    QUOTE.test(line) ||
    DIVIDER.test(line.replace(/\s+$/, '')) ||
    MATH_OPEN.test(line) ||
    parseListLine(line) !== null
  );
}

/** Parses an AI answer into renderable blocks. */
export function parseBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const flushParagraph = (buffer: string[]): void => {
    if (buffer.length === 0) return;
    const joined = buffer.join(' ').trim();
    buffer.length = 0;
    if (joined) blocks.push({ kind: 'paragraph', inline: parseInline(joined) });
  };

  while (index < lines.length) {
    const raw = lines[index]!;
    const line = raw.trimEnd();

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // Fenced code block — content is never parsed as markdown.
    const fence = FENCE.exec(raw);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      index += 1; // closing fence (or end of input)
      blocks.push({
        kind: 'code',
        language: fence[2] ? fence[2] : null,
        code: body.join('\n').replace(/\s+$/, ''),
      });
      continue;
    }

    // Display math: $$ … $$ or \[ … \] (tolerates a mismatched closing token).
    if (MATH_OPEN.test(raw)) {
      const firstLine = raw.replace(MATH_OPEN, '');
      // A complete one-line display must not swallow the following paragraph.
      if (MATH_CLOSE.test(firstLine)) {
        const closing = MATH_CLOSE.exec(firstLine)!;
        const value = formatMath(firstLine.slice(0, closing.index));
        if (value) blocks.push({ kind: 'math', value });
        const trailing = firstLine.slice(closing.index + closing[0].length).trim();
        if (trailing) blocks.push({ kind: 'paragraph', inline: parseInline(trailing) });
        index += 1;
        continue;
      }
      const body: string[] = [firstLine];
      index += 1;
      while (index < lines.length) {
        const current = lines[index]!;
        if (MATH_CLOSE.test(current)) {
          body.push(current.replace(MATH_CLOSE, ''));
          index += 1;
          break;
        }
        if (current.trim() === '' && body.join('').trim() !== '') {
          index += 1;
          break;
        }
        body.push(current);
        index += 1;
      }
      const value = formatMath(body.join('\n'));
      if (value) blocks.push({ kind: 'math', value });
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length,
        inline: parseInline(raw.replace(HEADING, '').trim()),
      });
      index += 1;
      continue;
    }

    if (DIVIDER.test(line)) {
      blocks.push({ kind: 'divider' });
      index += 1;
      continue;
    }

    if (QUOTE.test(raw)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index]!)) {
        quoted.push(lines[index]!.replace(QUOTE, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(quoted.join('\n')) });
      continue;
    }

    // Pipe table: header row + divider row.
    if (raw.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1]!)) {
      const header = splitRow(raw);
      const align = parseTableAlign(lines[index + 1]!);
      index += 2;
      const rows: InlineToken[][][] = [];
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim() !== '') {
        const row = splitRow(lines[index]!);
        if (row.length > 0) rows.push(row);
        index += 1;
      }
      blocks.push({ kind: 'table', align, header, rows });
      continue;
    }

    const listLine = parseListLine(raw);
    if (listLine) {
      const group: ListLine[] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        const parsed = parseListLine(current);
        if (!parsed) {
          // A wrapped continuation line belongs to the previous item.
          if (group.length > 0 && current.trim() !== '' && /^\s{2,}\S/.test(current)) {
            group[group.length - 1]!.text += ` ${current.trim()}`;
            index += 1;
            continue;
          }
          break;
        }
        group.push(parsed);
        index += 1;
      }
      blocks.push(...buildLists(group));
      continue;
    }

    // Plain paragraph: consecutive lines that do not start another block.
    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index]!.trim() !== '' && !isBlockStart(lines[index]!)) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    flushParagraph(paragraph);
  }

  return blocks;
}
