import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { TutorDrawer } from './TutorDrawer';

vi.mock('../../services/studyPackService', () => ({ studyPackService: { tutor: vi.fn() } }));

const tutorMock = vi.mocked(studyPackService.tutor);

function Harness({ conceptId = 'c1', conceptName = 'Osmosis', initialMessage }: { conceptId?: string; conceptName?: string; initialMessage?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open tutor
      </button>
      <TutorDrawer
        open={open}
        onClose={() => setOpen(false)}
        packId="pack-1"
        context={{ conceptId, sessionId: 's1', itemId: 'i1' }}
        conceptName={conceptName}
        initialMessage={initialMessage}
      />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TutorDrawer', () => {
  it('opens for the current concept and sends the study context with every question', async () => {
    tutorMock.mockResolvedValue({
      reply: 'Osmosis is the movement of water.',
      basedOnMaterial: true,
      citations: [{ sourceId: 'source-1', title: 'Biology.pdf', ref: 'page 3' }],
    });
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole('dialog', { name: 'AI Tutor · Osmosis' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Ask the AI Tutor'), 'What is osmosis?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(tutorMock).toHaveBeenCalledWith('pack-1', 'What is osmosis?', [], {
      conceptId: 'c1',
      sessionId: 's1',
      itemId: 'i1',
    });
    const log = screen.getByRole('log', { name: 'AI Tutor conversation' });
    expect(await within(log).findByText('Osmosis is the movement of water.')).toBeInTheDocument();
    expect(within(log).getByText('Based on your material')).toBeInTheDocument();
    expect(within(log).getByText(/Biology\.pdf · page 3/)).toBeInTheDocument();
  });

  it('labels an answer that is not from the material as a general explanation', async () => {
    tutorMock.mockResolvedValue({ reply: 'In general, water moves to balance solutes.', basedOnMaterial: false, citations: [] });
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Ask the AI Tutor'), 'Why?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('General explanation — not from your material')).toBeInTheDocument();
    expect(screen.queryByText('Based on your material')).not.toBeInTheDocument();
  });

  it('sends the "Explain this" question by itself, once', async () => {
    tutorMock.mockResolvedValue({ reply: 'Simple words.', basedOnMaterial: true, citations: [] });
    render(<Harness initialMessage="Explain Osmosis in simple words." />);
    await waitFor(() => expect(tutorMock).toHaveBeenCalledTimes(1));
    expect(tutorMock.mock.calls[0]![1]).toBe('Explain Osmosis in simple words.');
    expect(await screen.findByText('Simple words.')).toBeInTheDocument();
  });

  it('shows a clear retry when the tutor cannot answer, and keeps the question', async () => {
    tutorMock.mockRejectedValueOnce(new ApiError('The AI tutor is unavailable right now.', 'ai_unavailable', 503));
    tutorMock.mockResolvedValueOnce({ reply: 'Back again.', basedOnMaterial: true, citations: [] });
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Ask the AI Tutor'), 'What is osmosis?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The AI tutor is unavailable right now.');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back again.')).toBeInTheDocument();
    expect(tutorMock).toHaveBeenCalledTimes(2);
    expect(tutorMock.mock.calls[1]![1]).toBe('What is osmosis?');
    // The question appears once in the conversation, not once per attempt.
    expect(screen.getAllByText('What is osmosis?')).toHaveLength(1);
  });

  it('keeps the conversation when it is closed and opened again', async () => {
    tutorMock.mockResolvedValue({ reply: 'An answer.', basedOnMaterial: true, citations: [] });
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Ask the AI Tutor'), 'Hello');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('An answer.');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open tutor' }));
    expect(screen.getByText('An answer.')).toBeInTheDocument();
  });

  it('starts a fresh conversation for another concept', async () => {
    tutorMock.mockResolvedValue({ reply: 'About osmosis.', basedOnMaterial: true, citations: [] });
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.type(screen.getByLabelText('Ask the AI Tutor'), 'Hello');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('About osmosis.');

    rerender(<Harness conceptId="c2" conceptName="Diffusion" />);
    expect(screen.getByRole('dialog', { name: 'AI Tutor · Diffusion' })).toBeInTheDocument();
    expect(screen.queryByText('About osmosis.')).not.toBeInTheDocument();
  });
});
