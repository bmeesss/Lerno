import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { reportService } from '../../services/reportService';
import type { ReportTargetType } from '../../types';

const REASONS = [
  'Incorrect or misleading content',
  'Spam or advertising',
  'Inappropriate or offensive content',
  'Copyright concern',
  'Other',
];

interface Props {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  targetLabel: string;
}

export function ReportModal({ open, onClose, targetType, targetId, targetLabel }: Props) {
  const toast = useToast();
  const [reason, setReason] = useState(REASONS[0]!);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await reportService.create({
        targetType,
        targetId,
        reason,
        details: details.trim() || null,
      });
      toast.show('Thanks — our moderators will take a look.', 'success');
      setDetails('');
      onClose();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not send report', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={`Report ${targetLabel}`} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="report-reason">Reason</label>
          <select
            id="report-reason"
            className="select input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {REASONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="report-details">Details (optional)</label>
          <textarea
            id="report-details"
            className="textarea"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={2000}
            placeholder="Tell us what is wrong with this content…"
          />
        </div>
        <div className="modal-actions">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? 'Sending…' : 'Send report'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
