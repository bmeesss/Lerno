/**
 * Learn content — the "Example" step of a concept, found without AI.
 *
 * Order of preference:
 *  1. a sentence from the student's own material that gives an example of the
 *     concept ("for example", "such as", "bijvoorbeeld", …);
 *  2. a flashcard the student already has for the concept;
 *  3. nothing. The UI then says so and offers "Ask AI Tutor" instead of
 *     inventing an example that is not in the material.
 */
import type { CardRecord, ConceptRecord, StudyPackSourceRecord } from '../lib/db/types.js';

export interface ConceptExample {
  text: string;
  kind: 'source' | 'flashcard';
  sourceId: string | null;
  sourceTitle: string | null;
}

const EXAMPLE_MARKERS =
  /\b(for example|for instance|e\.g\.|such as|imagine|consider|think of|a good example|bijvoorbeeld|zoals|stel dat|neem bijvoorbeeld|voorbeeld|par exemple|zum beispiel)\b/i;

const MIN_SENTENCE = 30;
const MAX_SENTENCE = 320;

/** Splits text into sentences without pulling in a tokenizer. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

/** The best example sentence for a concept inside one text, or null. */
export function findExampleSentence(conceptName: string, text: string): string | null {
  const name = conceptName.trim().toLowerCase();
  const keywords = new Set(words(conceptName));
  if (!name && keywords.size === 0) return null;
  let best: { sentence: string; score: number } | null = null;
  for (const sentence of splitSentences(text)) {
    if (sentence.length < MIN_SENTENCE || sentence.length > MAX_SENTENCE) continue;
    if (!EXAMPLE_MARKERS.test(sentence)) continue;
    const lower = sentence.toLowerCase();
    let score = name && lower.includes(name) ? 3 : 0;
    for (const word of words(sentence)) if (keywords.has(word)) score += 1;
    if (score === 0) continue;
    if (!best || score > best.score) best = { sentence, score };
  }
  return best?.sentence ?? null;
}

export function findConceptExample(
  concept: Pick<ConceptRecord, 'id' | 'name' | 'sourceId'>,
  sources: Pick<StudyPackSourceRecord, 'id' | 'title' | 'content'>[],
  cards: Pick<CardRecord, 'conceptId' | 'question' | 'answer'>[],
): ConceptExample | null {
  // The concept's own source first, then the other ones.
  const ordered = [
    ...sources.filter((source) => source.id === concept.sourceId),
    ...sources.filter((source) => source.id !== concept.sourceId),
  ];
  for (const source of ordered) {
    if (!source.content) continue;
    const sentence = findExampleSentence(concept.name, source.content);
    if (sentence) {
      return { text: sentence, kind: 'source', sourceId: source.id, sourceTitle: source.title };
    }
  }
  const card = cards.find((entry) => entry.conceptId === concept.id);
  if (card) {
    return {
      text: `${card.question.trim()} — ${card.answer.trim()}`,
      kind: 'flashcard',
      sourceId: null,
      sourceTitle: null,
    };
  }
  return null;
}

/* ------------------------------ "Show source" ------------------------------ */

export interface SourceExcerpt {
  text: string;
  /** "page 6", "slide 8" — the place the concept comes from, when known. */
  ref: string | null;
  match: 'reference' | 'mention' | 'start';
}

const EXCERPT_CHARS = 900;
const MENTION_WINDOW = 320;

/**
 * The passage of a source that a concept comes from — found by its stored
 * reference ("page 6"), else by where the concept is mentioned, else the start
 * of the source. Plain text arithmetic, no AI.
 */
export function sourceExcerptFor(
  concept: Pick<ConceptRecord, 'name' | 'refLabel'>,
  source: { text: string; references: { label: string; start: number }[] },
): SourceExcerpt {
  const text = source.text;
  const label = concept.refLabel?.trim().toLowerCase();
  if (label) {
    const ordered = [...source.references].sort((a, b) => a.start - b.start);
    const index = ordered.findIndex((reference) => reference.label.trim().toLowerCase() === label);
    if (index >= 0) {
      const start = ordered[index]!.start;
      const next = ordered[index + 1]?.start ?? text.length;
      return {
        text: text.slice(start, Math.min(next, start + EXCERPT_CHARS)).trim(),
        ref: ordered[index]!.label,
        match: 'reference',
      };
    }
  }
  const at = text.toLowerCase().indexOf(concept.name.trim().toLowerCase());
  if (at >= 0) {
    const from = Math.max(0, at - MENTION_WINDOW);
    const to = Math.min(text.length, at + concept.name.length + MENTION_WINDOW);
    return {
      text: `${from > 0 ? '… ' : ''}${text.slice(from, to).trim()}${to < text.length ? ' …' : ''}`,
      ref: concept.refLabel ?? null,
      match: 'mention',
    };
  }
  return { text: text.slice(0, EXCERPT_CHARS).trim(), ref: concept.refLabel ?? null, match: 'start' };
}
