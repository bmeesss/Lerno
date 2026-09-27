/** Maps the server's deterministic continue-action to a label + route. */
import type { ContinueAction } from '../types';

export function nextActionLink(action: ContinueAction): { to: string; label: string } {
  switch (action.type) {
    case 'review':
      return {
        to: `/sets/${action.setId}/study`,
        label: `Review ${action.dueCount} due card${action.dueCount === 1 ? '' : 's'}`,
      };
    case 'continue-session':
      return { to: `/sets/${action.setId}/study`, label: `Continue “${action.setTitle}”` };
    case 'study-set':
      return { to: `/sets/${action.setId}/study`, label: `Study “${action.setTitle}”` };
    case 'daily-goal':
      return {
        to: `/sets/${action.setId}/study`,
        label: `${action.remaining} more card${action.remaining === 1 ? '' : 's'} for today's goal`,
      };
    case 'create-set':
      return { to: '/sets/new', label: 'Create your first study set' };
    case 'discover':
      return { to: '/discover', label: 'Discover study sets' };
  }
}
