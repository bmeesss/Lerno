import { normalizeText } from '../services/ai-context.js';

export interface TextSourceContextInput {
  title: string;
  kind: 'text' | 'pdf';
  text: string;
  pageCount?: number;
  extractedChars?: number;
  truncated?: boolean;
}

const MAX_LINE_CHARS = 1_500;

/**
 * Normalize and de-duplicate pasted/document text before it reaches Groq.
 * Long sources are represented by bounded beginning and ending excerpts, with
 * an explicit omission marker rather than silently implying full coverage.
 */
export function buildTextContext(source: TextSourceContextInput, maxChars: number): string {
  const seen = new Set<string>();
  const paragraphs: string[] = [];
  for (const rawLine of source.text.replace(/\r\n?/g, '\n').split(/\n+/)) {
    const line = normalizeText(rawLine, MAX_LINE_CHARS);
    if (!line) continue;
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paragraphs.push(line);
  }

  const content = paragraphs.join('\n');
  const budget = Math.max(500, maxChars);
  const header = [
    `SOURCE TYPE: ${source.kind === 'pdf' ? 'PDF document' : 'pasted text'}`,
    `SOURCE TITLE: ${normalizeText(source.title, 120) || 'Study material'}`,
    source.kind === 'pdf' && source.pageCount !== undefined ? `PDF PAGES: ${source.pageCount}` : null,
    source.extractedChars !== undefined ? `EXTRACTED CHARACTERS: ${source.extractedChars}` : null,
    source.truncated ? 'NOTE: The extracted source was capped; not all source text is included.' : null,
    'SOURCE CONTENT (normalized, duplicate lines removed):',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
  const available = Math.max(200, budget - header.length - 80);
  if (content.length <= available) return `${header}\n${content}`;

  const marker = '\n[Middle of source omitted to fit the task context limit]\n';
  const half = Math.floor((available - marker.length) / 2);
  const excerpt = `${content.slice(0, half).trimEnd()}${marker}${content.slice(-half).trimStart()}`;
  return `${header}\n${excerpt}`;
}

/** Wraps already-authorized set text in Studio provenance and a task-specific cap. */
export function buildSetSourceContext(title: string, context: string, maxChars: number): string {
  const safeTitle = normalizeText(title, 120) || 'Study set';
  const source = `SOURCE TYPE: Lerno study set\nSOURCE TITLE: ${safeTitle}\nSET CONTENT:\n${normalizeText(context, 40_000)}`;
  const budget = Math.max(500, maxChars);
  if (source.length <= budget) return source;
  const marker = '\n[Set context shortened for this task]\n';
  const half = Math.floor((budget - marker.length) / 2);
  return `${source.slice(0, half).trimEnd()}${marker}${source.slice(-half).trimStart()}`;
}
