import { describe, expect, it } from 'vitest';
import { formatMath } from './mathLite';

describe('formatMath', () => {
  it('renders the Pythagorean formula readably', () => {
    expect(formatMath('a^2+b^2=c^2')).toBe('a²+b²=c²');
  });

  it('handles display math delimiters', () => {
    expect(formatMath('$$a^2+b^2=c^2$$')).toBe('a²+b²=c²');
    expect(formatMath('\\[ x = \\frac{1}{2} \\]')).toBe('x = 1/2');
    expect(formatMath('\\(E = mc^2\\)')).toBe('E = mc²');
  });

  it('converts fractions', () => {
    expect(formatMath('\\frac{1}{2}')).toBe('1/2');
    expect(formatMath('\\frac{a+b}{2}')).toBe('(a+b)/2');
    expect(formatMath('\\dfrac{3}{4}')).toBe('3/4');
  });

  it('converts roots', () => {
    expect(formatMath('\\sqrt{25}')).toBe('√(25)');
    expect(formatMath('\\sqrt[3]{8}')).toBe('3√(8)');
  });

  it('converts sub- and superscripts', () => {
    expect(formatMath('x_{1}')).toBe('x₁');
    expect(formatMath('x^{10}')).toBe('x¹⁰');
    expect(formatMath('H_2O')).toBe('H₂O');
    expect(formatMath('x^{n+1}')).toBe('xⁿ⁺¹');
    // Long or unmapped exponents stay readable instead of becoming noise.
    expect(formatMath('x^{(complicated)}')).toBe('x^(complicated)');
  });

  it('converts common symbols', () => {
    expect(formatMath('2 \\times 3')).toBe('2 × 3');
    expect(formatMath('a \\leq b')).toBe('a ≤ b');
    expect(formatMath('\\alpha + \\beta')).toBe('α + β');
    expect(formatMath('\\pi r^2')).toBe('π r²');
    expect(formatMath('x \\rightarrow \\infty')).toBe('x → ∞');
  });

  it('keeps literal text inside \\text{}', () => {
    expect(formatMath('\\text{snelheid} = 5')).toBe('snelheid = 5');
  });

  it('drops layout commands and unknown backslashes safely', () => {
    expect(formatMath('\\left( a \\right)')).toBe('( a )');
    expect(formatMath('\\foo')).toBe('foo');
  });

  it('collapses whitespace and handles empty input', () => {
    expect(formatMath('')).toBe('');
    expect(formatMath('  a   +   b  ')).toBe('a + b');
  });
});
