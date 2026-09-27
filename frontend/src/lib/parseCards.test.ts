import { describe, expect, it } from 'vitest';
import {
  parseCardCsv,
  parseCardCsvDetailed,
  parseCardLines,
  parseCardLinesDetailed,
} from './parseCards';

describe('parseCardLines', () => {
  it('parses pipe-separated lines', () => {
    expect(parseCardLines('What is 2+2? | 4\nCapital of France? | Paris')).toEqual([
      { question: 'What is 2+2?', answer: '4' },
      { question: 'Capital of France?', answer: 'Paris' },
    ]);
  });

  it('parses tab-separated lines and skips blanks/invalid', () => {
    const text = 'Q1\tA1\n\nno separator here\nQ2\tA2';
    expect(parseCardLines(text)).toEqual([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ]);
  });

  it('keeps separators inside the answer', () => {
    expect(parseCardLines('Why? | because | I said so')).toEqual([
      { question: 'Why?', answer: 'because | I said so' },
    ]);
  });
});

describe('parseCardCsv', () => {
  it('parses CSV with quoted fields and a header row', () => {
    const csv =
      'question,answer\n"Who wrote ""De avonden""?","Gerard Reve"\nYear of the flood?,1953';
    expect(parseCardCsv(csv)).toEqual([
      { question: 'Who wrote "De avonden"?', answer: 'Gerard Reve' },
      { question: 'Year of the flood?', answer: '1953' },
    ]);
  });

  it('parses headerless CSV', () => {
    expect(parseCardCsv('Q,A')).toEqual([{ question: 'Q', answer: 'A' }]);
  });
});

describe('detailed parsers (import preview)', () => {
  it('reports cards plus skipped lines with 1-based numbers', () => {
    const parsed = parseCardLinesDetailed('Q1 | A1\nno separator\n\n | \nQ2\tA2');
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.skipped).toEqual([
      { line: 2, text: 'no separator' },
      { line: 4, text: '|' },
    ]);
  });

  it('reports CSV rows plus skipped rows, ignoring the header', () => {
    const parsed = parseCardCsvDetailed('question,answer\nQ1,A1\nonly-one-column\nQ2,A2');
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.skipped).toEqual([{ line: 3, text: 'only-one-column' }]);
  });
});
