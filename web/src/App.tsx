import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PromptImage } from "./types";
import { onMessage, post } from "./bridge";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { Picker, type PickerItem } from "./components/Picker";
import { SessionDialog } from "./components/SessionDialog";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { formatTokens } from "./format";
import { ChatStore } from "./store";

type Dialog = "sessions" | "models" | "thinking" | null;

export function App(): JSX.Element {
  const store = useMemo(() => new ChatStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [images, setImages] = useState<PromptImage[]>([]);

  useEffect(() => {
    onMessage((message) => {
      // `prefill` seeds the composer (fork returns the original user message text).
      if (message.type === "prefill") {
        setDraft(message.text);
        return;
      }
      store.dispatch({ kind: "inbound", message });
    });
    post({ type: "ready" });
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
    root.style.setProperty("--fs", `${Math.max(11, Math.min(24, theme.fontSize))}px`);
  }, [state.theme]);

  const phase = state.status.phase;

  // Pickers are cheap to refresh, but only meaningful while pi answers commands.
  useEffect(() => {
    if (phase !== "running") return;
    post({ type: "get_commands" });
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
    post({ type: "prompt", message: text, images: images.length > 0 ? images : undefined });
    store.dispatch({ kind: "submit" });
    setDraft("");
    setImages([]);
  }, [draft, images, store]);

  const abort = useCallback(() => post({ type: "abort" }), []);

  const openSessions = useCallback(() => {
    post({ type: "list_sessions" });
    post({ type: "get_tree" });
    setDialog("sessions");
  }, []);

  const closeDialog = useCallback(() => setDialog(null), []);

  const modelItems = useMemo<PickerItem[]>(
    () =>
      state.models.map((model) => ({
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
      })),
    [state.models, state.status.provider, state.status.model],
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
        modelCount={state.models.length}
        sessionFallback={state.sessions.find((session) => session.current)?.firstMessage}
        onOpenSessions={openSessions}
        onOpenModels={() => {
          post({ type: "get_models" });
          setDialog("models");
        }}
        onOpenThinking={() => {
          post({ type: "get_thinking_levels" });
          setDialog("thinking");
        }}
        onNewSession={() => post({ type: "new_session" })}
        onCompact={() => post({ type: "compact" })}
        onToggleAutoCompaction={() =>
          post({ type: "set_auto_compaction", enabled: state.status.autoCompaction === false })
        }
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
        messages={state.messages}
        tools={state.tools}
        loadingHistory={state.historyLoading}
        emptyHint={ready ? "Ask pi about this project…" : state.status.message}
        thinkingLabel={state.thinkingLabel}
      />
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        disabled={!ready || state.sending}
        busy={busy}
        commands={state.commands}
        pendingContext={state.status.pendingContext}
        onClearContext={() => post({ type: "clear_context" })}
        images={images}
        onAddImage={(image) => setImages((current) => [...current, image].slice(-4))}
        onRemoveImage={(index) => setImages((current) => current.filter((_, imageIndex) => imageIndex !== index))}
      />
      {Object.values(state.widgets).filter((widget) => widget.placement === "belowEditor").map((widget, index) => (
        <div className="extension-widget" key={`below:${index}`}>{widget.lines.map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}</div>
      ))}
      <StatusBar
        status={state.status}
        busy={state.busy}
        cacheHitRate={state.cacheHitRate}
        extensionStatuses={state.extensionStatuses}
        onSend={send}
        onAbort={abort}
        canSend={ready && !state.sending && (draft.trim().length > 0 || images.length > 0)}
      />

      {dialog === "sessions" && (
        <SessionDialog
          sessions={state.sessions}
          tree={state.tree}
          leafId={state.treeLeafId}
          loading={state.sessionsLoading}
          onClose={closeDialog}
          onNewSession={() => {
            post({ type: "new_session" });
            closeDialog();
          }}
          onRename={(name) => {
            post({ type: "rename_session", name });
          }}
          onRefresh={() => {
            post({ type: "list_sessions" });
            post({ type: "get_tree" });
          }}
          onSwitch={(path) => {
            post({ type: "switch_session", path });
            closeDialog();
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
