import { useState, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { useToast } from '../ui/Toast';
import { PreviewEditor } from './PreviewEditor';
import type { PackPreview, StudyPackDetail } from '../../types';

/**
 * Practice and Test both need questions first. This is the one shared way to
 * generate them: the AI proposes, the student reviews the preview, and only then
 * are they added to the pack (nothing generated is saved unreviewed).
 */
export function useQuestionGenerator(
  pack: Pick<StudyPackDetail, 'id'>,
  onChanged: () => void,
  count: number,
): { editor: ReactNode | null; generate: () => Promise<void>; generating: boolean } {
  const toast = useToast();
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [generating, setGenerating] = useState(false);

  async function generate() {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await studyPackService.generate(pack.id, 'practice', { count });
      if (result.target === 'practice') setPreview(result);
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.message : 'Could not generate practice questions',
        'error',
      );
    } finally {
      setGenerating(false);
    }
  }

  const editor =
    preview && preview.target === 'practice' ? (
      <PreviewEditor
        packId={pack.id}
        preview={preview}
        onDiscard={() => setPreview(null)}
        onApplied={(message) => {
          setPreview(null);
          toast.show(message, 'success');
          onChanged();
        }}
      />
    ) : null;

  return { editor, generate, generating };
}
