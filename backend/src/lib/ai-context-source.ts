/** Provenance of study content supplied to an AI task. */
export type AiContextSource = 'chat' | 'set' | 'card' | 'document' | 'text' | 'source' | 'none';

/** A tiny provenance label for source-aware prompts, including selectable-text PDFs. */
export function contextSourceDirective(source: AiContextSource): string {
  switch (source) {
    case 'chat':
      return 'Context source: student-provided chat material.';
    case 'set':
      return 'Context source: supplied Lerno set.';
    case 'card':
      return 'Context source: supplied card only.';
    case 'document':
      return 'Context source: student-provided document.';
    case 'text':
      return 'Context source: student-pasted study material.';
    case 'source':
      return 'Context source: student-provided study material (normalized Study Pack source with provenance markers).';
    case 'none':
      return 'Context source: none.';
  }
}
