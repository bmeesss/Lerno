/** Conservative prose-only cleanup. Never run on JSON or alter code/formula blocks. */
export function cleanAiText(text: string): string {
  if (/```|~~~/.test(text)) return text.trim();
  const cleaned = text
    .replace(/^(?:Sure!|Of course!|Natuurlijk!|Zeker!)[ \t]*\n+/i, '')
    .replace(
      /\n+(?:Laat het me weten als je (?:nog )?vragen hebt[.!]?|Let me know if you have any questions[.!]?)[ \t]*$/i,
      '',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned || text.trim();
}
