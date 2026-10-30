import { useEffect, useRef, useState } from "react";
import { normalizeTaggedBlocks, type Block, type ChatMessage, type ToolState } from "../state/sessionReducer";
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
  const [showLatestButton, setShowLatestButton] = useState(false);

  useEffect(() => {
    const element = scroller.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  });

  const handleScroll = (): void => {
    const element = scroller.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    stickToBottom.current = atBottom;
    setShowLatestButton(!atBottom);
  };

  const scrollToLatest = (): void => {
    const element = scroller.current;
    if (!element) return;
    stickToBottom.current = true;
    setShowLatestButton(false);
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  };

  return (
    <div
      className="messages"
      ref={scroller}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="pi conversation"
    >
      {messages.length === 0 && (
        <div className="empty">{loadingHistory ? "loading transcript…" : emptyHint}</div>
      )}
      {messages.map((message, messageIndex) => (
        <MessageView
          key={message.id}
          message={message}
          previousAssistantModel={
            messageIndex > 0 && messages[messageIndex - 1]?.role === "assistant"
              ? messages[messageIndex - 1]?.model
              : null
          }
          tools={tools}
          thinkingLabel={thinkingLabel}
        />
      ))}
      {showLatestButton && (
        <button type="button" className="latest-button" onClick={scrollToLatest}>
          ↓ 回到最新
        </button>
      )}
    </div>
  );
}

interface MessageViewProps {
  message: ChatMessage;
  previousAssistantModel: string | null | undefined;
  tools: Record<string, ToolState>;
  thinkingLabel: string | null;
}

function MessageView({ message, previousAssistantModel, tools, thinkingLabel }: MessageViewProps): JSX.Element {
  const showModel = message.role === "assistant" && message.model && message.model !== previousAssistantModel;
  const copyableText = message.blocks
    .filter((block): block is Extract<Block, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  const canCopy = copyableText.length > 0 && !message.streaming;

  return (
    <article className={`message message-${message.role}`}>
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
      {showModel && (
        <footer className="message-footer">
          <span>{message.model}{message.streaming ? " · streaming" : ""}</span>
        </footer>
      )}
      {canCopy && <CopyMessageButton text={copyableText} />}
    </article>
  );
}


function CopyMessageButton({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button type="button" className="message-copy" onClick={copy} title="Copy assistant message">
      {copied ? "已复制" : "复制"}
    </button>
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
    case "text": {
      if (!/<\/?thinking\b/i.test(block.text)) {
        return <Markdown text={block.text} streaming={streaming} />;
      }
      return (
        <>
          {normalizeTaggedBlocks([block]).map((nestedBlock, index) => (
            <BlockView
              key={index}
              block={nestedBlock}
              tools={tools}
              streaming={streaming}
              thinkingLabel={thinkingLabel}
            />
          ))}
        </>
      );
    }
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
