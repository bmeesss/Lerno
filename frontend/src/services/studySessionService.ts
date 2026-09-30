import { api } from '../lib/api';
import type {
  ConceptSourceView,
  SelfRating,
  SessionCreated,
  SessionItemResponse,
  SessionMistakes,
  SessionPreview,
  SessionSaveResponse,
  SessionType,
  LearningSession,
  TestMode,
  ResumeCard,
} from '../types';

export interface SessionRequest {
  packId: string;
  type: SessionType;
  mode?: TestMode;
  conceptId?: string | null;
  count?: number;
}

/**
 * Study sessions live on the server: every call here reads or changes that
 * state, so a reload or another device always sees the same session.
 */
export const studySessionService = {
  /** What the pre-start screen shows. Nothing is stored. */
  preview: (request: SessionRequest) =>
    api.get<SessionPreview>('/study-sessions/preview', {
      packId: request.packId,
      type: request.type,
      mode: request.mode,
      conceptId: request.conceptId ?? undefined,
      count: request.count,
    }),

  /** Creates a session or resumes the open one of the same kind. */
  start: (request: SessionRequest & { restart?: boolean }) =>
    api.post<SessionCreated>('/study-sessions', {
      ...request,
      conceptId: request.conceptId ?? null,
    }),

  get: (sessionId: string) =>
    api
      .get<{ session: LearningSession }>(`/study-sessions/${sessionId}`)
      .then((data) => data.session),

  /** Open sessions ("Continue where you left off"). */
  active: () =>
    api.get<{ sessions: ResumeCard[] }>('/study-sessions/active').then((data) => data.sessions),

  answer: (sessionId: string, itemId: string, answer: string, responseTimeMs?: number) =>
    api.post<SessionItemResponse>(`/study-sessions/${sessionId}/items/${itemId}/answer`, {
      answer,
      responseTimeMs,
    }),

  rate: (sessionId: string, itemId: string, rating: SelfRating, responseTimeMs?: number) =>
    api.post<SessionItemResponse>(`/study-sessions/${sessionId}/items/${itemId}/rating`, {
      rating,
      responseTimeMs,
    }),

  skip: (sessionId: string, itemId: string) =>
    api.post<SessionItemResponse>(`/study-sessions/${sessionId}/items/${itemId}/skip`),

  /** Tests: many answers in one request, nothing graded. */
  saveAnswers: (
    sessionId: string,
    answers: { itemId: string; answer: string }[],
    currentPosition?: number,
  ) =>
    api.put<SessionSaveResponse>(`/study-sessions/${sessionId}/answers`, {
      answers,
      currentPosition,
    }),

  complete: (sessionId: string, answers?: { itemId: string; answer: string }[]) =>
    api
      .post<{ session: LearningSession }>(
        `/study-sessions/${sessionId}/complete`,
        answers ? { answers } : {},
      )
      .then((data) => data.session),

  abandon: (sessionId: string) =>
    api
      .post<{ session: LearningSession }>(`/study-sessions/${sessionId}/abandon`)
      .then((data) => data.session),

  mistakes: (sessionId: string) =>
    api.get<SessionMistakes>(`/study-sessions/${sessionId}/mistakes`),

  /** "Show source": the passage a concept comes from. */
  conceptSource: (packId: string, conceptId: string) =>
    api.get<ConceptSourceView>(`/study-packs/${packId}/concepts/${conceptId}/source`),
};
