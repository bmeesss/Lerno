/**
 * Material analysis — the deterministic part of source ingestion.
 *
 * Everything here is pure (no database, no AI, no I/O) so the import flow can
 * tell a student what Lerno found in their material without inventing anything:
 * real word counts, a real content fingerprint for duplicate detection, and
 * concept candidates that are actually derived from the text.
 *
 * The AI layer later turns this material into summaries, concepts, flashcards
 * and practice questions; this module never pretends to be AI.
 */
import { createHash } from 'node:crypto';

/** Same bound the source validators enforce (50k characters per source). */
export const MAX_MATERIAL_CHARS = 50_000;
/** Material below this many readable characters is not usable as a source. */
export const MIN_MATERIAL_CHARS = 20;
/** Upper bound for concept candidates shown in the import preview. */
export const MAX_CONCEPT_CANDIDATES = 30;

/**
 * Control characters can arrive from PDF extraction and word processors. They
 * are stripped before anything is stored, counted or sent to the AI.
 * (Matching them is the whole point here.)
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Normalizes imported material: control characters removed, whitespace
 * collapsed, at most one blank line between paragraphs, bounded to
 * `MAX_MATERIAL_CHARS`. Safe to store and safe to render (the frontend escapes).
 */
export function sanitizeMaterialText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_MATERIAL_CHARS);
}

/** Characters that actually carry content (letters, digits, symbols). */
export function materialCharacterCount(text: string): number {
  return text.replace(/\s/g, '').length;
}

/** True when the material is long enough to build a study pack from. */
export function hasUsableMaterial(text: string): boolean {
  return materialCharacterCount(text) >= MIN_MATERIAL_CHARS;
}

/** Word count used in the import preview ("~3,200 words"). */
export function materialWordCount(text: string): number {
  const words = text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  return words.length;
}

/**
 * Stable content fingerprint used to spot an accidental re-import of the same
 * material. Case and whitespace differences (a PDF exported twice, a copied
 * note) must not defeat it, so the text is normalized before hashing.
 */
export function materialFingerprint(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

export interface MaterialConceptCandidate {
  name: string;
  /** The sentence the candidate was found in — never a generated definition. */
  explanation: string;
}

const NAMED_DEFINITION =
  /^(?:(?:de|het|een|the|a|an)\s+)?(?<term>[^,.;:!?()\n]{3,60}?)\s+(?:is|zijn|wordt|worden|betekent|betekenen|houdt in|houden in|bestaat uit|bestaan uit|gaat over|gaan over|noem je|noemen we|heet|heten|are|means|refer to|refers to|describe|describes|consist of|consists of)\s+(?<explanation>[^.\n]{10,400})/iu;

/** Term lists: "Mitose: deling van de celkern", "Osmose - water verplaatst". */
const TERM_LIST =
  /^(?<term>[\p{Lu}\p{N}][^:=–—\n]{1,60}?)\s*[:=–—]\s*(?<explanation>[^:=–—\n]{12,400})$/u;

const STOP_WORDS = new Set([
  'de',
  'het',
  'een',
  'dit',
  'dat',
  'deze',
  'die',
  'er',
  'en',
  'of',
  'maar',
  'als',
  'dan',
  'ook',
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'and',
  'or',
  'but',
  'if',
  'then',
  'also',
  'there',
  'it',
  'they',
  'we',
  'you',
]);

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function tidyCandidateName(raw: string): string {
  return raw
    .replace(/^[\s"'“”‘’\-–—*•]+/, '')
    .replace(/[\s"'“”‘’\-–—:]+$/, '')
    .trim();
}

function isUsableCandidate(name: string): boolean {
  const words = name.split(/\s+/).filter(Boolean);
  if (name.length < 3 || name.length > 80) return false;
  if (words.length > 8) return false;
  if (!/[\p{L}]/u.test(name)) return false;
  // "De eerste wet" style names are fine; a bare stop word is not.
  return !(words.length === 1 && STOP_WORDS.has(name.toLowerCase()));
}

/**
 * Finds concept candidates in the material: sentences that define something
 * ("Fotosynthese is het proces waarbij…"), term lists ("Mitose: deling van de
 * celkern") and — as a fallback for material without definitions — terms that
 * repeat often enough to be what the chapter is about.
 *
 * Deterministic and local: no model is asked, and the explanation is always the
 * original sentence so nothing can be hallucinated.
 */
export function detectMaterialConcepts(text: string, limit = 24): MaterialConceptCandidate[] {
  const found = new Map<string, MaterialConceptCandidate>();
  const sentences = splitSentences(text);

  function remember(name: string, explanation: string): void {
    const cleanName = tidyCandidateName(name);
    if (!isUsableCandidate(cleanName)) return;
    const key = cleanName.toLowerCase();
    if (found.has(key)) return;
    found.set(key, { name: cleanName, explanation: explanation.trim().slice(0, 300) });
  }

  for (const sentence of sentences) {
    const list = TERM_LIST.exec(sentence);
    if (list?.groups) {
      const term = list.groups.term ?? '';
      // A term list entry must look like a term, not like a full sentence.
      if (term.split(/\s+/).length <= 6) remember(term, sentence);
      continue;
    }
    const definition = NAMED_DEFINITION.exec(sentence);
    if (definition?.groups) {
      remember(definition.groups.term ?? '', `${sentence}.`);
    }
  }

  if (found.size < Math.min(limit, 6)) {
    for (const [name, sentence] of frequentTerms(text, limit)) {
      remember(name, sentence);
    }
  }

  return [...found.values()].slice(0, Math.min(limit, MAX_CONCEPT_CANDIDATES));
}

/**
 * Repeating capitalized terms ("Eerste Wet van Newton", "Koolstofdioxide") with
 * the first sentence they appear in. A pragmatic fallback for material without
 * explicit definitions — still fully derived from the text.
 */
function frequentTerms(text: string, limit: number): [string, string][] {
  const sentences = splitSentences(text);
  const counts = new Map<string, { phrase: string; count: number; sentence: string }>();

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).slice(0, 400);
    for (let size = 4; size >= 1; size -= 1) {
      for (let index = 0; index + size <= words.length; index += 1) {
        const raw = words.slice(index, index + size);
        const capitalized = raw.filter((word) => /^\p{Lu}/u.test(tidyCandidateName(word))).length;
        if (capitalized === 0 || capitalized < Math.ceil(size / 2)) continue;
        const phrase = trimEdgeWords(raw.map((word) => tidyCandidateName(word)));
        if (!isUsableCandidate(phrase)) continue;
        const key = phrase.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { phrase, count: 1, sentence });
      }
    }
  }

  // Longest repeating phrases first, and never a phrase inside a longer one.
  const ranked = [...counts.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => wordCount(b.phrase) - wordCount(a.phrase) || b.count - a.count);

  const selected: typeof ranked = [];
  for (const entry of ranked) {
    const lower = entry.phrase.toLowerCase();
    if (selected.some((chosen) => chosen.phrase.toLowerCase().includes(lower))) continue;
    selected.push(entry);
    if (selected.length >= limit) break;
  }
  return selected.map((entry) => [entry.phrase, entry.sentence]);
}

function wordCount(phrase: string): number {
  return phrase.split(/\s+/).filter(Boolean).length;
}

/** Drops leading articles and trailing prepositions from a candidate phrase. */
function trimEdgeWords(words: string[]): string {
  const edges = new Set([
    ...STOP_WORDS,
    'van',
    'in',
    'op',
    'met',
    'voor',
    'bij',
    'tot',
    'uit',
    'over',
    'of',
    'to',
    'of',
    'from',
    'with',
    'by',
    'for',
    'at',
    'on',
  ]);
  let start = 0;
  let end = words.length;
  while (start < end - 1 && edges.has(words[start]!.toLowerCase())) start += 1;
  while (end - 1 > start && edges.has(words[end - 1]!.toLowerCase())) end -= 1;
  return words.slice(start, end).join(' ');
}
