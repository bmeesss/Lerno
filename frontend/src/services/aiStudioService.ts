import { apiRequest, apiUpload } from '../lib/api';

export type StudioSourceType = 'text' | 'pdf' | 'set';

export type StudioSource =
  | {
      id: string;
      type: 'text' | 'pdf';
      title: string;
      preview: string;
      characterCount: number;
      text: string;
      pageCount?: number;
      truncated?: boolean;
    }
  | {
      id: string;
      type: 'set';
      title: string;
      preview: string;
      characterCount: number;
      cardCount: number;
      setId: string;
    };

export type StudioActionSource =
  | { type: 'text' | 'pdf'; title: string; text: string; pageCount?: number; extractedChars: number; truncated: boolean }
  | { type: 'set'; setId: string };

export interface StudioPdfExtraction {
  title: string;
  text: string;
  pageCount: number;
  characterCount: number;
  truncated: boolean;
}

export interface StudioSummary {
  title: string;
  summary: string;
  keyPoints: string[];
  terms: { term: string; definition: string }[];
  sourceTitle: string;
}

export interface StudioFlashcard {
  front: string;
  back: string;
}

export interface StudioCardsResult {
  title: string;
  description: string;
  cards: StudioFlashcard[];
}

export interface StudioQuizQuestion {
  type: 'multiple_choice' | 'true_false' | 'open';
  question: string;
  options: string[];
  correctIndex: number | null;
  answer: string;
  explanation: string;
}

export interface StudioStudyPlan {
  title: string;
  overview: string;
  sessions: { day: number; focus: string; activities: string[]; minutes: number }[];
}

export interface StudioPracticeQuestion {
  type: 'open' | 'multiple_choice';
  question: string;
  answer: string;
  hint: string;
  options: string[];
  correctIndex: number | null;
}

export interface StudioChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const base = '/ai/studio';

export function toStudioActionSource(source: StudioSource): StudioActionSource {
  if (source.type === 'set') return { type: 'set', setId: source.setId };
  return {
    type: source.type,
    title: source.title,
    text: source.text,
    ...(source.pageCount === undefined ? {} : { pageCount: source.pageCount }),
    extractedChars: source.characterCount,
    truncated: source.truncated ?? false,
  };
}

export const aiStudioService = {
  extractPdf: (file: File, title: string) => {
    const body = new FormData();
    body.append('file', file);
    body.append('title', title);
    return apiUpload<StudioPdfExtraction>(`${base}/sources/pdf`, body);
  },

  summary: (source: StudioActionSource) =>
    apiRequest<StudioSummary>(`${base}/summary`, { method: 'POST', body: { source } }),

  cards: (source: StudioActionSource, count: number) =>
    apiRequest<StudioCardsResult>(`${base}/cards`, {
      method: 'POST',
      body: { source, count },
    }),

  quiz: (source: StudioActionSource, count: number, types: StudioQuizQuestion['type'][]) =>
    apiRequest<{ questions: StudioQuizQuestion[] }>(`${base}/quiz`, {
      method: 'POST',
      body: { source, count, types },
    }),

  questions: (source: StudioActionSource, count: number, difficulty: 'easy' | 'normal' | 'hard') =>
    apiRequest<{ questions: StudioPracticeQuestion[] }>(`${base}/questions`, {
      method: 'POST',
      body: { source, count, difficulty },
    }),

  plan: (source: StudioActionSource, days: number, minutesPerDay: number) =>
    apiRequest<StudioStudyPlan>(`${base}/plan`, {
      method: 'POST',
      body: { source, days, minutesPerDay },
    }),

  chat: (source: StudioActionSource, message: string, history: StudioChatMessage[]) =>
    apiRequest<{ reply: string }>(`${base}/chat`, {
      method: 'POST',
      body: { source, message, history: history.slice(-8) },
    }),
};
