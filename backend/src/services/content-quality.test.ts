/**
 * The quality gate in front of every generated item.
 *
 * These rules come straight from the product requirements: no empty question or
 * answer, no duplicates, no missing concept or source reference, no invalid
 * multiple-choice options, nothing too long, and no answer written inside its own
 * question. A rejected item is never replaced by invented content — it is simply
 * not shown.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTENT_LIMITS,
  describeRejections,
  isDuplicateQuestion,
  normalizeForComparison,
  reviewConcepts,
  reviewFlashcards,
  reviewPracticeQuestions,
  reviewSummary,
  similarity,
  type FlashcardCandidate,
  type PracticeQuestionCandidate,
} from './content-quality.js';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const CONCEPT_ID = '22222222-2222-4222-8222-222222222222';

function card(overrides: Partial<FlashcardCandidate> = {}): FlashcardCandidate {
  return {
    front: 'Wat is mitose?',
    back: 'De deling van de celkern.',
    refLabel: 'page 6',
    sourceId: SOURCE_ID,
    conceptId: CONCEPT_ID,
    ...overrides,
  };
}

function question(overrides: Partial<PracticeQuestionCandidate> = {}): PracticeQuestionCandidate {
  return {
    questionType: 'multiple_choice',
    prompt: 'Wat doet de celkern?',
    correctAnswer: 'Het regelt de celdeling',
    options: ['Het regelt de celdeling', 'Het maakt de celwand', 'Het maakt eiwitten vrij'],
    explanation: 'De celkern bevat het DNA.',
    refLabel: 'page 6',
    sourceId: SOURCE_ID,
    conceptId: CONCEPT_ID,
    ...overrides,
  };
}

describe('content quality: comparison helpers', () => {
  it('normalizes case, whitespace and surrounding punctuation', () => {
    expect(normalizeForComparison('  Wat   is Mítose?! ')).toBe('wat is mítose');
    expect(normalizeForComparison('"Celkern."')).toBe('celkern');
  });

  it('measures how much two questions overlap', () => {
    expect(similarity('Wat is mitose?', 'Wat is mitose?')).toBe(1);
    expect(similarity('Wat is mitose?', 'Wat is osmose?')).toBe(0.5);
    expect(similarity('Wat is mitose?', 'Leg de derde wet van Newton uit.')).toBe(0);
  });

  it('treats a reworded duplicate as a duplicate, above the 0.85 threshold', () => {
    expect(isDuplicateQuestion('Wat is mitose?', 'wat is   mitose?')).toBe(true);
    expect(
      isDuplicateQuestion(
        'Welke functie heeft de celkern in de cel?',
        'Welke functie heeft de celkern in een cel?',
      ),
    ).toBe(true);
    expect(isDuplicateQuestion('Wat is mitose?', 'Wat is osmose?')).toBe(false);
    expect(isDuplicateQuestion('', 'Wat is mitose?')).toBe(false);
  });
});

describe('content quality: concepts', () => {
  const concept = {
    name: 'Mitose',
    explanation: 'Mitose is de deling van de celkern.',
    refLabel: 'page 6',
    sourceId: SOURCE_ID,
  };

  it('accepts a complete concept', () => {
    const { accepted, rejected } = reviewConcepts([concept]);

    expect(rejected).toHaveLength(0);
    expect(accepted).toEqual([concept]);
  });

  it('rejects an empty or unusably short concept', () => {
    const { accepted, rejected } = reviewConcepts([
      { ...concept, name: 'Ab' },
      { ...concept, explanation: 'kort' },
    ]);

    expect(accepted).toHaveLength(0);
    expect(rejected.map((item) => item.reason)).toEqual(['empty_concept', 'empty_concept']);
  });

  it('rejects a concept without a source reference', () => {
    const { accepted, rejected } = reviewConcepts([{ ...concept, sourceId: null }]);

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('missing_source_reference');
    expect(rejected[0]?.detail).toContain('Mitose');
  });

  it('rejects a concept that already exists in the pack', () => {
    const { accepted, rejected } = reviewConcepts([concept], { names: ['Mitose'] });

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('duplicate_concept');
  });

  it('rejects a near-duplicate name inside the same batch', () => {
    const { accepted, rejected } = reviewConcepts([
      concept,
      { ...concept, name: 'mitose' },
    ]);

    expect(accepted).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('duplicate_concept');
  });

  it('rejects a concept that is too long to study', () => {
    const { rejected } = reviewConcepts([
      { ...concept, explanation: 'a'.repeat(CONTENT_LIMITS.conceptExplanation + 1) },
    ]);

    expect(rejected[0]?.reason).toBe('answer_too_long');
  });
});

describe('content quality: flashcards', () => {
  it('accepts a card a teacher would keep', () => {
    const { accepted, rejected } = reviewFlashcards([card()]);

    expect(rejected).toHaveLength(0);
    expect(accepted[0]).toMatchObject({ front: 'Wat is mitose?', conceptId: CONCEPT_ID });
  });

  it('rejects an empty question and an empty answer', () => {
    expect(reviewFlashcards([card({ front: ' ' })]).rejected[0]?.reason).toBe('empty_question');
    expect(reviewFlashcards([card({ back: '' })]).rejected[0]?.reason).toBe('empty_answer');
  });

  it('rejects a question that is too long', () => {
    const { rejected } = reviewFlashcards([card({ front: 'x'.repeat(CONTENT_LIMITS.cardFront + 1) })]);

    expect(rejected[0]?.reason).toBe('question_too_long');
  });

  it('rejects an answer that is too long', () => {
    const { rejected } = reviewFlashcards([card({ back: 'x'.repeat(CONTENT_LIMITS.cardBack + 1) })]);

    expect(rejected[0]?.reason).toBe('answer_too_long');
  });

  it('rejects trivia and an answer that is already in the question', () => {
    expect(reviewFlashcards([card({ front: 'Mitose' })]).rejected[0]?.reason).toBe('trivial_question');
    expect(
      reviewFlashcards([card({ front: 'Wat is de deling van de celkern?', back: 'deling van de celkern' })])
        .rejected[0]?.reason,
    ).toBe('answer_in_question');
  });

  it('rejects a duplicate of an existing card', () => {
    const { accepted, rejected } = reviewFlashcards([card()], { fronts: ['Wat is mitose?'] });

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('duplicate_flashcard');
  });

  it('rejects a card without a source reference', () => {
    const { rejected } = reviewFlashcards([card({ sourceId: null })]);

    expect(rejected[0]?.reason).toBe('missing_source_reference');
  });

  it('never invents a replacement for what it rejects', () => {
    const { accepted, rejected } = reviewFlashcards([card({ back: '' })]);

    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
  });
});

describe('content quality: practice questions', () => {
  it('accepts a valid multiple-choice question', () => {
    const { accepted, rejected } = reviewPracticeQuestions([question()]);

    expect(rejected).toHaveLength(0);
    expect(accepted[0]).toMatchObject({ correctAnswer: 'Het regelt de celdeling', conceptId: CONCEPT_ID });
  });

  it('accepts a valid true/false question in both languages', () => {
    for (const answer of ['True', 'true', 'Juist', 'onjuist']) {
      const { accepted, rejected } = reviewPracticeQuestions([
        question({ questionType: 'true_false', prompt: 'Mitose deelt de celkern.', correctAnswer: answer, options: null }),
      ]);
      expect(rejected).toHaveLength(0);
      expect(accepted).toHaveLength(1);
    }
  });

  it('rejects an open question that carries options', () => {
    const { rejected } = reviewPracticeQuestions([
      question({ questionType: 'short_answer', options: ['a', 'b'] }),
    ]);

    expect(rejected[0]?.reason).toBe('invalid_options');
  });

  it('rejects multiple-choice questions with too few or duplicate options', () => {
    expect(
      reviewPracticeQuestions([question({ options: ['Het regelt de celdeling'] })]).rejected[0]?.reason,
    ).toBe('invalid_options');
    expect(
      reviewPracticeQuestions([
        question({ options: ['Het regelt de celdeling', 'Het regelt de celdeling', 'Iets anders'] }),
      ]).rejected[0]?.reason,
    ).toBe('invalid_options');
  });

  it('rejects a multiple-choice question whose answer is not one of the options', () => {
    const { accepted, rejected } = reviewPracticeQuestions([
      question({ correctAnswer: 'Het maakt suiker' }),
    ]);

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('missing_correct_answer');
  });

  it('rejects a true/false question without a clear verdict', () => {
    const { rejected } = reviewPracticeQuestions([
      question({ questionType: 'true_false', prompt: 'Mitose deelt de celkern.', correctAnswer: 'misschien', options: null }),
    ]);

    expect(rejected[0]?.reason).toBe('missing_correct_answer');
  });

  it('rejects an empty question or answer', () => {
    expect(reviewPracticeQuestions([question({ prompt: ' ' })]).rejected[0]?.reason).toBe('empty_question');
    expect(reviewPracticeQuestions([question({ correctAnswer: '' })]).rejected[0]?.reason).toBe('empty_answer');
  });

  it('rejects a question or answer that is too long', () => {
    expect(
      reviewPracticeQuestions([question({ prompt: 'x'.repeat(CONTENT_LIMITS.question + 1) })])
        .rejected[0]?.reason,
    ).toBe('question_too_long');
    expect(
      reviewPracticeQuestions([question({ correctAnswer: 'x'.repeat(CONTENT_LIMITS.answer + 1), options: null })])
        .rejected[0]?.reason,
    ).toBe('answer_too_long');
  });

  it('rejects a question without a concept or a source', () => {
    expect(reviewPracticeQuestions([question({ conceptId: null })]).rejected[0]?.reason).toBe('missing_concept');
    expect(reviewPracticeQuestions([question({ sourceId: null })]).rejected[0]?.reason).toBe(
      'missing_source_reference',
    );
  });

  it('rejects a duplicate of an existing question', () => {
    const { rejected } = reviewPracticeQuestions([question()], { prompts: ['Wat doet de celkern?'] });

    expect(rejected[0]?.reason).toBe('duplicate_question');
  });

  it('keeps the valid questions of a mixed batch and reports the rest', () => {
    const { accepted, rejected } = reviewPracticeQuestions([
      question(),
      question({ prompt: '', }),
      question({ correctAnswer: 'Iets anders' }),
      question({
        prompt: 'Leg uit wat mitose is met een voorbeeld uit de les.',
        questionType: 'short_answer',
        correctAnswer: 'De celkern deelt zich in twee kernen.',
        options: null,
      }),
    ]);

    expect(accepted).toHaveLength(2);
    expect(rejected.map((item) => item.reason)).toEqual(['empty_question', 'missing_correct_answer']);
  });
});

describe('content quality: summaries and reporting', () => {
  it('keeps a summary that really summarises something', () => {
    const { accepted, rejected } = reviewSummary(
      'Deze paragraaf gaat over celdeling en de rol van de celkern daarbij.',
    );

    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
  });

  it('rejects a summary that is too short to be useful', () => {
    const { accepted, rejected } = reviewSummary('Kort.');

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('empty_summary');
  });

  it('bounds a very long summary instead of storing it whole', () => {
    const { accepted } = reviewSummary('a'.repeat(6_000), 4_000);

    expect(accepted[0]?.summary.length).toBe(4_000);
  });

  it('describes rejections in student language', () => {
    const message = describeRejections([
      { kind: 'flashcard', index: 0, reason: 'duplicate_flashcard', detail: '' },
      { kind: 'question', index: 1, reason: 'duplicate_question', detail: '' },
      { kind: 'question', index: 2, reason: 'invalid_options', detail: '' },
    ]);

    expect(message).toBe('1× duplicate flashcard, 1× duplicate question, 1× unusable answer options');
    expect(describeRejections([])).toBeNull();
  });
});
