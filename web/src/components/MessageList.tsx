import { memo, useEffect, useMemo, useRef, useState } from "react";
import { normalizeTaggedBlocks, type Block, type ChatMessage, type ToolState } from "../state/sessionReducer";
import { Markdown } from "./Markdown";
import { ToolCard } from "./tools/ToolCard";

interface Props {
  messages: ChatMessage[];
  tools: Record<string, ToolState>;
  loadingHistory: boolean;
  emptyHint: string;
  thinkingLabel: string | null;
  connecting: boolean;
}

export function MessageList({ messages, tools, loadingHistory, emptyHint, thinkingLabel, connecting }: Props): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [showLatestButton, setShowLatestButton] = useState(false);
  const toolStatesByMessage = useMessageToolStates(messages, tools);

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
      {messages.length === 0 && !connecting && (
        <div className="empty">{loadingHistory ? "loading transcript…" : emptyHint}</div>
      )}
      {messages.map((message, messageIndex) => (
        <MemoMessageView
          key={message.id}
          message={message}
          previousAssistantModel={
            messageIndex > 0 && messages[messageIndex - 1]?.role === "assistant"
              ? messages[messageIndex - 1]?.model
              : null
          }
          tools={tools}
          toolStates={toolStatesByMessage.get(message.id) ?? EMPTY_TOOL_STATES}
          thinkingLabel={thinkingLabel}
        />
      ))}
      {connecting && (
        <div className="connecting-status" role="status" aria-label="正在连接服务">
          <span>正在连接服务</span>
          <AnimatedEllipsis className="connecting-ellipsis" />
        </div>
      )}
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
  /** Stable references for the tool calls owned by this message. */
  toolStates: readonly (ToolState | undefined)[];
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

/**
 * Streaming updates replace only the active message object. Keep finished messages out of the
 * render path; tool state is compared only for tool calls owned by this message (including nested
 * calls), so an unrelated tool update does not repaint the whole transcript.
 */
const MemoMessageView = memo(MessageView, areMessageViewPropsEqual);

function areMessageViewPropsEqual(previous: MessageViewProps, next: MessageViewProps): boolean {
  if (
    previous.message !== next.message ||
    previous.previousAssistantModel !== next.previousAssistantModel ||
    previous.thinkingLabel !== next.thinkingLabel ||
    previous.toolStates !== next.toolStates
  ) {
    return false;
  }
  return true;
}

const EMPTY_TOOL_STATES: readonly (ToolState | undefined)[] = [];

type CachedToolStates = {
  callIds: string[];
  states: readonly (ToolState | undefined)[];
  message: ChatMessage;
};

/**
 * Builds the tool dependencies once per store update instead of scanning every tool for every
 * message inside React.memo comparators. The arrays for unaffected messages are reused, so their
 * memoized views remain mounted while another message streams.
 */
function useMessageToolStates(
  messages: ChatMessage[],
  tools: Record<string, ToolState>,
): Map<string, readonly (ToolState | undefined)[]> {
  const cache = useRef(new Map<string, CachedToolStates>());
  return useMemo(() => {
    const children = new Map<string, string[]>();
    for (const tool of Object.values(tools)) {
      if (!tool.parentCallId) continue;
      const siblings = children.get(tool.parentCallId) ?? [];
      siblings.push(tool.callId);
      children.set(tool.parentCallId, siblings);
    }

    const nextCache = new Map<string, CachedToolStates>();
    const result = new Map<string, readonly (ToolState | undefined)[]>();
    for (const message of messages) {
      const callIds: string[] = [];
      const seen = new Set<string>();
      const pending = message.blocks
        .filter((block): block is Extract<Block, { kind: "tool" }> => block.kind === "tool")
        .map((block) => block.callId);
      while (pending.length > 0) {
        const callId = pending.shift();
        if (typeof callId !== "string" || seen.has(callId)) continue;
        seen.add(callId);
        callIds.push(callId);
        pending.push(...(children.get(callId) ?? []));
      }

      const previous = cache.current.get(message.id);
      const states = previous && previous.message === message && sameToolStates(previous, callIds, tools)
        ? previous.states
        : callIds.map((callId) => tools[callId]);
      nextCache.set(message.id, { callIds, states, message });
      result.set(message.id, states);
    }
    cache.current = nextCache;
    return result;
  }, [messages, tools]);
}

function sameToolStates(
  cached: CachedToolStates,
  callIds: string[],
  tools: Record<string, ToolState>,
): boolean {
  if (cached.callIds.length !== callIds.length) return false;
  for (let index = 0; index < callIds.length; index += 1) {
    const callId = callIds[index];
    if (callId === undefined || cached.callIds[index] !== callId || cached.states[index] !== tools[callId]) return false;
  }
  return true;
}

function AnimatedEllipsis({ className }: { className: string }): JSX.Element {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const timer = window.setInterval(() => setCount((current) => (current % 3) + 1), 400);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className={className} aria-hidden="true">
      {".".repeat(count)}
    </span>
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
          <summary>
            <span>{thinkingLabel ?? (block.redacted ? "thinking (redacted)" : "thinking")}</span>
            {streaming && <AnimatedEllipsis className="thinking-ellipsis" />}
          </summary>
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
