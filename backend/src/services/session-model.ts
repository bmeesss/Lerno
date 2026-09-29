/**
 * Pure helpers for the study-session abstraction: lifecycle rules, active-time
 * accounting, progress and the resume card. No database access, so the session
 * service, the daily plan and the progress overview can share them without
 * importing each other.
 */
import type {
  LearningSessionItemRecord,
  LearningSessionRecord,
  LearningSessionStatus,
  LearningSessionType,
  TestMode,
} from '../lib/db/types.js';
import { STUDY_TIME_RULES } from './study-time.js';

/** A session left open longer than this is no longer offered for resuming. */
export const RESUME_WINDOW_DAYS = 7;
/**
 * Idle time is not study time: each gap between two interactions counts for at
 * most this long, so a tab left open overnight does not become "9 hours".
 */
export const IDLE_GAP_CAP_SECONDS = 300;

export const SESSION_TYPE_LABEL: Record<LearningSessionType, string> = {
  learn: 'Learn',
  practice: 'Practice',
  review: 'Review',
  test: 'Test',
};

/** The lifecycle: not_started → active → completed | abandoned. */
const TRANSITIONS: Record<LearningSessionStatus, LearningSessionStatus[]> = {
  not_started: ['active', 'abandoned'],
  active: ['completed', 'abandoned'],
  completed: [],
  abandoned: [],
};

export function canTransition(from: LearningSessionStatus, to: LearningSessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isOpenStatus(status: LearningSessionStatus): boolean {
  return status === 'not_started' || status === 'active';
}

/** "Biology Practice", "Biology Exam simulation" — the label students recognise. */
export function sessionLabel(
  session: Pick<LearningSessionRecord, 'type' | 'mode'>,
  packTitle: string,
): string {
  const kind =
    session.type === 'test' && session.mode === 'exam'
      ? 'Exam simulation'
      : SESSION_TYPE_LABEL[session.type];
  return `${packTitle} ${kind}`;
}

/** Title stored on the session when it is created ("Practice Biology"). */
export function sessionTitle(
  type: LearningSessionType,
  mode: TestMode | null,
  subject: string,
): string {
  if (type === 'test') {
    return mode === 'exam' ? `Exam simulation · ${subject}` : `Practice test · ${subject}`;
  }
  return `${SESSION_TYPE_LABEL[type]} ${subject}`;
}

/** 1-based position of the item the student is on, clamped to the session. */
export function currentPositionNumber(
  session: Pick<LearningSessionRecord, 'currentPosition' | 'itemCount'>,
): number {
  return Math.min(Math.max(session.itemCount, 1), Math.max(0, session.currentPosition) + 1);
}

/** "Question 6 of 10" (Learn counts concepts). */
export function positionLabel(
  session: Pick<LearningSessionRecord, 'type' | 'currentPosition' | 'itemCount'>,
): string {
  const noun = session.type === 'learn' ? 'Concept' : 'Question';
  return `${noun} ${currentPositionNumber(session)} of ${session.itemCount}`;
}

export function isResumable(
  session: Pick<LearningSessionRecord, 'status' | 'lastActivityAt'>,
  now: Date,
): boolean {
  if (!isOpenStatus(session.status)) return false;
  const last = Date.parse(session.lastActivityAt);
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last <= RESUME_WINDOW_DAYS * 86_400_000;
}

/** Adds the time since the last interaction, capped so idle time does not count. */
export function addActiveSeconds(
  previousSeconds: number,
  lastActivityAt: string,
  now: Date,
): number {
  const last = Date.parse(lastActivityAt);
  const gap = Number.isFinite(last) ? Math.max(0, (now.getTime() - last) / 1000) : 0;
  return previousSeconds + Math.round(Math.min(gap, IDLE_GAP_CAP_SECONDS));
}

export interface SessionProgress {
  /** 1-based position of the current item. */
  position: number;
  total: number;
  answered: number;
  skipped: number;
  percent: number;
}

export function sessionProgress(
  session: Pick<LearningSessionRecord, 'currentPosition' | 'itemCount'>,
  items: Pick<LearningSessionItemRecord, 'status'>[],
): SessionProgress {
  const answered = items.filter((item) => item.status === 'answered').length;
  const skipped = items.filter((item) => item.status === 'skipped').length;
  const total = session.itemCount;
  return {
    position: currentPositionNumber(session),
    total,
    answered,
    skipped,
    percent: total > 0 ? Math.round(((answered + skipped) / total) * 100) : 0,
  };
}

/** Index of the first item that still needs the student's attention. */
export function firstOpenPosition(items: Pick<LearningSessionItemRecord, 'status' | 'position'>[]): number {
  const open = items
    .filter((item) => item.status === 'pending')
    .sort((a, b) => a.position - b.position)[0];
  if (open) return open.position;
  return items.length > 0 ? Math.max(...items.map((item) => item.position)) : 0;
}

/** What the "Continue where you left off" card and the Today plan need. */
export interface ResumeCard {
  sessionId: string;
  packId: string;
  packTitle: string;
  type: LearningSessionType;
  mode: TestMode | null;
  status: LearningSessionStatus;
  label: string;
  positionLabel: string;
  position: number;
  total: number;
  answeredCount: number;
  lastActivityAt: string;
}

export function toResumeCard(
  session: LearningSessionRecord,
  pack: { id: string; title: string },
): ResumeCard {
  return {
    sessionId: session.id,
    packId: pack.id,
    packTitle: pack.title,
    type: session.type,
    mode: session.mode,
    status: session.status,
    label: sessionLabel(session, pack.title),
    positionLabel: positionLabel(session),
    position: currentPositionNumber(session),
    total: session.itemCount,
    answeredCount: session.answeredCount,
    lastActivityAt: session.lastActivityAt,
  };
}

/**
 * Minutes for one activity — the same per-item constants `estimateStudyTime`
 * uses, so the pack estimate, the pre-start screen and the daily plan agree.
 */
export const MINUTES_PER_QUESTION = STUDY_TIME_RULES.minutesPerQuestion;
export const MINUTES_PER_CARD = STUDY_TIME_RULES.minutesPerFlashcard;
/** Explanation + example, one check question and the self-rating. */
export const MINUTES_PER_LEARN_CONCEPT =
  STUDY_TIME_RULES.minutesPerConcept + STUDY_TIME_RULES.minutesPerQuestion;

export function questionMinutes(count: number): number {
  return Math.max(1, Math.ceil(count * MINUTES_PER_QUESTION));
}

export function cardMinutes(count: number): number {
  return Math.max(1, Math.ceil(count * MINUTES_PER_CARD));
}

export function learnMinutes(count: number): number {
  return Math.max(1, Math.ceil(count * MINUTES_PER_LEARN_CONCEPT));
}
