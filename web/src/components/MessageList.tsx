import { memo, useEffect, useMemo, useRef, useState } from "react";
import { normalizeTaggedBlocks, type Block, type ChatMessage, type ToolState } from "../state/sessionReducer";
import { Markdown } from "./Markdown";
import { ToolCard } from "./tools/ToolCard";
import { recordPerf } from "../perfLog";
import { boostWheelScroll } from "../scroll";

/** Older messages stay out of the DOM until asked for, keeping long sessions cheap to render. */
const VISIBLE_BATCH = 60;
/** Keep the outline readable; larger histories scroll inside the outline itself. */
const OUTLINE_MAX_VISIBLE = 15;

interface Props {
  messages: ChatMessage[];
  tools: Record<string, ToolState>;
  loadingHistory: boolean;
  emptyHint: string;
  thinkingLabel: string | null;
  connecting: boolean;
}

export function MessageList({ messages, tools, loadingHistory, emptyHint, thinkingLabel, connecting }: Props): JSX.Element {
  recordPerf("message_list_render", 0, { messages: messages.length, tools: Object.keys(tools).length });
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const latestButtonVisible = useRef(false);
  const [showLatestButton, setShowLatestButton] = useState(false);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_BATCH);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ text: string; x: number; y: number } | null>(null);
  const userMessages = useMemo(
    () => messages.flatMap((message, index) => (message.role === "user" ? [{ message, index }] : [])),
    [messages],
  );
  const visible = useMemo(
    () => (messages.length <= visibleCount ? messages : messages.slice(messages.length - visibleCount)),
    [messages, visibleCount],
  );
  const hiddenCount = messages.length - visible.length;
  const toolStatesByMessage = useMessageToolStates(visible, tools);

  // A session switch rebuilds the transcript from scratch; drop the old window size.
  useEffect(() => {
    if (messages.length === 0) setVisibleCount(VISIBLE_BATCH);
  }, [messages.length]);

  useEffect(() => {
    const lastUserMessage = userMessages[userMessages.length - 1]?.message;
    if (!lastUserMessage) {
      setActiveMessageId(null);
    } else if (!activeMessageId || !userMessages.some(({ message }) => message.id === activeMessageId)) {
      setActiveMessageId(lastUserMessage.id);
    }
  }, [activeMessageId, userMessages]);

  useEffect(() => {
    const messageId = pendingMessageId;
    if (!messageId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      if (!target) return;
      setPendingMessageId(null);
      stickToBottom.current = false;
      target.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingMessageId, visible]);

  useEffect(() => {
    const element = scroller.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages, tools]);

  const handleScroll = (): void => {
    const element = scroller.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    stickToBottom.current = atBottom;
    const nextLatestButtonVisible = !atBottom;
    if (latestButtonVisible.current !== nextLatestButtonVisible) {
      latestButtonVisible.current = nextLatestButtonVisible;
      setShowLatestButton(nextLatestButtonVisible);
    }

    const containerTop = element.getBoundingClientRect().top;
    let current: string | null = null;
    for (const message of Array.from(element.querySelectorAll<HTMLElement>(".message-user[data-message-id]"))) {
      if (message.getBoundingClientRect().top <= containerTop + 96) current = message.dataset.messageId ?? current;
    }
    if (current && current !== activeMessageId) setActiveMessageId(current);
  };

  const scrollToLatest = (): void => {
    const element = scroller.current;
    if (!element) return;
    stickToBottom.current = true;
    latestButtonVisible.current = false;
    setShowLatestButton(false);
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  };

  const loadEarlier = (): void => {
    const element = scroller.current;
    const previousHeight = element?.scrollHeight ?? 0;
    setVisibleCount((current) => current + VISIBLE_BATCH);
    // Prepend changes the content height; keep the viewport on the same messages.
    requestAnimationFrame(() => {
      const updated = scroller.current;
      if (updated) updated.scrollTop += updated.scrollHeight - previousHeight;
    });
  };

  const jumpToMessage = (messageId: string, messageIndex: number): void => {
    setPendingMessageId(messageId);
    setActiveMessageId(messageId);
    setVisibleCount((current) => Math.max(current, messages.length - messageIndex));
  };

  return (
    <div className="conversation-shell">
      {userMessages.length > 0 && (
        <aside
          className="message-outline"
          aria-label="User message navigation"
          onMouseLeave={() => {
            setHoverPreview(null);
          }}
        >
          <div
            className={`message-outline-track${
              userMessages.length > OUTLINE_MAX_VISIBLE ? " message-outline-track-dense" : ""
            }`}
          >
            {userMessages.map(({ message, index }, outlineIndex) => {
              const preview = messagePreview(message);
              const isActive = message.id === activeMessageId;
              return (
                <button
                  type="button"
                  className={`message-outline-item${isActive ? " message-outline-item-active" : ""}`}
                  key={message.id}
                  title={preview}
                  aria-label={`Jump to user message ${outlineIndex + 1}: ${preview}`}
                  aria-current={isActive ? "location" : undefined}
                  onClick={() => jumpToMessage(message.id, index)}
                  onMouseEnter={(event) =>
                    setHoverPreview({ text: preview, x: event.clientX + 12, y: event.clientY + 12 })
                  }
                  onMouseMove={(event) =>
                    setHoverPreview({ text: preview, x: event.clientX + 12, y: event.clientY + 12 })
                  }
                  onMouseLeave={() => setHoverPreview(null)}
                >
                  <span className="message-outline-marker" />
                </button>
              );
            })}
          </div>
          {hoverPreview && (
            <div
              className="message-outline-tooltip"
              role="tooltip"
              style={{ left: `${hoverPreview.x}px`, top: `${hoverPreview.y}px` }}
            >
              {hoverPreview.text}
            </div>
          )}
        </aside>
      )}
      <div
        className="messages"
        ref={scroller}
        onScroll={handleScroll}
        onWheel={boostWheelScroll}
        role="log"
        aria-live="polite"
        aria-label="pi conversation"
      >
        {messages.length === 0 && !connecting && (
          <div className="empty">{loadingHistory ? "loading transcript" : emptyHint}</div>
        )}
        {hiddenCount > 0 && (
          <button type="button" className="load-earlier" onClick={loadEarlier}>
            Load earlier messages ({hiddenCount} remaining)
          </button>
        )}
        {visible.map((message, index) => (
          <MemoMessageView
            key={message.id}
            message={message}
            previousAssistantModel={
              index + hiddenCount > 0 && messages[index + hiddenCount - 1]?.role === "assistant"
                ? messages[index + hiddenCount - 1]?.model
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
          <button
            type="button"
            className="latest-button"
            onClick={scrollToLatest}
            title="Back to latest"
            aria-label="Back to latest"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M12 5v14m-6-6 6 6 6-6" />
            </svg>
          </button>
        )}
      </div>
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

  return (
    <article className={`message message-${message.role}`} data-message-id={message.id}>
      {message.blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          tools={tools}
          streaming={message.streaming}
          thinkingLabel={thinkingLabel}
        />
      ))}
      {message.streaming && message.blocks.length === 0 && <div className="typing">...</div>}
      {message.stopReason === "error" && (
        <div className="message-error">{message.errorMessage ?? "the request failed"}</div>
      )}
      {showModel && (
        <footer className="message-footer">
          <span>{message.model}{message.streaming ? " - streaming" : ""}</span>
        </footer>
      )}
    </article>
  );
}

function messagePreview(message: ChatMessage): string {
  const text = message.blocks
    .filter((block): block is Extract<Block, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 72) return `${text.slice(0, 72)}...`;
  return text || "Image or attachment";
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
    const startedAt = performance.now();
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
    recordPerf("tool_dependency_index", performance.now() - startedAt, {
      messages: messages.length,
      tools: Object.keys(tools).length,
    });
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
