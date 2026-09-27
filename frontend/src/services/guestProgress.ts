/**
 * Guest-only progress (spec §8): kept in localStorage on this device.
 * Guests cannot persist progress across devices — an account is required for
 * that. Guest progress is cleared by "clear guest data" in Settings.
 */

const key = (setId: string) => `lerno.guest.${setId}`;

export interface GuestCardState {
  correctCount: number;
  incorrectCount: number;
  lastResult: 'correct' | 'incorrect' | null;
}

type GuestSession = Record<string, GuestCardState>;

function read(setId: string): GuestSession {
  try {
    const raw = localStorage.getItem(key(setId));
    return raw ? (JSON.parse(raw) as GuestSession) : {};
  } catch {
    return {};
  }
}

export const guestProgress = {
  record(setId: string, cardId: string, result: 'correct' | 'incorrect'): void {
    const session = read(setId);
    const state = session[cardId] ?? { correctCount: 0, incorrectCount: 0, lastResult: null };
    if (result === 'correct') state.correctCount += 1;
    else state.incorrectCount += 1;
    state.lastResult = result;
    session[cardId] = state;
    localStorage.setItem(key(setId), JSON.stringify(session));
  },

  summary(setId: string): { cardsSeen: number; correct: number; incorrect: number } {
    const session = read(setId);
    let correct = 0;
    let incorrect = 0;
    for (const state of Object.values(session)) {
      correct += state.correctCount;
      incorrect += state.incorrectCount;
    }
    return { cardsSeen: Object.keys(session).length, correct, incorrect };
  },

  clearAll(): void {
    for (const storageKey of Object.keys(localStorage)) {
      if (storageKey.startsWith('lerno.guest.')) localStorage.removeItem(storageKey);
    }
  },
};
