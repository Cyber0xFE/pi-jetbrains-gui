import { useMemo, useState } from "react";
import { formatWhen } from "../format";
import type { SessionSummary, TreeEntry } from "../types";
import { Picker, type PickerItem } from "./Picker";

interface Props {
  sessions: SessionSummary[];
  tree: TreeEntry[];
  leafId: string | null;
  loading: boolean;
  onClose: () => void;
  onNewSession: () => void;
  onRename: (name: string) => void;
  onRefresh: () => void;
  onSwitch: (path: string) => void;
  onDelete: (path: string) => void;
  onFork: (entryId: string) => void;
}

type Tab = "sessions" | "tree";

/**
 * One dialog for the session list and the fork tree (plan M3.2 / M3.3). Sessions select via
 * `switch_session`; forkable tree rows (user messages) call `fork` with their entry id.
 */
export function SessionDialog({
  sessions,
  tree,
  leafId,
  loading,
  onClose,
  onNewSession,
  onRename,
  onRefresh,
  onSwitch,
  onDelete,
  onFork,
}: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>("sessions");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const sessionItems = useMemo<PickerItem[]>(
    () =>
      sessions.map((session) => ({
        key: session.path,
        label: session.name?.trim() || session.firstMessage?.trim() || session.id,
        detail: `${session.messageCount} messages · ${formatWhen(session.modified)}`,
        badge: session.current ? "current" : undefined,
        active: session.current,
        onDelete: () => onDelete(session.path),
      })),
    [sessions, onDelete],
  );

  const treeItems = useMemo<PickerItem[]>(
    () =>
      tree.map((entry) => ({
        key: entry.id,
        label: entry.label?.trim() || entry.text || `[${entry.type}]`,
        detail: entry.forkable ? "fork from here" : `${entry.type}${entry.role ? `/${entry.role}` : ""}`,
        badge: entry.active ? "active" : undefined,
        active: entry.active || entry.id === leafId,
        disabled: !entry.forkable,
        depth: entry.depth,
      })),
    [tree, leafId],
  );

  const items = tab === "sessions" ? sessionItems : treeItems;
  const currentSession = sessions.find((session) => session.current);

  const openRename = (): void => {
    setRenameValue(currentSession?.name?.trim() ?? "");
    setRenameOpen(true);
  };

  const submitRename = (): void => {
    const name = renameValue.trim();
    if (!name) return;
    onRename(name);
    setRenameOpen(false);
  };

  return (
    <>
    <Picker
      title={tab === "sessions" ? "Sessions" : "Session tree"}
      items={items}
      placeholder={tab === "sessions" ? "Filter sessions…" : "Filter entries…"}
      emptyText={
        loading
          ? "loading sessions…"
          : tab === "sessions"
            ? "No sessions in this project folder yet"
            : "This session has no entries yet"
      }
      actions={
        <>
          <button
            type="button"
            className={`button button-secondary ${tab === "sessions" ? "button-tab-active" : ""}`}
            onClick={() => setTab("sessions")}
          >
            Sessions
          </button>
          <button
            type="button"
            className={`button button-secondary ${tab === "tree" ? "button-tab-active" : ""}`}
            onClick={() => setTab("tree")}
          >
            Tree
          </button>
          <button type="button" className="button button-secondary" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="button button-secondary" onClick={openRename} disabled={!currentSession}>
            Rename
          </button>
          <button type="button" className="button" onClick={onNewSession}>
            New session
          </button>
        </>
      }
      onSelect={(item) => {
        if (tab === "sessions") onSwitch(item.key);
        else onFork(item.key);
      }}
      onClose={onClose}
    />
    {renameOpen && (
      <div className="overlay overlay-front" role="presentation">
        <form
          className="rename-dialog"
          role="dialog"
          aria-label="Rename session"
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
        >
          <h2 className="picker-title">Rename session</h2>
          <input
            autoFocus
            className="picker-search rename-input"
            value={renameValue}
            maxLength={120}
            placeholder="Session title"
            onChange={(event) => setRenameValue(event.target.value)}
          />
          <div className="rename-hint">A title makes this session easier to find later.</div>
          <footer className="picker-footer">
            <button type="button" className="button button-secondary" onClick={() => setRenameOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="button" disabled={!renameValue.trim()}>
              Save
            </button>
          </footer>
        </form>
      </div>
    )}
    </>
  );
}
