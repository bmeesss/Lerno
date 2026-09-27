/**
 * Quiz service — generation, loading and scoring (spec §6 Quiz mode).
 *
 * Quizzes are generated deterministically from a study set's cards (multiple
 * choice, true/false, short answer) and stored on first load so attempts can
 * reference a stable quiz. Scoring is plain answer comparison — guests can
 * take quizzes; their results are scored but not persisted (spec §8).
 */
import type { Database } from '../lib/db/repository.js';
import type { CardRecord, NewQuizQuestion, QuizQuestionRecord } from '../lib/db/types.js';
import { dto } from '../lib/dto.js';
import { errors } from '../lib/errors.js';
import { canViewSet } from './set-service.js';

export interface QuizAnswerInput {
  questionId: string;
  answer: string;
}

export interface QuestionResult {
  questionId: string;
  prompt: string;
  questionType: QuizQuestionRecord['questionType'];
  yourAnswer: string;
  correctAnswer: string;
  correct: boolean;
  options: string[] | null;
}

export interface QuizResult {
  quizId: string;
  score: number;
  total: number;
  accuracy: number;
  correct: number;
  incorrect: number;
  questions: QuestionResult[];
  topicsNeedingPractice: string[];
  persisted: boolean;
}

/** Deterministic quiz generation from cards (pure). */
export function generateQuestions(cards: CardRecord[]): NewQuizQuestion[] {
  if (cards.length === 0) return [];

  return cards.map((card, index) => {
    const mode = index % 3;

    if (mode === 0 && cards.length >= 2) {
      // Multiple choice: correct answer + up to 3 distractors from other cards.
      const distractors: string[] = [];
      for (let offset = 1; distractors.length < 3 && offset < cards.length; offset += 1) {
        const other = cards[(index + offset) % cards.length]!;
        if (other.answer !== card.answer && !distractors.includes(other.answer)) {
          distractors.push(other.answer);
        }
      }
      const options = [card.answer, ...distractors];
      // Rotate so the correct answer is not always first (deterministic).
      const rotation = index % options.length;
      const rotated = [...options.slice(rotation), ...options.slice(0, rotation)];
      return {
        prompt: card.question,
        questionType: 'multiple_choice' as const,
        correctAnswer: card.answer,
        options: rotated,
        position: index,
      };
    }

    if (mode === 1 && cards.length >= 2) {
      // True/false: half true statements, half with a swapped answer.
      const isTrue = index % 2 === 0;
      const other = cards[(index + 1) % cards.length]!;
      const shownAnswer = isTrue ? card.answer : other.answer;
      return {
        prompt: `${card.question} — "${shownAnswer}"`,
        questionType: 'true_false' as const,
        correctAnswer: isTrue ? 'True' : 'False',
        options: ['True', 'False'],
        position: index,
      };
    }

    // Short answer (also the fallback for single-card sets).
    return {
      prompt: card.question,
      questionType: 'short_answer' as const,
      correctAnswer: card.answer,
      options: null,
      position: index,
    };
  });
}

/** Normalized comparison for short answers: case/whitespace/punctuation insensitive. */
export function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

function isCorrectAnswer(question: QuizQuestionRecord, answer: string): boolean {
  return normalizeAnswer(question.correctAnswer) === normalizeAnswer(answer);
}

export const quizService = {
  /** Loads the set's quiz, generating and storing it on first access. */
  async loadForSet(db: Database, userId: string | null, setId: string) {
    const set = await db.sets.get(setId);
    if (!set || !canViewSet(set, userId)) throw errors.notFound('Study set not found');

    let quiz = await db.quizzes.getBySet(setId);
    let questions = quiz ? await db.quizzes.listQuestions(quiz.id) : [];

    if (!quiz || questions.length === 0) {
      const cards = await db.cards.listBySet(setId);
      const generated = generateQuestions(cards);
      if (generated.length === 0) {
        throw errors.validation('This set needs at least one card before a quiz can be made');
      }
      const created = await db.quizzes.createWithQuestions(setId, `${set.title} — quiz`, generated);
      quiz = created.quiz;
      questions = created.questions;
    }

    return {
      id: quiz.id,
      setId,
      title: quiz.title,
      questions: questions.map((question) => dto.quizQuestion(question, false)),
    };
  },

  /** Scores a submission; persists an attempt for signed-in users only. */
  async submit(
    db: Database,
    userId: string | null,
    setId: string,
    answers: QuizAnswerInput[],
  ): Promise<QuizResult> {
    const set = await db.sets.get(setId);
    if (!set || !canViewSet(set, userId)) throw errors.notFound('Study set not found');

    const quiz = await db.quizzes.getBySet(setId);
    if (!quiz) throw errors.notFound('Quiz not found');
    const questions = await db.quizzes.listQuestions(quiz.id);
    if (questions.length === 0) throw errors.notFound('Quiz not found');

    const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer.answer]));
    const results: QuestionResult[] = questions.map((question) => {
      const yourAnswer = answerByQuestion.get(question.id) ?? '';
      return {
        questionId: question.id,
        prompt: question.prompt,
        questionType: question.questionType,
        yourAnswer,
        correctAnswer: question.correctAnswer,
        correct: isCorrectAnswer(question, yourAnswer),
        options: question.options,
      };
    });

    const correct = results.filter((result) => result.correct).length;
    const total = results.length;
    const incorrect = total - correct;

    let persisted = false;
    if (userId) {
      await db.attempts.create({
        userId,
        quizId: quiz.id,
        setId,
        score: correct,
        total,
      });
      persisted = true;
    }

    return {
      quizId: quiz.id,
      score: correct,
      total,
      accuracy: total > 0 ? correct / total : 0,
      correct,
      incorrect,
      questions: results,
      topicsNeedingPractice: results
        .filter((result) => !result.correct)
        .map((result) => result.prompt),
      persisted,
    };
  },
};
