import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownLite } from './MarkdownLite';

describe('MarkdownLite', () => {
  it.each(['-', '*'])('renders %s school bullets as real list items', (marker) => {
    const { container } = render(
      <MarkdownLite
        text={`## Franse Revolutie\n${marker} Belangrijke gebeurtenissen\n${marker} Lodewijk XVI`}
      />,
    );
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelector('ul > li')?.textContent).toBe('Belangrijke gebeurtenissen');
  });

  it.each(['$$c^2 = a^2 + b^2$$', '\\[c^2 = a^2 + b^2\\]'])(
    'does not swallow text after one-line display math: %s',
    (formula) => {
      const { container } = render(
        <MarkdownLite text={`${formula}\nDe schuine zijde is c.\n1. Vul in\n2. Reken uit`} />,
      );
      expect(container.querySelector('.ai-md-math')?.textContent).toBe('c² = a² + b²');
      expect(container.querySelector('p')?.textContent).toBe('De schuine zijde is c.');
      expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    },
  );

  it('preserves text on the same line after display math', () => {
    const { container } = render(
      <MarkdownLite text={'$$F = m \u00d7 g$$ Gewicht is een kracht.'} />,
    );
    expect(container.querySelector('p')?.textContent).toBe('Gewicht is een kracht.');
  });

  it('renders bold, italic, inline code and lists', () => {
    const { container } = render(
      <MarkdownLite text={'**Fotosynthese** werkt zo:\n1. Licht\n2. Water'} />,
    );

    expect(screen.getByText('Fotosynthese').tagName).toBe('STRONG');
    expect(screen.getByText('Licht')).toBeInTheDocument();
    expect(container.querySelector('ol.ai-md-list')).not.toBeNull();
    expect(container.querySelectorAll('ol.ai-md-list > li')).toHaveLength(2);
  });

  it('renders headings as real headings', () => {
    const { container } = render(<MarkdownLite text={'## Stappen\n### Detail'} />);
    const headings = Array.from(container.querySelectorAll('h3, h4, h5, h6'));
    expect(headings.map((element) => element.tagName)).toEqual(['H4', 'H5']);
  });

  it('renders fenced code blocks with their language', () => {
    const { container } = render(<MarkdownLite text={'```python\nprint("hallo")\n```'} />);

    expect(screen.getByText('python')).toBeInTheDocument();
    expect(container.querySelector('pre.ai-md-pre code')?.textContent).toBe('print("hallo")');
  });

  it('renders pipe tables as tables, not as flat text', () => {
    const { container } = render(
      <MarkdownLite text={'| Orgaan | Functie |\n| --- | --- |\n| Blad | Fotosynthese |'} />,
    );

    const table = container.querySelector('table.ai-md-table');
    expect(table).not.toBeNull();
    expect(Array.from(table!.querySelectorAll('th')).map((cell) => cell.textContent)).toEqual([
      'Orgaan',
      'Functie',
    ]);
    expect(Array.from(table!.querySelectorAll('tbody td')).map((cell) => cell.textContent)).toEqual(
      ['Blad', 'Fotosynthese'],
    );
  });

  it('renders inline formulas readably', () => {
    const { container } = render(
      <MarkdownLite text={'De stelling van Pythagoras: $a^2+b^2=c^2$ en \\(\\frac{1}{2}\\).'} />,
    );

    const inline = Array.from(container.querySelectorAll('.ai-md-math-inline')).map(
      (node) => node.textContent,
    );
    expect(inline).toEqual(['a²+b²=c²', '1/2']);
  });

  it('renders display math as its own block, even with a broken closing token', () => {
    const { container } = render(<MarkdownLite text={'$$\na^2+b^2=c^2\n\\]'} />);
    expect(container.querySelector('.ai-md-math')?.textContent).toBe('a²+b²=c²');
  });

  it('renders blockquotes and dividers', () => {
    const { container } = render(<MarkdownLite text={'> Onthoud dit\n\n---\n\nTekst'} />);
    expect(container.querySelector('blockquote.ai-md-quote')).not.toBeNull();
    expect(container.querySelector('hr.ai-md-divider')).not.toBeNull();
  });

  it('renders safe links with protection attributes', () => {
    const { container } = render(
      <MarkdownLite text={'[Wikipedia](https://nl.wikipedia.org/wiki/Fotosynthese)'} />,
    );
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://nl.wikipedia.org/wiki/Fotosynthese');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('never turns model output into HTML or script', () => {
    const { container } = render(
      <MarkdownLite
        text={
          '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[klik](javascript:alert(1))'
        }
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    // The text is shown as text, escaped by React.
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders a long answer completely', () => {
    const text = Array.from(
      { length: 30 },
      (_, index) => `## Kop ${index}\n\nUitleg ${index} met **vet**.\n\n- punt ${index}`,
    ).join('\n\n');

    const { container } = render(<MarkdownLite text={text} />);
    expect(container.querySelectorAll('.ai-md-heading')).toHaveLength(30);
    expect(container.querySelectorAll('.ai-md-list')).toHaveLength(30);
    expect(container.querySelector('.ai-markdown')?.textContent).toContain('Uitleg 29 met vet.');
  });
});
