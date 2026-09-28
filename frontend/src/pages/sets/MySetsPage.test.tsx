import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { studySetService } from '../../services/studySetService';
import { MySetsPage } from './MySetsPage';
import type { StudySetSummary } from '../../types';

vi.mock('../../services/studySetService', () => ({ studySetService: { listMine: vi.fn() } }));
vi.mock('../../components/ai/AiGenerateSetModal', () => ({ AiGenerateSetModal: () => null }));
const base: StudySetSummary = {
  id: 'cells',
  ownerId: 'u1',
  subjectId: 'bio',
  subjectName: 'Biology',
  title: 'Cells',
  slug: 'cells',
  description: 'Cell structures',
  level: 'Mavo 3',
  visibility: 'public',
  tags: [],
  cardCount: 8,
  authorName: 'Sam',
  createdAt: '',
  updatedAt: '',
};
const renderPage = () =>
  render(
    <MemoryRouter>
      <MySetsPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(studySetService.listMine).mockReset();
  vi.mocked(studySetService.listMine).mockResolvedValue([
    base,
    {
      ...base,
      id: 'algebra',
      title: 'Algebra',
      description: 'Solving equations',
      subjectName: 'Math',
      visibility: 'private',
    },
  ]);
});

describe('library presentation', () => {
  it('filters the existing result locally by search, subject and visibility', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('link', { name: /Cells/ })).toHaveAttribute(
      'href',
      '/sets/cells',
    );
    await user.click(screen.getByRole('button', { name: 'Private' }));
    expect(screen.queryByRole('link', { name: /Cells/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Algebra/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All sets' }));
    await user.selectOptions(screen.getByLabelText('Filter by subject'), 'Biology');
    expect(screen.queryByRole('link', { name: /Algebra/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search your sets' }), 'no match');
    expect(screen.getByRole('heading', { name: 'No matching sets' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('link', { name: /Algebra/ })).toBeInTheDocument();
    expect(studySetService.listMine).toHaveBeenCalledTimes(1);
  });

  it('shows an actionable empty state, not fabricated progress', async () => {
    vi.mocked(studySetService.listMine).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'No study sets yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first set' })).toHaveAttribute(
      'href',
      '/sets/new',
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('uses skeletons while waiting, then provides a working retry', async () => {
    vi.mocked(studySetService.listMine).mockRejectedValueOnce(new Error('Offline'));
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Could not load your sets' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Cells/ })).toBeInTheDocument();
    expect(studySetService.listMine).toHaveBeenCalledTimes(2);
  });
});
