import { useCallback, useMemo, useState } from "react";
import { formatWhen } from "../format";
import type { SessionSummary, TreeEntry } from "../types";
import { Picker, type PickerItem } from "./Picker";

interface Props {
  sessions: SessionSummary[];
  tree: TreeEntry[];
  leafId: string | null;
  loading: boolean;
  initialTab?: Tab;
  onClose: () => void;
  onNewSession: () => void;
  onRename: (name: string, path?: string) => void;
  onRefresh: () => void;
  onSwitch: (path: string, sessionId?: string) => void;
  onDelete: (path: string) => void;
  onFork: (entryId: string, images: TreeEntry["images"]) => void;
}

type Tab = "sessions" | "tree";

/**
 * One dialog for the session list and the fork tree (plan M3.2 / M3.3). Sessions select via
 * `switch_session`; tree rows collapse to one row per user message, clicking a row expands the
 * assistant/tool rows underneath, and the row's hover button calls `fork` with its entry id.
 */
export function SessionDialog({
  sessions,
  tree,
  leafId,
  loading,
  initialTab = "sessions",
  onClose,
  onNewSession,
  onRename,
  onRefresh,
  onSwitch,
  onDelete,
  onFork,
}: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);

  const openRename = useCallback((session: SessionSummary): void => {
    setRenameTarget(session);
    setRenameValue(session.name?.trim() ?? "");
    setRenameOpen(true);
  }, []);

  const sessionItems = useMemo<PickerItem[]>(
    () =>
      sessions.map((session) => ({
        key: session.path,
        label: session.name?.trim() || session.firstMessage?.trim() || session.id,
        detail: `${session.messageCount} messages · ${formatWhen(session.modified)}`,
        badge: session.current ? "current" : undefined,
        active: session.current,
        onRename: () => openRename(session),
        onDelete: () => onDelete(session.path),
      })),
    [sessions, onDelete, openRename],
  );

  const treeItems = useMemo<PickerItem[]>(() => {
    const byId = new Map(tree.map((entry) => [entry.id, entry]));
    const ownerCache = new Map<string, string | null>();

    // Non-user rows belong to the nearest user message above them; they only show once that
    // row is expanded, which keeps the default view at one row per fork point.
    const userOwnerOf = (id: string): string | null => {
      if (ownerCache.has(id)) return ownerCache.get(id) ?? null;
      const seen = new Set<string>();
      let current = byId.get(id)?.parentId ?? null;
      while (current && !seen.has(current)) {
        seen.add(current);
        const ancestor = byId.get(current);
        if (!ancestor) {
          current = null;
          break;
        }
        if (isUserRow(ancestor)) break;
        current = ancestor.parentId ?? null;
      }
      const owner = current && byId.has(current) ? current : null;
      ownerCache.set(id, owner);
      return owner;
    };

    const hiddenRows = new Map<string, TreeEntry[]>();
    for (const entry of tree) {
      if (isUserRow(entry)) continue;
      const owner = userOwnerOf(entry.id);
      if (!owner) continue;
      const owned = hiddenRows.get(owner);
      if (owned) owned.push(entry);
      else hiddenRows.set(owner, [entry]);
    }

    const items: PickerItem[] = [];
    for (const entry of tree) {
      if (!isUserRow(entry)) continue;
      items.push(treeItem(entry, leafId, onFork));
      if (!expanded.has(entry.id)) continue;
      // Revealed rows sit directly under their fork point, ahead of later branches.
      for (const hidden of hiddenRows.get(entry.id) ?? []) items.push(treeItem(hidden, leafId, onFork));
    }
    return items;
  }, [tree, leafId, onFork, expanded]);

  const items = tab === "sessions" ? sessionItems : treeItems;
  const submitRename = (): void => {
    const name = renameValue.trim();
    if (!name || !renameTarget) return;
    onRename(name, renameTarget.current ? undefined : renameTarget.path);
    setRenameOpen(false);
    setRenameTarget(null);
  };

  return (
    <>
    <Picker
      title={tab === "sessions" ? "Sessions" : "Session tree"}
      items={items}
      scrollPosition={tab === "tree" ? "bottom" : "top"}
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
            className={`button button-secondary button-icon ${tab === "sessions" ? "button-tab-active" : ""}`}
            onClick={() => setTab("sessions")}
            aria-label="Sessions"
            title="Sessions"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
            </svg>
          </button>
          <button
            type="button"
            className={`button button-secondary button-icon ${tab === "tree" ? "button-tab-active" : ""}`}
            onClick={() => setTab("tree")}
            aria-label="Session tree"
            title="Session tree"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 3v12" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="6" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </button>
          <button
            type="button"
            className="button button-secondary button-icon"
            onClick={onRefresh}
            aria-label="Refresh"
            title="Refresh"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
            </svg>
          </button>
          <button
            type="button"
            className="button button-icon"
            onClick={onNewSession}
            aria-label="New session"
            title="New session"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </>
      }
      onSelect={(item) => {
        if (tab === "sessions") {
          const session = sessions.find((candidate) => candidate.path === item.key);
          onSwitch(item.key, session?.id);
        } else {
          // Clicking a user message expands/collapses it; forking only happens via the
          // hover button so a mis-click on the row cannot fork the session.
          const entry = tree.find((candidate) => candidate.id === item.key);
          if (!entry || !isUserRow(entry)) return;
          setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(entry.id)) next.delete(entry.id);
            else next.add(entry.id);
            return next;
          });
        }
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
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setRenameOpen(false);
                setRenameTarget(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="button" disabled={!renameValue.trim() || !renameTarget}>
              Save
            </button>
          </footer>
        </form>
      </div>
    )}
    </>
  );
}

function isUserRow(entry: TreeEntry): boolean {
  return entry.type === "message" && entry.role === "user";
}

/**
 * Rows keep their depth; fork points expose a hover-only "fork from here" button, and clicking
 * a user message row expands or collapses the entries hidden underneath it.
 */
function treeItem(
  entry: TreeEntry,
  leafId: string | null,
  onFork: (entryId: string, images: TreeEntry["images"]) => void,
): PickerItem {
  return {
    key: entry.id,
    label: entry.label?.trim() || entry.text || `[${entry.type}]`,
    badge: entry.active ? "active" : undefined,
    active: entry.active || entry.id === leafId,
    disabled: !entry.forkable,
    depth: entry.depth,
    onAction: entry.forkable ? () => onFork(entry.id, entry.images) : undefined,
    actionLabel: entry.forkable ? "fork from here" : undefined,
  };
}
