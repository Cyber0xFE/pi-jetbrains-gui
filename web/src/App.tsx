import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { onMessage, post } from "./bridge";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { StatusBar } from "./components/StatusBar";
import { ChatStore } from "./store";

export function App(): JSX.Element {
  const store = useMemo(() => new ChatStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    onMessage((message) => store.dispatch({ kind: "inbound", message }));
    post({ type: "ready" });
  }, [store]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0) return;
    post({ type: "prompt", message: text });
    store.dispatch({ kind: "submit" });
    setDraft("");
  }, [draft, store]);

  const abort = useCallback(() => post({ type: "abort" }), []);

  const ready = state.status.phase === "running";
  const busy = state.busy || state.sending;
  const needsStart = state.status.phase === "stopped" || state.status.phase === "failed";

  return (
    <div className="app">
      <StatusBar status={state.status} busy={state.busy} />
      {needsStart && (
        <div className="startbar">
          <span className="startbar-message">{state.status.message}</span>
          <button type="button" className="button" onClick={() => post({ type: "start" })} disabled={state.status.phase === "starting"}>
            Start pi
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
      <MessageList
        messages={state.messages}
        tools={state.tools}
        loadingHistory={state.historyLoading}
        emptyHint={ready ? "Ask pi about this project…" : state.status.message}
      />
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        onAbort={abort}
        disabled={!ready || state.sending}
        busy={busy}
      />
    </div>
  );
}
