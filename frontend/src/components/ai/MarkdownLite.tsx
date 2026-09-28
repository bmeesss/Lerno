/**
 * Renders light markdown from AI answers as React elements — readable chat
 * formatting (headings, lists, bold, inline code) without ever injecting
 * raw HTML.
 */
import { parseBlocks, type InlineToken } from '../../lib/markdownLite';

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === 'bold') return <strong key={index}>{token.value}</strong>;
        if (token.kind === 'code') return <code key={index}>{token.value}</code>;
        return <span key={index}>{token.value}</span>;
      })}
    </>
  );
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks = parseBlocks(text);

  return (
    <div className="ai-markdown">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <p key={index} className="ai-md-heading">
              <Inline tokens={block.inline} />
            </p>
          );
        }
        if (block.kind === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={index} className="ai-md-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline tokens={item} />
                </li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={index} className="ai-md-paragraph">
            <Inline tokens={block.inline} />
          </p>
        );
      })}
    </div>
  );
}
