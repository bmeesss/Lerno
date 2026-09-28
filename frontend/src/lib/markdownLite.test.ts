import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './markdownLite';

function paragraphs(text: string): string[] {
  return parseBlocks(text)
    .filter((block) => block.kind === 'paragraph')
    .map((block) => (block.kind === 'paragraph' ? block.inline.map((t) => t.value).join('') : ''));
}

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

  it('parses italic and strikethrough', () => {
    expect(parseInline('dit is *belangrijk* en dit ~~niet~~')).toEqual([
      { kind: 'text', value: 'dit is ' },
      { kind: 'italic', value: 'belangrijk' },
      { kind: 'text', value: ' en dit ' },
      { kind: 'strike', value: 'niet' },
    ]);
  });

  it('does not treat snake_case as italic', () => {
    expect(parseInline('gebruik max_value hier')).toEqual([
      { kind: 'text', value: 'gebruik max_value hier' },
    ]);
  });

  it('parses safe links only', () => {
    expect(parseInline('zie [Wikipedia](https://nl.wikipedia.org/wiki/Fotosynthese)')).toEqual([
      { kind: 'text', value: 'zie ' },
      {
        kind: 'link',
        value: 'Wikipedia',
        href: 'https://nl.wikipedia.org/wiki/Fotosynthese',
      },
    ]);

    // javascript: and data: URLs must never become links.
    expect(parseInline('[klik](javascript:alert(1))')).toEqual([
      { kind: 'text', value: '[klik](javascript:alert(1))' },
    ]);
  });

  it('removes markdown escape characters from visible text', () => {
    expect(parseInline('2 \\* 3 = 6')).toEqual([{ kind: 'text', value: '2 * 3 = 6' }]);
  });

  it('formulas become readable math tokens', () => {
    expect(parseInline('de formule $a^2+b^2=c^2$ klopt')).toEqual([
      { kind: 'text', value: 'de formule ' },
      { kind: 'math', value: 'a²+b²=c²' },
      { kind: 'text', value: ' klopt' },
    ]);
    expect(parseInline('\\(x = \\frac{1}{2}\\)')).toEqual([{ kind: 'math', value: 'x = 1/2' }]);
  });

  it('does not treat currency as math', () => {
    expect(parseInline('dat kost 5$ en 10$')).toEqual([
      { kind: 'text', value: 'dat kost 5$ en 10$' },
    ]);
  });
});

describe('parseBlocks', () => {
  it('splits paragraphs on blank lines', () => {
    expect(paragraphs('First paragraph.\nContinued line.\n\nSecond paragraph.')).toEqual([
      'First paragraph. Continued line.',
      'Second paragraph.',
    ]);
  });

  it('parses headings with their level', () => {
    const blocks = parseBlocks('## Stappen\n### Substap');
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, inline: [{ kind: 'text', value: 'Stappen' }] },
      { kind: 'heading', level: 3, inline: [{ kind: 'text', value: 'Substap' }] },
    ]);
  });

  it('parses ordered and unordered lists', () => {
    const blocks = parseBlocks(
      '## Stappen\n1. Eerste stap\n2. Tweede stap\n\n- punt a\n- punt b\n* punt c',
    );
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, inline: [{ kind: 'text', value: 'Stappen' }] },
      {
        kind: 'list',
        ordered: true,
        start: 1,
        items: [
          { inline: [{ kind: 'text', value: 'Eerste stap' }], children: [] },
          { inline: [{ kind: 'text', value: 'Tweede stap' }], children: [] },
        ],
      },
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          { inline: [{ kind: 'text', value: 'punt a' }], children: [] },
          { inline: [{ kind: 'text', value: 'punt b' }], children: [] },
          { inline: [{ kind: 'text', value: 'punt c' }], children: [] },
        ],
      },
    ]);
  });

  it('keeps the numbering of a list that does not start at 1', () => {
    const [list] = parseBlocks('3. derde\n4. vierde');
    expect(list).toMatchObject({ kind: 'list', ordered: true, start: 3 });
  });

  it('supports nested lists', () => {
    const [list] = parseBlocks('- hoofdstap\n  - substep\n  - nog een\n- tweede');
    expect(list).toMatchObject({
      kind: 'list',
      ordered: false,
      items: [
        { inline: [{ kind: 'text', value: 'hoofdstap' }], children: [{ kind: 'list' }] },
        { inline: [{ kind: 'text', value: 'tweede' }], children: [] },
      ],
    });
  });

  it('keeps bold inside list items', () => {
    const blocks = parseBlocks('- **chlorofyl:** groene kleurstof');
    expect(blocks[0]).toMatchObject({
      kind: 'list',
      ordered: false,
      items: [
        {
          inline: [
            { kind: 'bold', value: 'chlorofyl:' },
            { kind: 'text', value: ' groene kleurstof' },
          ],
          children: [],
        },
      ],
    });
  });

  it('parses fenced code blocks without touching their content', () => {
    const blocks = parseBlocks('```python\nprint("**not bold**")\n```\nTekst erna.');
    expect(blocks[0]).toEqual({
      kind: 'code',
      language: 'python',
      code: 'print("**not bold**")',
    });
    expect(blocks[1]).toMatchObject({ kind: 'paragraph' });
  });

  it('parses blockquotes', () => {
    const blocks = parseBlocks('> Onthoud dit\n> en dit');
    expect(blocks).toEqual([
      {
        kind: 'quote',
        blocks: [{ kind: 'paragraph', inline: [{ kind: 'text', value: 'Onthoud dit en dit' }] }],
      },
    ]);
  });

  it('parses simple pipe tables', () => {
    const blocks = parseBlocks(
      '| Orgaan | Functie |\n| --- | --- |\n| Blad | Fotosynthese |\n| Wortel | Water opnemen |',
    );
    expect(blocks).toEqual([
      {
        kind: 'table',
        align: ['left', 'left'],
        header: [[{ kind: 'text', value: 'Orgaan' }], [{ kind: 'text', value: 'Functie' }]],
        rows: [
          [[{ kind: 'text', value: 'Blad' }], [{ kind: 'text', value: 'Fotosynthese' }]],
          [[{ kind: 'text', value: 'Wortel' }], [{ kind: 'text', value: 'Water opnemen' }]],
        ],
      },
    ]);
  });

  it('parses display math written by the model, even with a broken closing token', () => {
    const blocks = parseBlocks('$$\na^2+b^2=c^2\n\\]');
    expect(blocks).toEqual([{ kind: 'math', value: 'a²+b²=c²' }]);
  });

  it('parses display math with matching delimiters', () => {
    expect(parseBlocks('$$x = \\frac{-b}{2a}$$')).toEqual([{ kind: 'math', value: 'x = (-b)/2a' }]);
    expect(parseBlocks('\\[ E = mc^2 \\]')).toEqual([{ kind: 'math', value: 'E = mc²' }]);
  });

  it('parses horizontal dividers', () => {
    expect(parseBlocks('boven\n\n---\n\nonder')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', value: 'boven' }] },
      { kind: 'divider' },
      { kind: 'paragraph', inline: [{ kind: 'text', value: 'onder' }] },
    ]);
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
    expect(blocks[1]).toMatchObject({
      kind: 'list',
      ordered: false,
      items: [{ inline: [{ kind: 'text', value: '<img src=x onerror=alert(1)>' }], children: [] }],
    });
  });

  it('handles a long realistic answer without dropping content', () => {
    const answer = Array.from(
      { length: 12 },
      (_, index) =>
        `## Kop ${index}\n\nUitleg ${index} met **vet** en \`code\`.\n\n- punt ${index}a\n- punt ${index}b`,
    ).join('\n\n');

    const blocks = parseBlocks(answer);
    expect(blocks.filter((block) => block.kind === 'heading')).toHaveLength(12);
    expect(blocks.filter((block) => block.kind === 'list')).toHaveLength(12);
    expect(blocks.filter((block) => block.kind === 'paragraph')).toHaveLength(12);
  });
});
