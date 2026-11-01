import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PromptImage } from "./types";
import { onMessage, post } from "./bridge";
import { recordPerf } from "./perfLog";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { Picker, type PickerItem } from "./components/Picker";
import { SessionDialog } from "./components/SessionDialog";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { formatTokens } from "./format";
import { ChatStore } from "./store";
import type { Block } from "./state/sessionReducer";

type Dialog = "sessions" | "models" | "thinking" | null;
type SessionDialogTab = "sessions" | "tree";

export function App(): JSX.Element {
  const store = useMemo(() => new ChatStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [draft, setDraft] = useState("");
  const [focusDraftRequest, setFocusDraftRequest] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sessionDialogTab, setSessionDialogTab] = useState<SessionDialogTab>("sessions");
  const [images, setImages] = useState<PromptImage[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState(false);
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
        setFocusDraftRequest((current) => current + 1);
        return;
      }
      if (message.type === "focus_composer") {
        setFocusDraftRequest((current) => current + 1);
        return;
      }
      store.dispatch({ kind: "inbound", message });
    });
    post({ type: "ready" });
    return () => {
      if (pendingPromptTimer.current !== null) window.clearTimeout(pendingPromptTimer.current);
    };
  }, [store]);

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
    // The IDE editor font can be large (for example 24px), but using it as the base
    // size makes the whole chat UI feel oversized. Keep the chat readable without
    // allowing tool cards and the composer to balloon vertically.
    root.style.setProperty("--fs", `${Math.max(12, Math.min(16, theme.fontSize))}px`);
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

  const send = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0 && images.length === 0) return;
    if (pendingPromptTimer.current !== null) window.clearTimeout(pendingPromptTimer.current);
    pendingPromptStartedAt.current = Date.now();
    setPendingPrompt(true);
    store.dispatch({ kind: "submit" });
    setDraft("");
    setImages([]);
    // Let React paint the optimistic indicator before entering the native bridge. The bridge
    // can synchronously start the request, which otherwise consumes this event before the
    // browser gets a repaint opportunity.
    window.requestAnimationFrame(() => {
      post({ type: "prompt", message: text, images: images.length > 0 ? images : undefined });
    });
  }, [draft, images, store]);

  const abort = useCallback(() => post({ type: "abort" }), []);

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
        onNewSession={() => post({ type: "new_session" })}
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
      />
      <Composer
        value={draft}
        onChange={setDraft}
        focusRequest={focusDraftRequest}
        onSend={send}
        disabled={!ready || state.sending}
        busy={busy || Boolean(state.status.isStreaming || state.status.isCompacting)}
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
          onSwitch={(path) => {
            post({ type: "switch_session", path });
            closeDialog();
          }}
          onDelete={(path) => {
            post({ type: "delete_session", path });
          }}
          onFork={(entryId) => {
            post({ type: "fork", entryId });
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
          onClose={closeDialog}
          onSelect={(item) => {
            const model = state.models.find((candidate) => `${candidate.provider ?? ""}/${candidate.id}` === item.key);
            if (!model) return;
            post({ type: "set_model", provider: model.provider ?? "", modelId: model.id });
            closeDialog();
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
