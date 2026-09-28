import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './markdownLite';

describe('parseInline', () => {
  it('returns plain text untouched', () => {
    expect(parseInline('plain text')).toEqual([{ kind: 'text', value: 'plain text' }]);
  });

  it('parses bold and inline code', () => {
    expect(parseInline('a **bold** and `code` part')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'bold', value: 'bold' },
      { kind: 'text', value: ' and ' },
      { kind: 'code', value: 'code' },
      { kind: 'text', value: ' part' },
    ]);
  });

  it('leaves unmatched markers as literal text', () => {
    expect(parseInline('2 ** 3 en ` backtick')).toEqual([
      { kind: 'text', value: '2 ** 3 en ` backtick' },
    ]);
  });
});

describe('parseBlocks', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseBlocks('First paragraph.\nContinued line.\n\nSecond paragraph.');
    expect(blocks).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', value: 'First paragraph. Continued line.' }] },
      { kind: 'paragraph', inline: [{ kind: 'text', value: 'Second paragraph.' }] },
    ]);
  });

  it('parses headings, ordered and unordered lists', () => {
    const blocks = parseBlocks(
      '## Stappen\n1. Eerste stap\n2. Tweede stap\n\n- punt a\n- punt b\n* punt c',
    );
    expect(blocks).toEqual([
      { kind: 'heading', inline: [{ kind: 'text', value: 'Stappen' }] },
      {
        kind: 'list',
        ordered: true,
        items: [[{ kind: 'text', value: 'Eerste stap' }], [{ kind: 'text', value: 'Tweede stap' }]],
      },
      {
        kind: 'list',
        ordered: false,
        items: [
          [{ kind: 'text', value: 'punt a' }],
          [{ kind: 'text', value: 'punt b' }],
          [{ kind: 'text', value: 'punt c' }],
        ],
      },
    ]);
  });

  it('keeps bold inside list items', () => {
    const blocks = parseBlocks('- **chlorofyl:** groene kleurstof');
    expect(blocks[0]).toEqual({
      kind: 'list',
      ordered: false,
      items: [
        [
          { kind: 'bold', value: 'chlorofyl:' },
          { kind: 'text', value: ' groene kleurstof' },
        ],
      ],
    });
  });

  it('returns an empty array for empty text', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n\n  \n')).toEqual([]);
  });

  it('treats HTML-looking input as plain text (React escapes it on render)', () => {
    const blocks = parseBlocks('<script>alert(1)</script>\n- <img src=x onerror=alert(1)>');
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      inline: [{ kind: 'text', value: '<script>alert(1)</script>' }],
    });
    expect(blocks[1]).toEqual({
      kind: 'list',
      ordered: false,
      items: [[{ kind: 'text', value: '<img src=x onerror=alert(1)>' }]],
    });
  });
});
