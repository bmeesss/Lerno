/**
 * Tiny LaTeX → readable-text converter for Lerno AI answers.
 *
 * A full math renderer (KaTeX/MathJax) is far too heavy for the chat page, but
 * raw `$$a^2+b^2=c^2$$` is unreadable. This module makes the formulas students
 * actually see in school maths readable: powers, roots, fractions, Greek
 * letters and the common operators.
 *
 * It only ever produces **plain text** — React escapes it on render, so model
 * output can never inject markup through a formula.
 */

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
  r: 'ʳ',
  v: 'ᵛ',
  x: 'ˣ',
  T: 'ᵀ',
};

const SUBSCRIPT: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
};

/** Commands whose argument is literal text, not math. */
const TEXT_COMMANDS = new Set([
  'text',
  'textrm',
  'mathrm',
  'mathbf',
  'mathit',
  'operatorname',
  'mbox',
]);

/** Symbols replaced before any unknown command is stripped. */
const SYMBOLS: Record<string, string> = {
  // Operators
  times: '×',
  cdot: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  ast: '∗',
  // Relations
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '~',
  propto: '∝',
  cong: '≅',
  // Greek
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  Delta: 'Δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  Sigma: 'Σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'ϕ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Omega: 'Ω',
  // Big operators / misc
  sum: 'Σ',
  prod: '∏',
  int: '∫',
  oint: '∮',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  emptyset: '∅',
  angle: '∠',
  triangle: '△',
  perp: '⊥',
  parallel: '∥',
  degree: '°',
  circ: '°',
  prime: '′',
  // Arrows
  rightarrow: '→',
  leftarrow: '←',
  leftrightarrow: '↔',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  to: '→',
  mapsto: '↦',
  // Set / logic
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  cup: '∪',
  cap: '∩',
  forall: '∀',
  exists: '∃',
  neg: '¬',
  land: '∧',
  lor: '∨',
  // Ellipsis / spacing
  ldots: '…',
  dots: '…',
  cdots: '⋯',
  quad: ' ',
  qquad: '  ',
  ',': ' ',
  ';': ' ',
  ':': ' ',
  '!': '',
  ' ': ' ',
  // Literal characters
  '%': '%',
  $: '$',
  '&': '&',
  _: '_',
  '#': '#',
  '{': '{',
  '}': '}',
  // Layout commands that carry no plain-text meaning
  left: '',
  right: '',
  displaystyle: '',
  textstyle: '',
  limits: '',
  nolimits: '',
  begin: '',
  end: '',
};

/** Reads a balanced `{ … }` group starting at `open` (which must be `{`). */
function readBraced(src: string, index: number): { content: string; end: number } | null {
  if (src[index] !== '{') return null;
  let depth = 0;
  for (let i = index; i < src.length; i += 1) {
    const char = src[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return { content: src.slice(index + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Reads an optional `[ … ]` argument (used by `\sqrt[3]{x}`). */
function readBracket(src: string, index: number): { content: string; end: number } | null {
  if (src[index] !== '[') return null;
  const close = src.indexOf(']', index);
  if (close === -1) return null;
  return { content: src.slice(index + 1, close), end: close + 1 };
}

function wrap(sign: '^' | '_', value: string): string {
  if (/^\(.*\)$/.test(value)) return `${sign}${value}`;
  return `${sign}(${value})`;
}

function toSuper(value: string): string {
  if (value.length === 0) return '';
  if (value.length > 6) return wrap('^', value);
  let out = '';
  for (const char of value) {
    const mapped = SUPERSCRIPT[char];
    if (mapped === undefined) return wrap('^', value);
    out += mapped;
  }
  return out;
}

function toSub(value: string): string {
  if (value.length === 0) return '';
  if (value.length > 6) return wrap('_', value);
  let out = '';
  for (const char of value) {
    const mapped = SUBSCRIPT[char];
    if (mapped === undefined) return wrap('_', value);
    out += mapped;
  }
  return out;
}

function fraction(numerator: string, denominator: string): string {
  const simple = (value: string): boolean => /^[A-Za-z0-9πθαβγΔ.,]{1,3}$/.test(value);
  const numeratorSimple = simple(numerator);
  const denominatorSimple = simple(denominator);
  if (numeratorSimple && denominatorSimple) return `${numerator}/${denominator}`;
  const top = numeratorSimple ? numerator : `(${numerator})`;
  const bottom = denominatorSimple ? denominator : `(${denominator})`;
  return `${top}/${bottom}`;
}

function scan(src: string): string {
  let out = '';
  let i = 0;

  while (i < src.length) {
    const char = src[i]!;

    if (char === '\\') {
      const match = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!match) {
        out += char;
        i += 1;
        continue;
      }
      const name = match[1]!;
      i += match[0].length;

      if (name === '\\' || name === 'newline') {
        out += ' ';
        continue;
      }

      if (TEXT_COMMANDS.has(name)) {
        const group = readBraced(src, i);
        if (group) {
          out += group.content;
          i = group.end;
        }
        continue;
      }

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const top = readBraced(src, i);
        const from = top ? top.end : i;
        const bottom = readBraced(src, from);
        if (top && bottom) {
          out += fraction(scan(top.content), scan(bottom.content));
          i = bottom.end;
        } else {
          out += '/';
        }
        continue;
      }

      if (name === 'sqrt') {
        const root = readBracket(src, i);
        const from = root ? root.end : i;
        const body = readBraced(src, from);
        if (body) {
          out += `${root ? scan(root.content) : ''}√(${scan(body.content)})`;
          i = body.end;
        } else {
          out += '√';
        }
        continue;
      }

      const symbol = SYMBOLS[name];
      if (symbol !== undefined) {
        out += symbol;
        continue;
      }

      // Unknown command: keep the word, drop the backslash.
      out += name;
      continue;
    }

    if (char === '^' || char === '_') {
      i += 1;
      let raw = '';
      if (src[i] === '{') {
        const group = readBraced(src, i);
        if (group) {
          raw = group.content;
          i = group.end;
        }
      } else {
        raw = src[i] ?? '';
        i += 1;
      }
      const inner = scan(raw);
      out += char === '^' ? toSuper(inner) : toSub(inner);
      continue;
    }

    // Grouping braces carry no meaning once rendered as plain text.
    if (char === '{' || char === '}') {
      i += 1;
      continue;
    }

    // Alignment/spacing tokens in display math.
    if (char === '&' || char === '~') {
      out += ' ';
      i += 1;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

/**
 * Converts a LaTeX fragment into readable plain text.
 *
 * Delimiters (`$$`, `$`, `\[`, `\]`, `\(`, `\)`) are stripped so callers can
 * pass the raw content of a math span.
 */
export function formatMath(source: string): string {
  if (!source) return '';
  const stripped = source
    .replace(/^\$+/, '')
    .replace(/\$+$/, '')
    .replace(/^\\\[/, '')
    .replace(/\\\]$/, '')
    .replace(/^\\\(/, '')
    .replace(/\\\)$/, '');

  return scan(stripped).replace(/\s+/g, ' ').trim();
}
