import { useEffect, useRef } from "react";
import type { Block, ChatMessage, ToolState } from "../state/sessionReducer";
import { Markdown } from "./Markdown";
import { ToolCard } from "./tools/ToolCard";

interface Props {
  messages: ChatMessage[];
  tools: Record<string, ToolState>;
  loadingHistory: boolean;
  emptyHint: string;
  thinkingLabel: string | null;
}

export function MessageList({ messages, tools, loadingHistory, emptyHint, thinkingLabel }: Props): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  });

  const handleScroll = (): void => {
    const element = scroller.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  };

  return (
    <div className="messages" ref={scroller} onScroll={handleScroll}>
      {messages.length === 0 && (
        <div className="empty">{loadingHistory ? "loading transcript…" : emptyHint}</div>
      )}
      {messages.map((message) => (
        <article key={message.id} className={`message message-${message.role}`}>
          {message.blocks.map((block, index) => (
            <BlockView
              key={index}
              block={block}
              tools={tools}
              streaming={message.streaming}
              thinkingLabel={thinkingLabel}
            />
          ))}
          {message.streaming && message.blocks.length === 0 && <div className="typing">…</div>}
          {message.stopReason === "error" && (
            <div className="message-error">{message.errorMessage ?? "the request failed"}</div>
          )}
          {message.role === "assistant" && message.model && (
            <footer className="message-footer">
              {message.model}
              {message.streaming ? " · streaming" : ""}
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}

interface BlockProps {
  block: Block;
  tools: Record<string, ToolState>;
  streaming: boolean;
  thinkingLabel: string | null;
}

function BlockView({ block, tools, streaming, thinkingLabel }: BlockProps): JSX.Element | null {
  switch (block.kind) {
    case "text":
      return <Markdown text={block.text} streaming={streaming} />;
    case "thinking":
      return (
        <details className="thinking">
          <summary>{thinkingLabel ?? (block.redacted ? "thinking (redacted)" : "thinking")}</summary>
          <pre>{block.text}</pre>
        </details>
      );
    case "tool":
      return <ToolCard name={block.name} callId={block.callId} tool={tools[block.callId]} tools={tools} />;
    case "image":
      return <img className="image" alt="" src={`data:${block.mimeType};base64,${block.data}`} />;
    default:
      return null;
  }
}
