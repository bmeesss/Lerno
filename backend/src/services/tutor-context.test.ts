import { describe, expect, it } from 'vitest';
import type { StudyPackSourceRecord } from '../lib/db/types.js';
import { sourceExcerptFor } from './learn-content.js';
import { extractCitations } from './tutor-context.js';

const source = (id: string, title: string, labels: string[] = []) =>
  ({
    id,
    title,
    metadata: {
      references: labels.map((label, index) => ({
        marker: `p${index + 1}`,
        kind: 'page' as const,
        label,
        start: index * 100,
        page: index + 1,
        slide: null,
        startSeconds: null,
        endSeconds: null,
      })),
    },
  }) as unknown as Pick<StudyPackSourceRecord, 'id' | 'title' | 'metadata'>;

describe('tutor citations', () => {
  const sources = [source('s1', 'Biologie H3.pdf', ['page 1', 'page 6']), source('s2', 'Notes.md')];

  it('accepts a citation that names a real source and a real place in it', () => {
    expect(
      extractCitations('Mitose is celdeling. [Source: Biologie H3.pdf · page 6]', sources),
    ).toEqual([{ sourceId: 's1', title: 'Biologie H3.pdf', ref: 'page 6' }]);
  });

  it('keeps the source but drops a place it does not have', () => {
    expect(extractCitations('… [Source: Biologie H3.pdf · page 99]', sources)).toEqual([
      { sourceId: 's1', title: 'Biologie H3.pdf', ref: null },
    ]);
  });

  it('drops invented sources and tolerates a missing file extension', () => {
    expect(extractCitations('… [Source: Made Up Book · page 3]', sources)).toEqual([]);
    expect(extractCitations('… [Source: Notes]', sources)).toEqual([
      { sourceId: 's2', title: 'Notes.md', ref: null },
    ]);
    expect(extractCitations('No citations here.', sources)).toEqual([]);
  });

  it('lists each cited place once', () => {
    const reply =
      'A [Source: Biologie H3.pdf · page 6] and again [Source: Biologie H3.pdf · page 6].';
    expect(extractCitations(reply, sources)).toHaveLength(1);
  });
});

describe('source excerpts', () => {
  const text =
    'Intro text about cells. '.repeat(5) +
    'Osmosis moves water across a membrane. '.repeat(3) +
    'Closing words.';
  const references = [
    { label: 'page 1', start: 0 },
    { label: 'page 2', start: 120 },
  ];

  it('uses the stored reference when the concept has one', () => {
    const excerpt = sourceExcerptFor({ name: 'Osmosis', refLabel: 'page 2' }, { text, references });
    expect(excerpt).toMatchObject({ match: 'reference', ref: 'page 2' });
    expect(excerpt.text.startsWith('Osmosis moves water')).toBe(true);
  });

  it('falls back to where the concept is mentioned, then to the start of the source', () => {
    const mention = sourceExcerptFor({ name: 'Osmosis', refLabel: null }, { text, references: [] });
    expect(mention.match).toBe('mention');
    expect(mention.text).toContain('Osmosis moves water');
    const start = sourceExcerptFor(
      { name: 'Photosynthesis', refLabel: null },
      { text, references: [] },
    );
    expect(start.match).toBe('start');
    expect(start.text.startsWith('Intro text')).toBe(true);
  });
});
