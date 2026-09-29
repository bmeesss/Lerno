import { minutesLong } from './sessionCopy';
import { formatMinutes } from './studyPackRoutes';
import type {
  ExamBanner,
  ResumeCard,
  StudyPackToday,
  StudyStreak,
  TodayStep,
} from '../types';

/** One numbered step of today's plan. */
export type PlanStep = TodayStep & { order: number };

export interface NormalizedToday {
  steps: PlanStep[];
  /** The one thing to do now — the first step. Null when nothing is planned. */
  primary: PlanStep | null;
  /** Total minutes of the plan, or null when the server did not say. */
  minutes: number | null;
  budgetMinutes: number | null;
  adjustedForExam: boolean;
  exam: ExamBanner | null;
  resume: ResumeCard[];
  streak: StudyStreak | null;
}

/**
 * The daily plan as the page needs it. Newer servers send the plan, the exam
 * banner, resume cards and streak; an older response only has `tasks` and
 * `exams`, and the page must still work with that — so both shapes end up here.
 */
export function normalizeToday(today: StudyPackToday | null): NormalizedToday {
  if (!today) {
    return {
      steps: [],
      primary: null,
      minutes: null,
      budgetMinutes: null,
      adjustedForExam: false,
      exam: null,
      resume: [],
      streak: null,
    };
  }

  const steps: PlanStep[] = today.plan
    ? today.plan.steps.map((step, index) => ({ ...step, order: step.order ?? index + 1 }))
    : today.tasks.map((task, index) => ({ ...task, order: index + 1 }));

  const summed = steps.reduce((sum, step) => sum + (step.minutes ?? 0), 0);
  const minutes = today.plan ? today.plan.minutes : summed > 0 ? summed : null;

  let exam: ExamBanner | null = today.exam ?? null;
  if (!exam) {
    const upcoming = today.exams.find((entry) => entry.daysLeft !== null && entry.daysLeft >= 0);
    if (upcoming && upcoming.daysLeft !== null && upcoming.examDate) {
      exam = {
        packId: upcoming.packId,
        title: upcoming.title,
        examDate: upcoming.examDate,
        daysLeft: upcoming.daysLeft,
        message: `${upcoming.title} exam ${
          upcoming.daysLeft === 0 ? 'is today' : upcoming.daysLeft === 1 ? 'is tomorrow' : `in ${upcoming.daysLeft} days`
        }`,
        note: null,
      };
    }
  }

  return {
    steps,
    primary: steps[0] ?? null,
    minutes,
    budgetMinutes: today.plan?.budgetMinutes ?? null,
    adjustedForExam: today.plan?.adjustedForExam ?? false,
    exam,
    resume: today.resume ?? [],
    streak: today.streak ?? null,
  };
}

/**
 * The name of a step: "Practice Osmosis", "Review 8 cards". The pack title the
 * engine appends ("· Biology") is shown separately, so it is dropped here.
 */
export function stepTitle(step: Pick<TodayStep, 'label' | 'packTitle'>): string {
  const suffix = step.packTitle ? ` · ${step.packTitle}` : '';
  return suffix && step.label.endsWith(suffix) ? step.label.slice(0, -suffix.length) : step.label;
}

/** "10 questions", "3 concepts", "8 cards": how much a step contains. Null when unknown. */
export function stepAmount(step: Pick<TodayStep, 'type' | 'sessionType' | 'count'>): string | null {
  const count = step.count ?? null;
  if (!count || count <= 0) return null;
  const noun =
    step.type === 'review' && step.sessionType === null
      ? 'card'
      : step.type === 'learn' || step.type === 'review'
        ? 'concept'
        : step.type === 'practice' || step.type === 'test'
          ? 'question'
          : null;
  if (!noun) return null;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "Biology · 10 questions · 8 min": the quiet line under a step title. */
export function stepMeta(step: TodayStep, options: { showPack?: boolean } = {}): string {
  const parts: string[] = [];
  if (options.showPack !== false && step.packTitle) parts.push(step.packTitle);
  const amount = stepAmount(step);
  if (amount) parts.push(amount);
  if (step.minutes) parts.push(formatMinutes(step.minutes));
  return parts.join(' · ');
}

/** The sentence that explains why a step is on the plan. */
export function stepReason(step: Pick<TodayStep, 'reasonText' | 'description'>): string {
  return step.reasonText || step.description;
}

/** "You have 25 minutes planned." — honest when nothing is planned. */
export function plannedMinutesSentence(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return 'Nothing is planned yet.';
  return `You have ${minutesLong(minutes)} planned.`;
}
