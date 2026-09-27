/**
 * Card import helpers for the set editor: parse pasted text or CSV into
 * question/answer pairs. Pure functions (presentation input handling only).
 */

export interface ParsedCard {
  question: string;
  answer: string;
}

function splitRow(line: string): ParsedCard | null {
  const tab = line.split('\t');
  if (tab.length >= 2) return clean(tab[0]!, tab.slice(1).join('\t'));

  const pipe = line.split('|');
  if (pipe.length >= 2) return clean(pipe[0]!, pipe.slice(1).join('|'));

  const colons = line.split('::');
  if (colons.length >= 2) return clean(colons[0]!, colons.slice(1).join('::'));

  return null;
}

function clean(question: string, answer: string): ParsedCard | null {
  const q = question.trim();
  const a = answer.trim();
  if (!q || !a) return null;
  return { question: q, answer: a };
}

/** Parses "question | answer" (or tab / :: separated) lines. */
export function parseCardLines(text: string): ParsedCard[] {
  const cards: ParsedCard[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const card = splitRow(line);
    if (card) cards.push(card);
  }
  return cards;
}

/** Minimal CSV parser (RFC-4180-ish: quotes, escaped quotes, commas). */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

/** Parses CSV where column 1 = question, column 2 = answer (header optional). */
export function parseCardCsv(text: string): ParsedCard[] {
  const rows = parseCsvRows(text);
  const cards: ParsedCard[] = [];
  for (const [index, row] of rows.entries()) {
    if (index === 0 && /question/i.test(row[0] ?? '') && /answer/i.test(row[1] ?? '')) {
      continue; // header row
    }
    const card = clean(row[0] ?? '', row[1] ?? '');
    if (card) cards.push(card);
  }
  return cards;
}
