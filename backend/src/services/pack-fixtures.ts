/**
 * Test fixtures: a study pack with concepts, questions and per-concept mastery
 * written straight into a repository, so the recommendation, planner and
 * session logic can be exercised at service level without HTTP.
 */
import type { Database } from '../lib/db/repository.js';
import type {
  ConceptRecord,
  MaterialDifficulty,
  PracticeQuestionRecord,
  QuestionType,
  StudyPackRecord,
} from '../lib/db/types.js';

export interface ConceptSpec {
  name: string;
  explanation?: string;
  /** 0..1; omit for a concept the student has never touched. */
  mastery?: number;
  attempts?: number;
  nextReviewAt?: string | null;
  lastPracticedAt?: string | null;
  importance?: number | null;
  difficulty?: MaterialDifficulty | null;
  /** Questions to create for this concept (default: the pack default). */
  questions?: number;
  questionType?: QuestionType;
}

export interface PackSpec {
  title: string;
  subject?: { id: string; name: string } | null;
  examDate?: string | null;
  concepts: ConceptSpec[];
  questionsPerConcept?: number;
}

export interface SeededPack {
  pack: StudyPackRecord;
  concepts: ConceptRecord[];
  questions: PracticeQuestionRecord[];
  conceptByName: (name: string) => ConceptRecord;
}

export async function seedPack(
  db: Database,
  userId: string,
  spec: PackSpec,
): Promise<SeededPack> {
  const pack = await db.packs.create({
    ownerId: userId,
    subjectId: spec.subject?.id ?? null,
    subjectName: spec.subject?.name ?? null,
    title: spec.title,
    description: '',
    level: '',
    visibility: 'private',
    examDate: spec.examDate ?? null,
    legacySetId: null,
  });
  const concepts = await db.concepts.createMany(
    pack.id,
    spec.concepts.map((concept, index) => ({
      name: concept.name,
      explanation: concept.explanation ?? `${concept.name} explained in one sentence.`,
      sourceId: null,
      origin: 'user' as const,
      position: index + 1,
      importance: concept.importance ?? null,
      difficulty: concept.difficulty ?? null,
    })),
  );

  const questions = await db.practiceQuestions.createMany(
    pack.id,
    concepts.flatMap((concept, conceptIndex) => {
      const conceptSpec = spec.concepts[conceptIndex]!;
      const count = conceptSpec.questions ?? spec.questionsPerConcept ?? 2;
      const type = conceptSpec.questionType ?? 'multiple_choice';
      return Array.from({ length: count }, (_, index) => ({
        conceptId: concept.id,
        sourceId: null,
        prompt: `${concept.name} question ${index + 1}?`,
        questionType: type,
        correctAnswer: type === 'true_false' ? 'True' : type === 'short_answer' ? 'right' : 'Right',
        options:
          type === 'multiple_choice'
            ? ['Right', 'Wrong one', 'Wrong two', 'Wrong three']
            : type === 'true_false'
              ? ['True', 'False']
              : null,
        explanation: `Because ${concept.name} works that way.`,
        origin: 'user' as const,
        position: conceptIndex * 100 + index + 1,
      }));
    }),
  );

  for (const [index, concept] of concepts.entries()) {
    const conceptSpec = spec.concepts[index]!;
    if (conceptSpec.mastery === undefined && !conceptSpec.attempts) continue;
    await db.conceptMastery.upsert({
      userId,
      conceptId: concept.id,
      mastery: conceptSpec.mastery ?? 0,
      confidence: 0.5,
      attempts: conceptSpec.attempts ?? 1,
      correctCount: 0,
      incorrectCount: 0,
      lastPracticedAt: conceptSpec.lastPracticedAt ?? null,
      nextReviewAt: conceptSpec.nextReviewAt ?? null,
    });
  }

  return {
    pack,
    concepts,
    questions,
    conceptByName: (name) => {
      const found = concepts.find((concept) => concept.name === name);
      if (!found) throw new Error(`fixture concept ${name} not found`);
      return found;
    },
  };
}
