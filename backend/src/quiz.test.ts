import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { generateQuestions, normalizeAnswer } from './services/quiz-service.js';
import type { CardRecord } from './lib/db/types.js';

const app = createApp();

function card(id: string, question: string, answer: string, position: number): CardRecord {
  return {
    id,
    setId: 'set-1',
    question,
    answer,
    position,
    createdAt: '',
    updatedAt: '',
  };
}

describe('quiz generation (pure)', () => {
  const cards = [
    card('c1', 'What is 2+2?', '4', 0),
    card('c2', 'Capital of France?', 'Paris', 1),
    card('c3', 'Chemical symbol for gold?', 'Au', 2),
    card('c4', 'Who wrote Hamlet?', 'Shakespeare', 3),
    card('c5', 'How many continents?', '7', 4),
    card('c6', 'Speed of light km/s?', '300000', 5),
  ];

  it('mixes multiple choice, true/false and short answer', () => {
    const questions = generateQuestions(cards);
    expect(questions).toHaveLength(6);
    const types = questions.map((question) => question.questionType);
    expect(types).toContain('multiple_choice');
    expect(types).toContain('true_false');
    expect(types).toContain('short_answer');
    expect(questions[0]!.options).toHaveLength(4);
    expect(questions[1]!.options).toEqual(['True', 'False']);
    expect(questions[2]!.options).toBeNull();
  });

  it('is deterministic', () => {
    expect(generateQuestions(cards)).toEqual(generateQuestions(cards));
  });

  it('uses short answers when there are no distractor sources', () => {
    const questions = generateQuestions([card('only', 'Q?', 'A', 0)]);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.questionType).toBe('short_answer');
    expect(questions[0]!.correctAnswer).toBe('A');
  });

  it('never places more than one copy of the correct answer in options', () => {
    const questions = generateQuestions(cards).filter((q) => q.questionType === 'multiple_choice');
    for (const question of questions) {
      const options = question.options!;
      expect(options.filter((option) => option === question.correctAnswer)).toHaveLength(1);
      expect(new Set(options).size).toBe(options.length);
    }
  });
});

describe('answer normalization', () => {
  it('ignores case, whitespace and trailing punctuation', () => {
    expect(normalizeAnswer('  Paris! ')).toBe('paris');
    expect(normalizeAnswer('De   Oxyribo')).toBe('de oxyribo');
  });
});

describe('quiz API', () => {
  async function setupQuiz(): Promise<{
    token: string;
    setId: string;
    quiz: {
      id: string;
      questions: { id: string; prompt: string; questionType: string; options: string[] | null }[];
    };
  }> {
    const email = `quiz${Math.floor(Math.random() * 1e6)}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'password123', displayName: 'Quiz Student' });
    const token = signup.body.data.accessToken as string;

    const set = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Geography',
        visibility: 'public',
        cards: [
          { question: 'Capital of France?', answer: 'Paris' },
          { question: 'Capital of Germany?', answer: 'Berlin' },
          { question: 'Capital of Spain?', answer: 'Madrid' },
        ],
      });
    const setId = set.body.data.id as string;

    const quiz = await request(app)
      .get(`/api/sets/${setId}/quiz`)
      .set('Authorization', `Bearer ${token}`);
    expect(quiz.status).toBe(200);
    return { token, setId, quiz: quiz.body.data };
  }

  it('returns questions without correct answers', async () => {
    const { quiz } = await setupQuiz();
    expect(quiz.questions.length).toBeGreaterThanOrEqual(3);
    for (const question of quiz.questions) {
      expect(question).not.toHaveProperty('correctAnswer');
    }
  });

  it('scores submissions and persists attempts for users', async () => {
    const { token, setId, quiz } = await setupQuiz();

    // Answer: one definitely correct (by looking at the prompt/known answers),
    // one empty → incorrect, one bogus → incorrect.
    const answers = quiz.questions.map((question, index) => ({
      questionId: question.id,
      answer: index === 0 ? 'Paris' : index === 1 ? '' : 'wrong answer',
    }));

    const res = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers });
    expect(res.status).toBe(200);
    const result = res.body.data;
    expect(result.total).toBe(quiz.questions.length);
    expect(result.correct + result.incorrect).toBe(result.total);
    expect(result.accuracy).toBeCloseTo(result.correct / result.total);
    expect(result.persisted).toBe(true);
    expect(result.topicsNeedingPractice.length).toBe(result.incorrect);
    // Per-question feedback includes the correct answers
    for (const question of result.questions) {
      expect(question.correctAnswer).toBeTruthy();
    }

    const progress = await request(app)
      .get('/api/progress')
      .set('Authorization', `Bearer ${token}`);
    expect(progress.body.data.quizAttempts).toBe(1);
  });

  it('scores a perfect submission', async () => {
    const { token, setId, quiz } = await setupQuiz();
    const answerByKey: Record<string, string> = {
      'Capital of France?': 'Paris',
      'Capital of Germany?': 'Berlin',
      'Capital of Spain?': 'Madrid',
    };
    const answers = quiz.questions.map((question) => {
      // For generated TF/MC questions the prompt embeds the source question.
      const match = Object.keys(answerByKey).find((key) => question.prompt.startsWith(key));
      if (question.questionType === 'true_false') {
        const source = match ? answerByKey[match] : '';
        const shown = /"([^"]+)"/.exec(question.prompt)?.[1] ?? '';
        return {
          questionId: question.id,
          answer: shown === source ? 'True' : 'False',
        };
      }
      return {
        questionId: question.id,
        answer: match ? answerByKey[match]! : 'unknown',
      };
    });

    const res = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers });
    expect(res.body.data.score).toBe(res.body.data.total);
    expect(res.body.data.topicsNeedingPractice).toEqual([]);
  });

  it('lets guests take public quizzes without persisting', async () => {
    const { setId, quiz } = await setupQuiz();
    const res = await request(app)
      .post(`/api/sets/${setId}/quiz/attempts`)
      .send({
        answers: quiz.questions.map((question) => ({ questionId: question.id, answer: 'x' })),
      });
    expect(res.status).toBe(200);
    expect(res.body.data.persisted).toBe(false);
    expect(res.body.data.incorrect).toBeGreaterThan(0);
  });

  it('hides quizzes of private sets from guests', async () => {
    const email = `priv${Math.floor(Math.random() * 1e6)}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'password123', displayName: 'Priv' });
    const token = signup.body.data.accessToken as string;
    const set = await request(app)
      .post('/api/sets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Secret',
        visibility: 'private',
        cards: [{ question: 'Q?', answer: 'A' }],
      });

    const res = await request(app).get(`/api/sets/${set.body.data.id}/quiz`);
    expect(res.status).toBe(404);
  });

  it('rejects invalid submissions', async () => {
    const { setId } = await setupQuiz();
    const res = await request(app).post(`/api/sets/${setId}/quiz/attempts`).send({ answers: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
