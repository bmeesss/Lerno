import { describe, expect, it } from 'vitest';
import { nextActionLink } from './nextAction';

describe('nextActionLink', () => {
  it('routes every continue-action type to a calm, concrete step', () => {
    expect(
      nextActionLink({ type: 'review', setId: 's1', setTitle: 'Bio', dueCount: 7 }),
    ).toEqual({ to: '/sets/s1/study', label: 'Review 7 due cards' });
    expect(
      nextActionLink({ type: 'continue-session', sessionId: 'x', setId: 's1', setTitle: 'Bio' }),
    ).toEqual({ to: '/sets/s1/study', label: 'Continue “Bio”' });
    expect(
      nextActionLink({ type: 'study-set', setId: 's1', setTitle: 'Bio', remaining: 3 }),
    ).toEqual({ to: '/sets/s1/study', label: 'Study “Bio”' });
    expect(
      nextActionLink({ type: 'daily-goal', setId: 's1', setTitle: 'Bio', remaining: 4 }),
    ).toEqual({ to: '/sets/s1/study', label: "4 more cards for today's goal" });
    expect(nextActionLink({ type: 'create-set' })).toEqual({
      to: '/sets/new',
      label: 'Create your first study set',
    });
    expect(nextActionLink({ type: 'discover' })).toEqual({
      to: '/discover',
      label: 'Discover study sets',
    });
  });
});
