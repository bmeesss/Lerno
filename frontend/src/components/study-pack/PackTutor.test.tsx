import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { studyPackService } from '../../services/studyPackService';
import type { StudyPackDetail } from '../../types';
import { PackTutor } from './PackTutor';

vi.mock('../../services/studyPackService', () => ({ studyPackService: { tutor: vi.fn() } }));

const tutorMock = vi.mocked(studyPackService.tutor);

const PACK = {
  id: 'pack-1',
  title: 'Biology H3',
  subjectName: 'Biology',
  counts: { readySources: 2 },
  concepts: [
    { id: 'c1', name: 'Osmosis' },
    { id: 'c2', name: 'Diffusion' },
  ],
  progress: { weakConcepts: [{ id: 'c2', name: 'Diffusion' }] },
} as unknown as StudyPackDetail;

function renderTutor(detail: StudyPackDetail = PACK, focusConceptId?: string) {
  render(
    <MemoryRouter>
      <PackTutor pack={detail} focusConceptId={focusConceptId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tutorMock.mockResolvedValue({ reply: 'An answer from your notes.', basedOnMaterial: true, citations: [] });
});

describe('PackTutor', () => {
  it('answers from the pack and says where the answer comes from', async () => {
    const user = userEvent.setup();
    renderTutor();
    await user.type(screen.getByLabelText('Ask the AI Tutor'), 'What is osmosis?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(tutorMock).toHaveBeenCalledWith('pack-1', 'What is osmosis?', [], undefined);
    expect(await screen.findByText('An answer from your notes.')).toBeInTheDocument();
    expect(screen.getByText('Based on your material')).toBeInTheDocument();
  });

  it('suggests questions about the weakest concept when nothing is in focus', () => {
    renderTutor();
    expect(screen.getByRole('button', { name: 'Explain Osmosis in simple words' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Why do I keep getting Diffusion wrong?' })).toBeInTheDocument();
  });

  it('knows the concept when it is opened from one, and sends it as context', async () => {
    const user = userEvent.setup();
    renderTutor(PACK, 'c2');
    expect(screen.getByRole('heading', { name: 'AI Tutor · Diffusion' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Give me an example of Diffusion' }));
    expect(tutorMock).toHaveBeenCalledWith('pack-1', 'Give me an example of Diffusion', [], { conceptId: 'c2' });
  });

  it('asks for a readable source first instead of pretending', () => {
    renderTutor({ ...PACK, counts: { readySources: 0 } } as unknown as StudyPackDetail);
    expect(screen.getByText(/add a source with readable text first/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Ask the AI Tutor')).toBeDisabled();
  });
});
