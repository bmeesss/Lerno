/**
 * Estimated study time — a transparent, rule-based calculation.
 *
 * No AI, no guessing, no vanity numbers: the estimate is the sum of the time the
 * separate study activities really take, from published averages a student can
 * check and argue with. The breakdown is returned as well, so the UI can explain
 * exactly where the number comes from.
 *
 *   concepts          → first-pass understanding, read + process each concept
 *   flashcards        → one review pass at ~24 cards/min
 *   practice questions→ answering + reading the feedback
 *   source length     → reading the material once (bounded)
 *
 * Difficulty only scales the practice part: harder questions take longer to
 * answer, harder theory does not make reading slower.
 */

export type StudyDifficulty = 'easy' | 'medium' | 'hard';

/** Minutes per activity, and the reading speed of study material. */
export const STUDY_TIME_RULES = {
  minutesPerConcept: 1.5,
  minutesPerFlashcard: 0.4,
  minutesPerQuestion: 1.2,
  charactersPerMinute: 900,
  maxReadingMinutes: 30,
  practiceMultiplier: { easy: 0.85, medium: 1, hard: 1.25 } satisfies Record<
    StudyDifficulty,
    number
  >,
  minimumMinutes: 5,
} as const;

export interface StudyTimeInput {
  concepts: number;
  flashcards: number;
  practiceQuestions: number;
  sourceCharacters: number;
  difficulty?: StudyDifficulty | null;
}

export interface StudyTimeEstimate {
  /** Rounded, presented number of minutes. */
  minutes: number;
  /** "~45 min" — ready to show; never invented client-side. */
  label: string;
  breakdown: {
    conceptsMinutes: number;
    flashcardsMinutes: number;
    questionsMinutes: number
    readingMinutes: number;
  };
  /** The exact formula, for the "how is this calculated" tooltip. */
  explanation: string;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "~45 min" / "~1 u 20 min" / "~2 u". */
export function formatStudyTime(minutes: number): string {
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `~${hours} u`;
  return `~${hours} u ${rest} min`;
}

export function estimateStudyTime(input: StudyTimeInput): StudyTimeEstimate {
  const rules = STUDY_TIME_RULES;
  const difficulty = input.difficulty ?? 'medium';

  const conceptsMinutes = Math.max(0, input.concepts) * rules.minutesPerConcept;
  const flashcardsMinutes = Math.max(0, input.flashcards) * rules.minutesPerFlashcard;
  const questionsMinutes =
    Math.max(0, input.practiceQuestions) *
    rules.minutesPerQuestion *
    (rules.practiceMultiplier[difficulty] ?? 1);
  const readingMinutes = Math.min(
    rules.maxReadingMinutes,
    Math.max(0, input.sourceCharacters) / rules.charactersPerMinute,
  );

  const total = conceptsMinutes + flashcardsMinutes + questionsMinutes + readingMinutes;
  const minutes = Math.max(rules.minimumMinutes, Math.round(total / 5) * 5);

  return {
    minutes,
    label: formatStudyTime(minutes),
    breakdown: {
      conceptsMinutes: round(conceptsMinutes),
      flashcardsMinutes: round(flashcardsMinutes),
      questionsMinutes: round(questionsMinutes),
      readingMinutes: round(readingMinutes),
    },
    explanation:
      `${input.concepts} concepts × ${rules.minutesPerConcept} min + ` +
      `${input.flashcards} cards × ${rules.minutesPerFlashcard} min + ` +
      `${input.practiceQuestions} questions × ${rules.minutesPerQuestion} min (${difficulty}) + ` +
      `reading ${Math.round(input.sourceCharacters)} characters`,
  };
}
