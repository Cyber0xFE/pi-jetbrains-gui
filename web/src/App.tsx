import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PromptImage } from "./types";
import { onMessage, post } from "./bridge";
import { recordPerf } from "./perfLog";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { Picker, type PickerItem } from "./components/Picker";
import { AddModelDialog } from "./components/AddModelDialog";
import { BtwOverlay } from "./components/BtwOverlay";
import { SessionDialog } from "./components/SessionDialog";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { formatTokens } from "./format";
import { ChatStore } from "./store";
import { EMPTY_SEARCH, selectedSearchSeed, type SearchState } from "./search";
import type { Block } from "./state/sessionReducer";

type Dialog = "sessions" | "models" | "thinking" | null;
type SessionDialogTab = "sessions" | "tree";

/** One queued message taken back from pi for editing, with the queue it came from. */
interface QueuedEntry {
  kind: "steering" | "followUp";
  text: string;
}

/**
 * Re-posts the queue editor's messages. The host sends them one by one and waits for pi to start
 * streaming in between, so they are queued instead of merging into a single run.
 */
/** Editor label for a queued message; matches the wording of the queue bar. */
function queueKindLabel(kind: QueuedEntry["kind"]): string {
  return kind === "steering" ? "steering" : "follow-up";
}

function repostQueue(entries: QueuedEntry[]): void {
  const queued = entries
    .map((entry) => ({ text: entry.text.trim(), kind: entry.kind }))
    .filter((entry) => entry.text.length > 0);
  if (queued.length === 0) return;
  post({ type: "send_queued", queued });
}

export function App(): JSX.Element {
  const store = useMemo(() => new ChatStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [draft, setDraft] = useState("");
  const [focusDraftRequest, setFocusDraftRequest] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [sessionDialogTab, setSessionDialogTab] = useState<SessionDialogTab>("sessions");
  const [images, setImages] = useState<PromptImage[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState(false);
  const [scrollToLatestRequest, setScrollToLatestRequest] = useState(0);
  const [scrollToFirstRequest, setScrollToFirstRequest] = useState(0);
  const [previousUserMessageRequest, setPreviousUserMessageRequest] = useState(0);
  const [nextUserMessageRequest, setNextUserMessageRequest] = useState(0);
  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [btwOpen, setBtwOpen] = useState(false);
  const [btwCollapsed, setBtwCollapsed] = useState(false);
  /** Non-null while queued messages are being edited; they cannot be re-posted one by one otherwise. */
  const [queueEdit, setQueueEdit] = useState<QueuedEntry[] | null>(null);
  /** Snapshot taken when editing started, so Cancel can restore the queues untouched. */
  const queueEditOrigin = useRef<QueuedEntry[]>([]);
  const pendingPromptStartedAt = useRef<number | null>(null);
  const pendingPromptTimer = useRef<number | null>(null);

  useEffect(() => {
    const finishPendingPrompt = (minimumVisible = true): void => {
      if (pendingPromptTimer.current !== null) window.clearTimeout(pendingPromptTimer.current);
      const startedAt = pendingPromptStartedAt.current;
      const remaining =
        minimumVisible && startedAt !== null ? Math.max(0, 250 - (Date.now() - startedAt)) : 0;
      pendingPromptTimer.current = window.setTimeout(() => {
        pendingPromptStartedAt.current = null;
        pendingPromptTimer.current = null;
        setPendingPrompt(false);
      }, remaining);
    };

    onMessage((message) => {
      if (message.type === "records") {
        recordPerf("inbound_records", 0, { records: message.records.length });
      } else if (message.type === "history") {
        recordPerf("inbound_history", 0, { messages: message.messages.length, final: message.final ? 1 : 0 });
      }
      // Keep the optimistic connection hint visible until assistant content actually starts.
      // `agent_start` only means the request was accepted; pi may still spend time preparing
      // the model response after that event.
      if (message.type === "records") {
        const responseStarted = message.records.some(
          (record) =>
            (record.type === "message_start" && record.message?.role === "assistant") ||
            record.type === "message_update",
        );
        const requestFailed = message.records.some(
          (record) => record.type === "response" && record.command === "prompt" && record.success === false,
        );
        if (responseStarted || requestFailed) finishPendingPrompt(!requestFailed);
      }
      if (message.type === "reset") finishPendingPrompt(false);
      // `prefill` seeds the composer (fork returns the original user message text).
      if (message.type === "prefill") {
        setDraft(message.text);
        setImages(message.images ?? []);
        setFocusDraftRequest((current) => current + 1);
        return;
      }
      if (message.type === "dequeue") {
        // The host cleared pi's queues; edit them in place so each message keeps its own
        // steering/follow-up identity instead of being merged into one prompt.
        const entries: QueuedEntry[] = [
          ...message.steering.map((text) => ({ kind: "steering" as const, text })),
          ...message.followUp.map((text) => ({ kind: "followUp" as const, text })),
        ];
        // An empty report (stop with nothing queued) must not close an editor the user has open.
        if (entries.length === 0) return;
        queueEditOrigin.current = entries;
        setQueueEdit(entries);
        return;
      }
      if (message.type === "focus_composer") {
        setFocusDraftRequest((current) => current + 1);
        return;
      }
      if (message.type === "scroll_to_latest") {
        setScrollToLatestRequest((current) => current + 1);
        return;
      }
      if (message.type === "scroll_to_first") {
        setScrollToFirstRequest((current) => current + 1);
        return;
      }
      if (message.type === "scroll_to_user_message") {
        if (message.direction === "previous") setPreviousUserMessageRequest((current) => current + 1);
        else setNextUserMessageRequest((current) => current + 1);
        return;
      }
      if (message.type === "btw") {
        setBtwOpen(true);
        setBtwCollapsed(false);
      }
      store.dispatch({ kind: "inbound", message });
    });
    post({ type: "ready" });
    return () => {
      if (pendingPromptTimer.current !== null) window.clearTimeout(pendingPromptTimer.current);
    };
  }, [store]);

  // Ctrl+F opens the in-transcript find bar. JCEF delivers the shortcut to the page, so this
  // listener owns it instead of the IDE's Find action. Text selected inside a user/assistant
  // message (thinking excluded) seeds the query, like IDE find bars do.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      const seed = selectedSearchSeed(window.getSelection());
      setSearch((current) =>
        seed !== null ? { ...current, open: true, query: seed } : current.open ? current : { ...current, open: true },
      );
      setSearchFocusRequest((current) => current + 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const theme = state.theme;
    if (!theme) return;
    const root = document.documentElement;
    root.style.colorScheme = theme.dark ? "dark" : "light";
    root.style.setProperty("--bg", theme.background);
    root.style.setProperty("--fg", theme.foreground);
    root.style.setProperty("--fg-dim", theme.foregroundDim);
    root.style.setProperty("--bg-raised", theme.raisedBackground);
    root.style.setProperty("--bg-soft", theme.raisedBackground);
    root.style.setProperty("--border", theme.border);
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--error", theme.error);
    root.style.setProperty("--error-bg", theme.errorBackground);
    root.style.setProperty("--fs", `${Math.max(10, Math.min(32, theme.fontSize))}px`);
  }, [state.theme]);

  const phase = state.status.phase;

  // Pickers are cheap to refresh, but only meaningful while pi answers commands.
  useEffect(() => {
    if (phase !== "running") return;
    post({ type: "get_commands" });
    post({ type: "list_files" });
    post({ type: "get_models" });
    post({ type: "get_thinking_levels" });
  }, [phase]);

  useEffect(() => {
    if (phase !== "running") return;
    post({ type: "list_sessions" });
    post({ type: "get_tree" });
  }, [phase, state.status.sessionFile]);

  const send = useCallback(
    (followUp = false) => {
      const text = draft.trim();
      if (text.length === 0 && images.length === 0 && !state.status.pendingContext) return;
      // `/btw` keeps the main transcript untouched: bare `/btw` re-opens the last side question,
      // otherwise the question goes to the host's print-mode runner, never to the session.
      if (text === "/btw") {
        setDraft("");
        setBtwOpen(true);
        return;
      }
      if (text.startsWith("/btw ")) {
        const question = text.slice("/btw ".length).trim();
        setDraft("");
        if (question.length > 0) {
          store.dispatch({ kind: "btwSend", question });
          setBtwOpen(true);
          setBtwCollapsed(false);
          post({ type: "btw", question });
        }
        return;
      }
      if (pendingPromptTimer.current !== null) window.clearTimeout(pendingPromptTimer.current);
      pendingPromptStartedAt.current = Date.now();
      setPendingPrompt(true);
      setScrollToLatestRequest((current) => current + 1);
      store.dispatch({ kind: "submit" });
      setDraft("");
      setImages([]);
      // Like the pi TUI: while streaming, Enter steers and Alt+Enter queues a follow-up.
      const streamingBehavior = state.status.isStreaming ? (followUp ? "followUp" : "steer") : undefined;
      // Let React paint the optimistic indicator before entering the native bridge. The bridge
      // can synchronously start the request, which otherwise consumes this event before the
      // browser gets a repaint opportunity.
      window.requestAnimationFrame(() => {
        post({
          type: "prompt",
          message: text,
          images: images.length > 0 ? images : undefined,
          streamingBehavior,
        });
      });
    },
    [draft, images, state.status.pendingContext, state.status.isStreaming, store],
  );

  const abort = useCallback(() => post({ type: "abort" }), []);

  /** Restores all queued steering/follow-up messages to the composer for editing (TUI Alt+Up). */
  const editQueued = useCallback(() => post({ type: "clear_queue" }), []);

  /** Re-posts the edited queue messages; the host keeps them in order and queues them properly. */
  const submitQueueEdit = useCallback(() => {
    const entries = queueEdit ?? [];
    setQueueEdit(null);
    queueEditOrigin.current = [];
    repostQueue(entries);
  }, [queueEdit]);

  /** Drops the edits and puts the original queue back. */
  const cancelQueueEdit = useCallback(() => {
    const originals = queueEditOrigin.current;
    setQueueEdit(null);
    queueEditOrigin.current = [];
    repostQueue(originals);
  }, []);

  const changeQueuedMessage = useCallback((index: number, text: string) => {
    setQueueEdit((current) => current?.map((entry, i) => (i === index ? { ...entry, text } : entry)) ?? null);
  }, []);

  const removeQueuedMessage = useCallback((index: number) => {
    setQueueEdit((current) => current?.filter((_, i) => i !== index) ?? null);
  }, []);

  const openSessionDialog = useCallback((tab: SessionDialogTab) => {
    post({ type: "list_sessions" });
    post({ type: "get_tree" });
    setSessionDialogTab(tab);
    setDialog("sessions");
  }, []);

  const openSessions = useCallback(() => openSessionDialog("sessions"), [openSessionDialog]);
  const openTree = useCallback(() => openSessionDialog("tree"), [openSessionDialog]);

  const closeDialog = useCallback(() => setDialog(null), []);

  const modelItems = useMemo<PickerItem[]>(
    () => {
      // Older hosts did not include defaultModel fields. During that transition the active
      // model is the only useful fallback, so it remains visibly marked as the default.
      const defaultProvider = state.defaultModelProvider ?? state.status.provider;
      const defaultModel = state.defaultModel ?? state.status.model;
      return state.models.map((model) => {
        const isDefault = model.provider === defaultProvider && model.id === defaultModel;
        return {
          key: `${model.provider ?? ""}/${model.id}`,
          label: model.name?.trim() || model.id,
          detail: [
            model.provider ? `${model.provider}/${model.id}` : model.id,
            model.contextWindow ? `${formatTokens(model.contextWindow)} ctx` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          badge: model.reasoning ? "thinking" : undefined,
          active: model.provider === state.status.provider && model.id === state.status.model,
          default: isDefault,
          onAction: isDefault
            ? undefined
            : () => post({ type: "set_default_model", provider: model.provider ?? "", modelId: model.id }),
          actionLabel: "Set as default",
        };
      });
    },
    [
      state.models,
      state.status.provider,
      state.status.model,
      state.defaultModelProvider,
      state.defaultModel,
    ],
  );

  const thinkingItems = useMemo<PickerItem[]>(
    () =>
      state.thinkingLevels.map((level) => ({
        key: level,
        label: level,
        active: level === state.status.thinkingLevel,
      })),
    [state.thinkingLevels, state.status.thinkingLevel],
  );

  const ready = phase === "running";
  const busy = state.busy || state.sending;
  const needsStart = phase === "stopped" || phase === "failed";
  const retry = state.status.retry ?? null;

  // Toolbar label fallback: the first user message of the live transcript wins so a brand-new
  // session updates the moment the user sends, then falls back to the disk index.
  const sessionFallback = useMemo<string | null>(() => {
    const firstUser = state.messages.find((message) => message.role === "user");
    const text = (firstUser?.blocks ?? [])
      .filter((block): block is Extract<Block, { kind: "text" }> => block.kind === "text")
      .map((block) => block.text)
      .join(" ")
      .trim();
    return text || state.sessions.find((session) => session.current)?.firstMessage?.trim() || null;
  }, [state.messages, state.sessions]);

  return (
    <div className="app">
      {needsStart && (
        <div className="startbar">
          <span className="startbar-message">{state.status.message}</span>
          <button type="button" className="button" onClick={() => post({ type: "start" })}>
            Start pi
          </button>
        </div>
      )}
      <Toolbar
        status={state.status}
        disabled={!ready}
        sessionFallback={sessionFallback}
        onOpenSessions={openSessions}
      />
      {retry && (
        <div className="retrybar">
          <span className="retrybar-message">
            retrying ({retry.attempt}/{retry.maxAttempts}) in {Math.max(1, Math.round(retry.delayMs / 1000))}s
            {retry.errorMessage ? ` — ${retry.errorMessage}` : ""}
          </span>
          <button type="button" className="button button-secondary" onClick={() => post({ type: "abort_retry" })}>
            Abort retry
          </button>
        </div>
      )}
      {state.notices.length > 0 && (
        <div className="notices">
          {state.notices.map((notice) => (
            <div key={notice.id} className={`notice notice-${notice.level}`}>
              <span className="notice-message">{notice.message}</span>
              <button
                type="button"
                className="notice-dismiss"
                onClick={() => store.dispatch({ kind: "dismissNotice", id: notice.id })}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {Object.values(state.widgets).filter((widget) => widget.placement === "aboveEditor").map((widget, index) => (
        <div className="extension-widget" key={`above:${index}`}>{widget.lines.map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}</div>
      ))}
      <MessageList
        key={state.transcriptGeneration}
        messages={state.messages}
        files={state.files}
        tools={state.tools}
        loadingHistory={state.historyLoading}
        emptyHint={ready ? "Ask pi about this project…" : state.status.message}
        thinkingLabel={state.thinkingLabel}
        connecting={pendingPrompt || (state.sending && !state.busy)}
        scrollToLatestRequest={scrollToLatestRequest}
        scrollToFirstRequest={scrollToFirstRequest}
        previousUserMessageRequest={previousUserMessageRequest}
        nextUserMessageRequest={nextUserMessageRequest}
        search={search}
        onSearchChange={setSearch}
        onSearchClose={() => setSearch((current) => ({ ...current, open: false }))}
        searchFocusRequest={searchFocusRequest}
      />
      {queueEdit !== null ? (
        <div className="message-queue message-queue-editing" role="dialog" aria-label="Edit queued messages">
          {queueEdit.map((entry, index) => {
            const label = queueKindLabel(entry.kind);
            return (
              <div className="message-queue-editor-row" key={`${entry.kind}:${index}`}>
                <span className="message-queue-editor-kind">{label}</span>
                <textarea
                  className="message-queue-editor-input"
                  aria-label={`Queued ${label} message ${index + 1}`}
                  value={entry.text}
                  rows={2}
                  onChange={(event) => changeQueuedMessage(index, event.target.value)}
                />
                <button
                  type="button"
                  className="message-queue-remove"
                  onClick={() => removeQueuedMessage(index)}
                  title="Remove"
                  aria-label={`Remove queued ${label} message ${index + 1}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M4 7h16" />
                    <path d="M18 7v12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5V7" />
                    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    <path d="M10 11v5M14 11v5" />
                  </svg>
                </button>
              </div>
            );
          })}
          <div className="message-queue-editor-actions">
            <button type="button" className="message-queue-action" onClick={cancelQueueEdit}>
              Cancel
            </button>
            <button
              type="button"
              className="message-queue-action message-queue-action-primary"
              onClick={submitQueueEdit}
            >
              Send all
            </button>
          </div>
        </div>
      ) : (
        (state.steeringQueue.length > 0 || state.followUpQueue.length > 0) && (
          <div className="message-queue" role="status" aria-label="Queued messages">
            <div className="message-queue-items">
              {state.steeringQueue.map((text, index) => (
                <div className="message-queue-row" key={`steering:${index}`}>
                  <span className="message-queue-label">steering</span>
                  <span className="message-queue-text">{text}</span>
                </div>
              ))}
              {state.followUpQueue.map((text, index) => (
                <div className="message-queue-row" key={`follow-up:${index}`}>
                  <span className="message-queue-label">follow-up</span>
                  <span className="message-queue-text">{text}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="message-queue-edit"
              onClick={editQueued}
              title="Edit queued messages (Alt+Up)"
            >
              ✎ Edit
            </button>
          </div>
        )
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        focusRequest={focusDraftRequest}
        onSend={send}
        disabled={!ready || state.sending}
        busy={busy || Boolean(state.status.isStreaming || state.status.isCompacting)}
        steering={Boolean(state.status.isStreaming)}
        onDequeue={editQueued}
        commands={state.commands}
        files={state.files}
        onCompact={() => post({ type: "compact" })}
        onOpenTree={openTree}
        pendingContext={state.status.pendingContext}
        onClearContext={() => post({ type: "clear_context" })}
        images={images}
        onAddImage={(image) => setImages((current) => [...current, image].slice(-4))}
        onRemoveImage={(index) => setImages((current) => current.filter((_, imageIndex) => imageIndex !== index))}
        onAbort={abort}
      />
      {Object.values(state.widgets).filter((widget) => widget.placement === "belowEditor").map((widget, index) => (
        <div className="extension-widget" key={`below:${index}`}>{widget.lines.map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}</div>
      ))}
      <StatusBar
        status={state.status}
        busy={state.busy}
        disabled={!ready}
        modelCount={state.models.length}
        cacheHitRate={state.cacheHitRate}
        extensionStatuses={state.extensionStatuses}
        onOpenModels={() => {
          post({ type: "get_models" });
          setDialog("models");
        }}
        onOpenThinking={() => {
          post({ type: "get_thinking_levels" });
          setDialog("thinking");
        }}
        onToggleAutoCompaction={() =>
          post({ type: "set_auto_compaction", enabled: state.status.autoCompaction === false })
        }
      />

      {btwOpen && (
        <BtwOverlay
          btw={state.btw}
          collapsed={btwCollapsed}
          onCollapse={() => setBtwCollapsed(true)}
          onExpand={() => setBtwCollapsed(false)}
          onClose={() => {
            setBtwOpen(false);
            setBtwCollapsed(false);
          }}
        />
      )}
      {dialog === "sessions" && (
        <SessionDialog
          sessions={state.sessions}
          tree={state.tree}
          leafId={state.treeLeafId}
          loading={state.sessionsLoading}
          initialTab={sessionDialogTab}
          onClose={closeDialog}
          onNewSession={() => {
            post({ type: "new_session" });
            closeDialog();
          }}
          onRename={(name, path) => {
            post(path ? { type: "rename_session", name, path } : { type: "rename_session", name });
          }}
          onRefresh={() => {
            post({ type: "list_sessions" });
            post({ type: "get_tree" });
          }}
          onSwitch={(path, sessionId) => {
            post({ type: "switch_session", path, sessionId });
            closeDialog();
          }}
          onDelete={(path) => {
            post({ type: "delete_session", path });
          }}
          onFork={(entryId, forkImages) => {
            post({ type: "fork", entryId, images: forkImages });
            closeDialog();
          }}
        />
      )}
      {dialog === "models" && (
        <Picker
          title="Models"
          items={modelItems}
          placeholder="Filter models by name or provider…"
          emptyText={ready ? "loading models…" : "pi is not running"}
          actions={
            <button
              type="button"
              className="button button-icon"
              onClick={() => setAddModelOpen(true)}
              aria-label="Add model"
              title="Add model"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          }
          onClose={closeDialog}
          onSelect={(item) => {
            const model = state.models.find((candidate) => `${candidate.provider ?? ""}/${candidate.id}` === item.key);
            if (!model) return;
            post({ type: "set_model", provider: model.provider ?? "", modelId: model.id });
            closeDialog();
          }}
        />
      )}
      {addModelOpen && (
        <AddModelDialog
          knownProviders={
            Array.from(new Set(state.models.map((model) => model.provider).filter((p): p is string => Boolean(p))))
          }
          onClose={() => setAddModelOpen(false)}
          onSave={(draft) => {
            setAddModelOpen(false);
            post({
              type: "save_custom_model",
              provider: draft.provider,
              api: draft.api,
              baseUrl: draft.baseUrl,
              apiKey: draft.apiKey || undefined,
              modelId: draft.modelId,
              name: draft.name || undefined,
              contextWindow: draft.contextWindow || undefined,
              maxTokens: draft.maxTokens || undefined,
              reasoning: draft.reasoning,
              input: draft.input,
            });
          }}
        />
      )}
      {dialog === "thinking" && (
        <Picker
          title="Thinking level"
          items={thinkingItems}
          placeholder="Filter thinking levels…"
          emptyText={ready ? "this model has no thinking levels" : "pi is not running"}
          onClose={closeDialog}
          onSelect={(item) => {
            post({ type: "set_thinking_level", level: item.key });
            closeDialog();
          }}
        />
      )}
    </div>
  );
}
