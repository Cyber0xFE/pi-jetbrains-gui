import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { normalizeTaggedBlocks, type Block, type ChatMessage, type ToolState } from "../state/sessionReducer";
import { Markdown } from "./Markdown";
import { CopyButton } from "./CopyButton";
import { ToolCard } from "./tools/ToolCard";
import { ImagePreview } from "./ImagePreview";
import { recordPerf } from "../perfLog";
import { useSmoothWheelScroll } from "../scroll";
import { post } from "../bridge";

/** Older messages stay out of the DOM until asked for, keeping long sessions cheap to render. */
const VISIBLE_BATCH = 60;
/** Keep the outline readable; larger histories scroll inside the outline itself. */
const OUTLINE_MAX_VISIBLE = 15;
const OUTLINE_ITEM_STEP = 27;
const OUTLINE_OVERSCAN = 20;
const EMPTY_FILE_REFERENCES: string[] = [];

interface Props {
  messages: ChatMessage[];
  files?: string[];
  tools: Record<string, ToolState>;
  loadingHistory: boolean;
  emptyHint: string;
  thinkingLabel: string | null;
  connecting: boolean;
  scrollToLatestRequest?: number;
  scrollToFirstRequest?: number;
}

export function MessageList({
  messages,
  files = EMPTY_FILE_REFERENCES,
  tools,
  loadingHistory,
  emptyHint,
  thinkingLabel,
  connecting,
  scrollToLatestRequest = 0,
  scrollToFirstRequest = 0,
}: Props): JSX.Element {
  recordPerf("message_list_render", 0, { messages: messages.length, tools: Object.keys(tools).length });
  const scroller = useRef<HTMLDivElement>(null);
  const outlineScroller = useRef<HTMLDivElement>(null);
  const [outlineEdges, setOutlineEdges] = useState({ up: false, down: false });
  const stickToBottom = useRef(true);
  const scrollFrame = useRef<number | null>(null);
  const previousScrollTop = useRef(0);
  const messageOffsets = useRef<Array<{ id: string; top: number }> | null>(null);
  useSmoothWheelScroll(scroller, (delta) => {
    previousScrollTop.current = scroller.current?.scrollTop ?? 0;
    if (delta < 0) stickToBottom.current = false;
  });
  const latestButtonVisible = useRef(false);
  const [showLatestButton, setShowLatestButton] = useState(false);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_BATCH);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ text: string; x: number; y: number } | null>(null);
  const [outlineScrollTop, setOutlineScrollTop] = useState(0);
  const outlineScrollFrame = useRef<number | null>(null);
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
  const outlineVirtualized = userMessages.length > OUTLINE_MAX_VISIBLE;
  const outlineStart = outlineVirtualized
    ? Math.max(0, Math.floor(Math.max(0, outlineScrollTop - 18) / OUTLINE_ITEM_STEP) - OUTLINE_OVERSCAN)
    : 0;
  const outlineEnd = outlineVirtualized
    ? Math.min(userMessages.length, outlineStart + Math.ceil(435 / OUTLINE_ITEM_STEP) + OUTLINE_OVERSCAN * 2)
    : userMessages.length;
  const visibleUserMessages = outlineVirtualized ? userMessages.slice(outlineStart, outlineEnd) : userMessages;

  const updateOutlineEdges = (): void => {
    const element = outlineScroller.current;
    if (!element) return;
    const up = element.scrollTop > 1;
    const down = element.scrollHeight - element.clientHeight - element.scrollTop > 1;
    setOutlineEdges((current) => current.up === up && current.down === down ? current : { up, down });
  };

  useEffect(() => {
    const element = outlineScroller.current;
    if (!element) return;
    updateOutlineEdges();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateOutlineEdges) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [userMessages.length]);

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
    if (element && stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
      previousScrollTop.current = element.scrollTop;
    }
  }, [messages, tools]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    stickToBottom.current = true;
    latestButtonVisible.current = false;
    setShowLatestButton(false);
    element.scrollTop = element.scrollHeight;
    previousScrollTop.current = element.scrollTop;
  }, [scrollToLatestRequest]);

  useEffect(() => {
    if (scrollToFirstRequest === 0) return;
    setVisibleCount(messages.length || VISIBLE_BATCH);
    const firstUserMessage = userMessages[0]?.message;
    if (firstUserMessage) setActiveMessageId(firstUserMessage.id);
    stickToBottom.current = false;
    latestButtonVisible.current = false;
    setShowLatestButton(false);
    const frame = window.requestAnimationFrame(() => {
      const element = scroller.current;
      if (!element) return;
      element.scrollTop = 0;
      previousScrollTop.current = 0;
      const hasMore = element.scrollHeight - element.clientHeight > 1;
      latestButtonVisible.current = hasMore;
      setShowLatestButton(hasMore);
      if (outlineScroller.current) outlineScroller.current.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollToFirstRequest]);

  useEffect(() => () => {
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
    if (outlineScrollFrame.current !== null) window.cancelAnimationFrame(outlineScrollFrame.current);
  }, []);

  // Cache message positions between layout changes. Reading every message's bounds on every
  // animation frame forces layout work into the wheel animation, even in an idle conversation.
  useEffect(() => { messageOffsets.current = null; }, [visible, tools]);
  const firstVisibleId = visible[0]?.id;
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { messageOffsets.current = null; });
    observer.observe(element);
    element.querySelectorAll(".message").forEach((message) => observer.observe(message));
    return () => observer.disconnect();
  }, [firstVisibleId, visible.length]);

  const updateScrollPosition = (): void => {
    const element = scroller.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    const movingUp = element.scrollTop < previousScrollTop.current;
    previousScrollTop.current = element.scrollTop;
    stickToBottom.current = atBottom && !movingUp;
    const nextLatestButtonVisible = !atBottom;
    if (latestButtonVisible.current !== nextLatestButtonVisible) {
      latestButtonVisible.current = nextLatestButtonVisible;
      setShowLatestButton(nextLatestButtonVisible);
    }

    const offsets = messageOffsets.current ??= Array.from(
      element.querySelectorAll<HTMLElement>(".message-user[data-message-id]"),
      (message) => ({ id: message.dataset.messageId!, top: message.offsetTop }),
    );
    const threshold = element.scrollTop + 96;
    let current: string | null = null;
    for (const message of offsets) {
      if (message.top > threshold) break;
      current = message.id;
    }
    if (current && current !== activeMessageId) setActiveMessageId(current);
  };

  const handleScroll = (): void => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      updateScrollPosition();
    });
  };

  const scrollToLatest = (): void => {
    const element = scroller.current;
    if (!element) return;
    const latestUserMessage = userMessages[userMessages.length - 1]?.message;
    if (latestUserMessage) setActiveMessageId(latestUserMessage.id);
    const outline = outlineScroller.current;
    if (outline) outline.scrollTo({ top: outline.scrollHeight, behavior: "smooth" });
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
          <div className="message-outline-window">
            <div
              ref={outlineScroller}
              onScroll={() => {
                updateOutlineEdges();
                setHoverPreview(null);
                if (outlineScrollFrame.current === null) {
                  outlineScrollFrame.current = window.requestAnimationFrame(() => {
                    outlineScrollFrame.current = null;
                    setOutlineScrollTop(outlineScroller.current?.scrollTop ?? 0);
                  });
                }
              }}
              data-more-above={outlineEdges.up}
              data-more-below={outlineEdges.down}
              className={`message-outline-track${
                userMessages.length > OUTLINE_MAX_VISIBLE ? " message-outline-track-dense" : ""
              }`}
            >
              {outlineVirtualized && <div style={{ height: outlineStart * OUTLINE_ITEM_STEP, marginBottom: -12, flex: "0 0 auto" }} />}
              {visibleUserMessages.map(({ message, index }, offset) => {
                const outlineIndex = outlineStart + offset;
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
              {outlineVirtualized && <div style={{ height: Math.max(0, (userMessages.length - outlineEnd) * OUTLINE_ITEM_STEP), marginTop: -12, flex: "0 0 auto" }} />}
            </div>
            {outlineEdges.up && (
              <button type="button" className="message-outline-scroll message-outline-scroll-up"
                aria-label="向上浏览用户消息" title="向上浏览用户消息"
                onClick={() => outlineScroller.current?.scrollBy({ top: -81, behavior: "smooth" })}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
              </button>
            )}
            {outlineEdges.down && (
              <button type="button" className="message-outline-scroll message-outline-scroll-down"
                aria-label="向下浏览用户消息" title="向下浏览用户消息"
                onClick={() => outlineScroller.current?.scrollBy({ top: 81, behavior: "smooth" })}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
              </button>
            )}
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
            fileReferences={files}
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
            <ThinkingIcon />
            <span className="thinking-label">
              正在连接服务<AnimatedEllipsis className="thinking-ellipsis" />
            </span>
          </div>
        )}
      </div>
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
  );
}

interface MessageViewProps {
  message: ChatMessage;
  fileReferences: readonly string[];
  previousAssistantModel: string | null | undefined;
  tools: Record<string, ToolState>;
  /** Stable references for the tool calls owned by this message. */
  toolStates: readonly (ToolState | undefined)[];
  thinkingLabel: string | null;
}

interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage?: string;
}

/** Pi persists an explicit `/skill:name` invocation as an XML-wrapped skill document. */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = /^<skill name="([^"]+)" location="([^"]+)">\r?\n([\s\S]*?)\r?\n<\/skill>(?:\r?\n\r?\n([\s\S]+))?$/.exec(text);
  if (!match) return null;
  return {
    name: match[1] ?? "",
    location: match[2] ?? "",
    content: match[3] ?? "",
    userMessage: match[4]?.trim() || undefined,
  };
}

function findSkillInvocation(blocks: Block[]): {
  block: Extract<Block, { kind: "text" }>;
  skill: ParsedSkillBlock;
} | null {
  const block = blocks.find((candidate): candidate is Extract<Block, { kind: "text" }> => candidate.kind === "text");
  if (!block) return null;
  const skill = parseSkillBlock(block.text);
  return skill ? { block, skill } : null;
}

function MessageView({ message, fileReferences, previousAssistantModel, tools, thinkingLabel }: MessageViewProps): JSX.Element {
  const showModel = message.role === "assistant" && message.model && message.model !== previousAssistantModel;
  const skillInvocation = message.role === "user" ? findSkillInvocation(message.blocks) : null;
  const contextualText = message.role === "user" && !skillInvocation ? findEditorContext(message.blocks) : null;
  const userText = message.role === "user"
    ? message.blocks
      .filter((block): block is Extract<Block, { kind: "text" }> => block.kind === "text")
      .map((block) => {
        if (skillInvocation && block === skillInvocation.block) return skillInvocation.skill.userMessage ?? "";
        return contextualText && block === contextualText.block ? contextualText.prompt : block.text;
      })
      .join("\n\n")
    : "";
  const showUserBody = message.role !== "user" || !contextualText || contextualText.prompt.length > 0 ||
    message.blocks.some((block) => block !== contextualText.block);

  return (
    <article className={`message message-${message.role}${contextualText ? " message-user-with-context" : ""}`} data-message-id={message.id}>
      {contextualText && <EditorContextView context={contextualText.context} />}
      {showUserBody && <div className={message.role === "user"
        ? `message-user-content${contextualText ? " message-user-body" : ""}` : undefined}>
        {message.blocks.map((block, index) => {
          if (contextualText && block === contextualText.block && contextualText.prompt.length === 0) return null;
          if (skillInvocation && block === skillInvocation.block) {
            return (
              <Fragment key={index}>
                <SkillInvocationView skill={skillInvocation.skill} fileReferences={fileReferences} />
                {skillInvocation.skill.userMessage && (
                  <BlockView
                    block={{ kind: "text", text: skillInvocation.skill.userMessage }}
                    fileReferences={fileReferences}
                    tools={tools}
                    streaming={message.streaming}
                    thinkingLabel={thinkingLabel}
                    durationMs={message.durationMs}
                  />
                )}
              </Fragment>
            );
          }
          return (
            <BlockView
              key={index}
              block={contextualText && block === contextualText.block
                ? { ...block, text: contextualText.prompt }
                : block}
              fileReferences={fileReferences}
              tools={tools}
              streaming={message.streaming}
              thinkingLabel={thinkingLabel}
              durationMs={message.durationMs}
            />
          );
        })}
        {userText && <CopyButton className="message-user-copy" text={userText} title="复制用户消息" iconOnly />}
      </div>}
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

function SkillInvocationView({ skill, fileReferences }: { skill: ParsedSkillBlock; fileReferences: readonly string[] }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="skill-invocation"
      open={expanded}
    >
      <summary
        aria-label={`Skill ${skill.name}`}
        onClick={(event) => {
          // React flushes this state update before the browser's native <details> toggle. Stop
          // that default action so it cannot immediately toggle the controlled state back.
          event.preventDefault();
          setExpanded((current) => !current);
        }}
      >
        <span className="skill-invocation-label">[skill]</span>
        <span className="skill-invocation-name">{skill.name}</span>
        <span className="skill-invocation-hint">({expanded ? "click to collapse" : "click to expand"})</span>
      </summary>
      {expanded && (
        <div className="skill-invocation-content">
          <Markdown text={skill.content} streaming={false} fileReferences={fileReferences} />
        </div>
      )}
    </details>
  );
}

interface EditorContext {
  path: string;
  startLine: number;
  endLine: number | null;
  buffer: boolean;
  selection: string;
}

function findEditorContext(blocks: Block[]): { block: Extract<Block, { kind: "text" }>; context: EditorContext; prompt: string } | null {
  const block = blocks.find((candidate): candidate is Extract<Block, { kind: "text" }> => candidate.kind === "text");
  if (!block) return null;
  const header = /^--- (.+):(\d+)(?:-(\d+))?( \(buffer\))? ---\r?\n/.exec(block.text);
  if (!header) return null;

  const remainder = block.text.slice(header[0].length);
  const separator = /\r?\n\r?\n/.exec(remainder);
  if (!separator || separator.index === undefined) {
    // Saved-file context has no selection text or follow-up prompt, so the payload ends
    // immediately after the header's newline. Render it as a file chip instead of Markdown.
    if (remainder.trim().length > 0) return null;
    return {
      block,
      context: {
        path: header[1] ?? "",
        startLine: Number(header[2]),
        endLine: header[3] ? Number(header[3]) : null,
        buffer: Boolean(header[4]),
        selection: "",
      },
      prompt: "",
    };
  }
  return {
    block,
    context: {
      path: header[1] ?? "",
      startLine: Number(header[2]),
      endLine: header[3] ? Number(header[3]) : null,
      buffer: Boolean(header[4]),
      selection: remainder.slice(0, separator.index).trim(),
    },
    prompt: remainder.slice(separator.index + separator[0].length),
  };
}

function EditorContextView({ context }: { context: EditorContext }): JSX.Element {
  const line = context.endLine && context.endLine !== context.startLine
    ? `${context.startLine}-${context.endLine}`
    : String(context.startLine);
  const rangeLabel = context.endLine && context.endLine !== context.startLine
    ? `lines ${context.startLine}-${context.endLine}`
    : `line ${context.startLine}`;
  return (
    <button
      type="button"
      className="message-editor-context"
      aria-label={`Open ${context.path} and select ${rangeLabel}`}
      title={`Open ${context.path}:${line} and select ${rangeLabel}`}
      onClick={() => post({
        type: "open_path",
        path: context.path,
        line: context.startLine,
        endLine: context.endLine ?? context.startLine,
      })}
    >
      <div className="message-editor-context-heading">
        <span className="message-editor-context-icon" aria-hidden="true">⌁</span>
        <span className="message-editor-context-path" title={context.path}>{context.path}</span>
        <span className="message-editor-context-line">:{line}</span>
        {context.buffer && <span className="message-editor-context-buffer">buffer</span>}
      </div>
      {context.selection && <pre className="message-editor-context-selection">{context.selection}</pre>}
    </button>
  );
}

function messagePreview(message: ChatMessage): string {
  const text = message.blocks
    .filter((block): block is Extract<Block, { kind: "text" }> => block.kind === "text")
    .map((block) => {
      const skill = parseSkillBlock(block.text);
      return skill ? `[skill] ${skill.name}${skill.userMessage ? ` ${skill.userMessage}` : ""}` : block.text;
    })
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
    previous.fileReferences !== next.fileReferences ||
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
  fileReferences: readonly string[];
  tools: Record<string, ToolState>;
  streaming: boolean;
  thinkingLabel: string | null;
  durationMs?: number;
}

function BlockView({ block, fileReferences, tools, streaming, thinkingLabel, durationMs }: BlockProps): JSX.Element | null {
  switch (block.kind) {
    case "text": {
      if (!/<\/?thinking\b/i.test(block.text)) {
        return <Markdown text={block.text} streaming={streaming} fileReferences={fileReferences} />;
      }
      return (
        <>
          {normalizeTaggedBlocks([block]).map((nestedBlock, index) => (
            <BlockView
              key={index}
              block={nestedBlock}
              fileReferences={fileReferences}
              tools={tools}
              streaming={streaming}
              thinkingLabel={thinkingLabel}
              durationMs={durationMs}
            />
          ))}
        </>
      );
    }
    case "thinking": {
      const thinkingActive = streaming && block.completed !== true;
      const defaultLabel = block.redacted ? "思考内容已隐藏" : (thinkingActive ? "正在思考" : "已思考");
      return (
        <details className="thinking">
          <summary>
            <ThinkingIcon />
            <span className="thinking-label">
              {thinkingLabel ?? defaultLabel}
              {thinkingActive && <AnimatedEllipsis className="thinking-ellipsis" />}
              {!thinkingActive && !thinkingLabel && !block.redacted && durationMs !== undefined && (
                <span className="thinking-duration">（用时 {formatThinkingDuration(durationMs)}）</span>
              )}
            </span>
          </summary>
          <pre>{block.text}</pre>
        </details>
      );
    }
    case "tool":
      return <ToolCard name={block.name} callId={block.callId} tool={tools[block.callId]} tools={tools} />;
    case "image":
      return (
        <ImagePreview
          className="image"
          alt="Image"
          src={`data:${block.mimeType};base64,${block.data}`}
        />
      );
    default:
      return null;
  }
}

function ThinkingIcon(): JSX.Element {
  return (
    <svg className="thinking-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <ellipse cx="12" cy="12" rx="4.25" ry="10" transform="rotate(45 12 12)" />
      <ellipse cx="12" cy="12" rx="4.25" ry="10" transform="rotate(-45 12 12)" />
      <ellipse cx="12" cy="12" rx="4.25" ry="10" />
    </svg>
  );
}

function formatThinkingDuration(durationMs: number): string {
  return `${Math.max(0, Math.round(durationMs / 1000))} 秒`;
}
