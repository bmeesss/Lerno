/**
 * Minimal, safe markdown parsing for AI answers.
 *
 * Lerno AI replies contain light markdown (headings, lists, bold, inline
 * code). This parser keeps rendering React-safe: no HTML is ever injected,
 * so model output can never smuggle markup into the page.
 */

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'code'; value: string };

export type MarkdownBlock =
  | { kind: 'paragraph'; inline: InlineToken[] }
  | { kind: 'heading'; inline: InlineToken[] }
  | { kind: 'list'; ordered: boolean; items: InlineToken[][] };

const BOLD_OR_CODE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/;

/** Splits a line into text/bold/code tokens. */
export function parseInline(line: string): InlineToken[] {
  return line
    .split(BOLD_OR_CODE)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return { kind: 'bold' as const, value: part.slice(2, -2) };
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return { kind: 'code' as const, value: part.slice(1, -1) };
      }
      return { kind: 'text' as const, value: part };
    });
}

const UL = /^[-*•]\s+/;
const OL = /^\d{1,3}[.)]\s+/;
const HEADING = /^#{1,6}\s+/;

/** Parses an AI answer into paragraph / heading / list blocks. */
export function parseBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({ kind: 'paragraph', inline: parseInline(paragraphLines.join(' ')) });
    paragraphLines.length = 0;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    if (HEADING.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'heading', inline: parseInline(line.replace(HEADING, '')) });
      continue;
    }

    const isOrdered = OL.test(line);
    const isUnordered = UL.test(line);
    if (isOrdered || isUnordered) {
      flushParagraph();
      const content = line.replace(isOrdered ? OL : UL, '');
      const last = blocks.at(-1);
      if (last && last.kind === 'list' && last.ordered === isOrdered) {
        last.items.push(parseInline(content));
      } else {
        blocks.push({ kind: 'list', ordered: isOrdered, items: [parseInline(content)] });
      }
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}
