/**
 * Renders light markdown from AI answers as React elements — readable chat
 * formatting (headings, lists, tables, code, quotes, formulas) without ever
 * injecting raw HTML.
 *
 * Memoized: AI answers never change, so re-rendering the chat (typing, loading
 * state) must not re-parse every message.
 */
import { memo, useMemo } from 'react';
import {
  parseBlocks,
  type InlineToken,
  type ListItem,
  type MarkdownBlock,
} from '../../lib/markdownLite';

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === 'bold') return <strong key={index}>{token.value}</strong>;
        if (token.kind === 'italic') return <em key={index}>{token.value}</em>;
        if (token.kind === 'strike') return <del key={index}>{token.value}</del>;
        if (token.kind === 'code') return <code key={index}>{token.value}</code>;
        if (token.kind === 'math')
          return (
            <span key={index} className="ai-md-math-inline">
              {token.value}
            </span>
          );
        if (token.kind === 'link')
          return (
            <a key={index} href={token.href} target="_blank" rel="noreferrer noopener">
              {token.value}
            </a>
          );
        return <span key={index}>{token.value}</span>;
      })}
    </>
  );
}

const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6'] as const;

function ListItems({ items }: { items: ListItem[] }) {
  return (
    <>
      {items.map((item, index) => (
        <li key={index}>
          <Inline tokens={item.inline} />
          {item.children.length > 0 ? <Blocks blocks={item.children} /> : null}
        </li>
      ))}
    </>
  );
}

function Blocks({ blocks }: { blocks: MarkdownBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const Tag = HEADING_TAGS[Math.min(Math.max(block.level, 1), 4) - 1] ?? 'h4';
          return (
            <Tag key={index} className="ai-md-heading">
              <Inline tokens={block.inline} />
            </Tag>
          );
        }

        if (block.kind === 'list') {
          return block.ordered ? (
            <ol key={index} className="ai-md-list" start={block.start}>
              <ListItems items={block.items} />
            </ol>
          ) : (
            <ul key={index} className="ai-md-list">
              <ListItems items={block.items} />
            </ul>
          );
        }

        if (block.kind === 'code') {
          return (
            <div key={index} className="ai-md-code-block">
              {block.language ? <span className="ai-md-code-lang">{block.language}</span> : null}
              <pre className="ai-md-pre">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.kind === 'quote') {
          return (
            <blockquote key={index} className="ai-md-quote">
              <Blocks blocks={block.blocks} />
            </blockquote>
          );
        }

        if (block.kind === 'table') {
          return (
            <div
              key={index}
              className="ai-md-table-wrap"
              tabIndex={0}
              role="group"
              aria-label="Table"
            >
              <table className="ai-md-table">
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th
                        key={cellIndex}
                        className={`ai-md-align-${block.align[cellIndex] ?? 'left'}`}
                      >
                        <Inline tokens={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={`ai-md-align-${block.align[cellIndex] ?? 'left'}`}
                        >
                          <Inline tokens={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.kind === 'math') {
          return (
            <div key={index} className="ai-md-math" role="math">
              {block.value}
            </div>
          );
        }

        if (block.kind === 'divider') return <hr key={index} className="ai-md-divider" />;

        return (
          <p key={index} className="ai-md-paragraph">
            <Inline tokens={block.inline} />
          </p>
        );
      })}
    </>
  );
}

export const MarkdownLite = memo(function MarkdownLite({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <div className="ai-markdown">
      <Blocks blocks={blocks} />
    </div>
  );
});
