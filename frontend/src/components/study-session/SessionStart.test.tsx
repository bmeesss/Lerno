import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { studySessionService } from '../../services/studySessionService';
import { preview, resumeCard, session, testModes } from '../../test-fixtures/study';
import type { SessionType, StudyPackDetail, TestMode } from '../../types';
import { SessionStart } from './SessionStart';

vi.mock('../../services/studySessionService', () => ({
  studySessionService: { preview: vi.fn(), start: vi.fn() },
}));

const previewMock = vi.mocked(studySessionService.preview);
const startMock = vi.mocked(studySessionService.start);

const PACK = {
  id: 'pack-1',
  progress: { weakConcepts: [{ id: 'c1', name: 'Osmosis' }] },
} as unknown as Pick<StudyPackDetail, 'id' | 'progress'>;

function renderStart(props: { type?: SessionType; mode?: TestMode; conceptId?: string } = {}) {
  render(
    <MemoryRouter initialEntries={['/study-packs/pack-1']}>
      <Routes>
        <Route
          path="/study-packs/:id"
          element={<SessionStart pack={PACK} type={props.type ?? 'practice'} mode={props.mode} conceptId={props.conceptId} />}
        />
        <Route path="/study/sessions/:sessionId" element={<p>Session runner</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  previewMock.mockResolvedValue(preview());
  startMock.mockResolvedValue({ session: session(), resumed: false });
});

describe('SessionStart — practice', () => {
  it('shows what the session will be and gives one clear way to start', async () => {
    renderStart();

    expect(await screen.findByRole('heading', { name: 'Practice Biology' })).toBeInTheDocument();
    expect(screen.getByText('10 questions')).toBeInTheDocument();
    expect(screen.getByText('Focus: weak concepts')).toBeInTheDocument();

    const facts = screen.getByText('Estimated time').closest('dl')!;
    expect(within(facts).getByText('12 min')).toBeInTheDocument();
    expect(within(facts).getByText('Concepts').nextElementSibling).toHaveTextContent('2');
    expect(within(facts).getByText('Medium')).toBeInTheDocument();

    const chips = screen.getByRole('heading', { name: 'What you will work on' }).parentElement!;
    expect(within(chips).getByText('Osmosis')).toBeInTheDocument();
    expect(within(chips).getByText('42%')).toBeInTheDocument();
    expect(within(chips).getByText('Weak')).toBeInTheDocument();
    expect(within(chips).getByText('Missed recently')).toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: /start practice/i })).toHaveLength(1);
  });

  it('asks the server for this exact plan and writes nothing until the student starts', async () => {
    renderStart({ conceptId: 'c1' });
    await screen.findByRole('heading', { name: 'Practice Biology' });
    expect(previewMock).toHaveBeenCalledWith({
      packId: 'pack-1',
      type: 'practice',
      mode: undefined,
      conceptId: 'c1',
    });
    expect(startMock).not.toHaveBeenCalled();
  });

  it('creates the session and opens the runner', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(await screen.findByRole('button', { name: /start practice/i }));

    expect(startMock).toHaveBeenCalledWith({
      packId: 'pack-1',
      type: 'practice',
      mode: undefined,
      conceptId: undefined,
      restart: false,
    });
    expect(await screen.findByText('Session runner')).toBeInTheDocument();
  });

  it('lets the student focus one weak concept and plans it again', async () => {
    const user = userEvent.setup();
    renderStart();
    await screen.findByRole('heading', { name: 'Practice Biology' });

    const pick = screen.getByRole('button', { name: 'Osmosis' });
    expect(pick).toHaveAttribute('aria-pressed', 'false');
    await user.click(pick);

    await waitFor(() =>
      expect(previewMock).toHaveBeenLastCalledWith(expect.objectContaining({ conceptId: 'c1' })),
    );
    expect(screen.getByRole('button', { name: 'Osmosis' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ conceptId: 'c1' }));
  });

  it('mentions the exam when one is close', async () => {
    previewMock.mockResolvedValue(preview({ examDaysLeft: 9 }));
    renderStart();
    expect(await screen.findByText('Exam in 9 days.')).toBeInTheDocument();
    expect(screen.getByText(/chosen with your exam in mind/i)).toBeInTheDocument();
  });

  it('explains why a session cannot start instead of hiding the button', async () => {
    previewMock.mockResolvedValue(
      preview({ canStart: false, count: 0, blockedReason: 'This study pack has no practice questions yet.' }),
    );
    renderStart();
    expect(await screen.findByText('This study pack has no practice questions yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start practice/i })).toBeDisabled();
  });
});

describe('SessionStart — resume', () => {
  beforeEach(() => {
    previewMock.mockResolvedValue(preview({ resume: resumeCard() }));
  });

  it('offers to continue where the student left off, with one primary action', async () => {
    renderStart();
    const banner = await screen.findByRole('group', { name: 'Continue where you left off' });
    expect(within(banner).getByText('Biology Practice')).toBeInTheDocument();
    expect(within(banner).getByText('Question 6 of 10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start practice/i })).not.toBeInTheDocument();
  });

  it('continues the open session without creating a new one', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(await screen.findByRole('button', { name: /^continue/i }));
    expect(await screen.findByText('Session runner')).toBeInTheDocument();
    expect(startMock).not.toHaveBeenCalled();
  });

  it('starts over only when asked to', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(await screen.findByRole('button', { name: 'Start over' }));
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ restart: true }));
    expect(await screen.findByText('Session runner')).toBeInTheDocument();
  });
});

describe('SessionStart — test', () => {
  beforeEach(() => {
    previewMock.mockResolvedValue(
      preview({
        type: 'test',
        mode: 'quick10',
        title: 'Practice test · Biology',
        focus: { label: 'No hints or explanations until you finish', conceptId: null, conceptName: null },
        modes: testModes(),
      }),
    );
  });

  it('offers 10 questions, 20 questions and an exam simulation, without hints', async () => {
    renderStart({ type: 'test' });
    expect(await screen.findByRole('heading', { name: 'Practice Test' })).toBeInTheDocument();
    expect(screen.getByText('No hints or explanations until you finish')).toBeInTheDocument();

    const group = screen.getByRole('group', { name: 'Test length' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(['quick10', 'quick20', 'exam']);
    expect(within(group).getByRole('radio', { name: /10 questions/ })).toBeChecked();
    expect(within(group).getByText('Exam simulation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start test' })).toBeEnabled();
  });

  it('starts the chosen length', async () => {
    const user = userEvent.setup();
    renderStart({ type: 'test' });
    await user.click(await screen.findByRole('radio', { name: /exam simulation/i }));
    await waitFor(() => expect(previewMock).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'exam' })));
    await user.click(screen.getByRole('button', { name: 'Start test' }));
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'test', mode: 'exam', restart: false }));
  });

  it('preselects the mode from the link that brought the student here', async () => {
    renderStart({ type: 'test', mode: 'quick20' });
    expect(await screen.findByRole('radio', { name: /20 questions/ })).toBeChecked();
    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'test', mode: 'quick20' }));
  });

  it('disables the lengths when there are too few questions', async () => {
    previewMock.mockResolvedValue(
      preview({
        type: 'test',
        canStart: false,
        blockedReason: 'Add at least three practice questions before taking a test.',
        modes: testModes(false),
      }),
    );
    renderStart({ type: 'test' });
    expect(await screen.findByText(/Add at least three practice questions/)).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start test' })).toBeDisabled();
  });
});

describe('SessionStart — learn and errors', () => {
  it('counts concepts for a learn session', async () => {
    previewMock.mockResolvedValue(
      preview({
        type: 'learn',
        title: 'Learn Biology',
        count: 5,
        minutes: 10,
        focus: { label: 'Focus: weak and new concepts', conceptId: null, conceptName: null },
      }),
    );
    renderStart({ type: 'learn' });
    expect(await screen.findByRole('heading', { name: 'Learn Biology' })).toBeInTheDocument();
    expect(screen.getByText('5 concepts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start learning/i })).toBeInTheDocument();
  });

  it('shows a clear retry when the preview cannot be loaded', async () => {
    previewMock.mockRejectedValueOnce(new Error('Network down'));
    const user = userEvent.setup();
    renderStart();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Network down');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Practice Biology' })).toBeInTheDocument();
  });

  it('keeps the screen and offers a retry when starting fails', async () => {
    startMock.mockRejectedValueOnce(new ApiError('The server is busy', 'busy', 503));
    const user = userEvent.setup();
    renderStart();
    await user.click(await screen.findByRole('button', { name: /start practice/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server is busy');
    expect(screen.getByRole('heading', { name: 'Practice Biology' })).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Session runner')).toBeInTheDocument();
    expect(startMock).toHaveBeenCalledTimes(2);
  });
});
