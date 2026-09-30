import { describe, expect, it } from 'vitest';
import { findConceptExample, findExampleSentence, splitSentences } from './learn-content.js';

const TEXT =
  'Osmosis is the movement of water across a membrane. For example, a raisin swells when it is placed in water because water moves into the raisin by osmosis. ' +
  'Diffusion spreads particles evenly. Such as perfume spreading through a room.';

describe('example finder', () => {
  it('splits sentences', () => {
    expect(splitSentences('One thing. Another thing! A third?')).toEqual([
      'One thing.',
      'Another thing!',
      'A third?',
    ]);
  });

  it('finds a sentence that gives an example of the concept', () => {
    expect(findExampleSentence('Osmosis', TEXT)).toMatch(/raisin swells/);
  });

  it('does not return an example sentence about something else', () => {
    expect(findExampleSentence('Photosynthesis', TEXT)).toBeNull();
    expect(findExampleSentence('Osmosis', 'Osmosis is a process. It is important.')).toBeNull();
  });

  it("prefers the concept's own source, then any source", () => {
    const sources = [
      {
        id: 's1',
        title: 'Other notes',
        content: 'Osmosis, for example, keeps a plant cell firm when water enters the vacuole.',
      },
      { id: 's2', title: 'Biology H3', content: TEXT },
    ];
    const own = findConceptExample({ id: 'c1', name: 'Osmosis', sourceId: 's2' }, sources, []);
    expect(own).toMatchObject({ kind: 'source', sourceId: 's2', sourceTitle: 'Biology H3' });
    expect(own!.text).toMatch(/raisin/);
    const any = findConceptExample({ id: 'c1', name: 'Osmosis', sourceId: null }, sources, []);
    expect(any!.sourceId).toBe('s1');
  });

  it('falls back to a flashcard, then to nothing', () => {
    const card = { conceptId: 'c1', question: 'What moves in osmosis?', answer: 'Water' };
    const fallback = findConceptExample({ id: 'c1', name: 'Osmosis', sourceId: null }, [], [card]);
    expect(fallback).toMatchObject({ kind: 'flashcard', text: 'What moves in osmosis? — Water' });
    expect(
      findConceptExample({ id: 'c2', name: 'Mitosis', sourceId: null }, [], [card]),
    ).toBeNull();
  });
});
