import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useSmoothWheelScroll } from "../scroll";
import { useI18n } from "../i18n";

export interface PickerItem {
  key: string;
  label: string;
  detail?: string;
  badge?: string;
  active?: boolean;
  default?: boolean;
  disabled?: boolean;
  /** Tree rows are flattened with a depth; the picker indents them instead of nesting. */
  depth?: number;
  /** Optional trailing rename affordance (session list); stop propagation so the row is not selected. */
  onRename?: () => void;
  /**
   * Optional trailing delete affordance (session list); the first click swaps it for an inline
   * confirmation button and only the second click calls this. Stops propagation so the row is
   * not selected.
   */
  onDelete?: () => void;
  /** Optional trailing action shown when the row is hovered; stop propagation so the row is not selected. */
  onAction?: () => void;
  actionLabel?: string;
}

interface Props {
  title: string;
  items: PickerItem[];
  placeholder?: string;
  emptyText?: string;
  /** Extra buttons rendered next to Close (e.g. "New session"). */
  actions?: JSX.Element | null;
  /** Where the list scrolls when the item set changes (tree opens at the latest entry). */
  scrollPosition?: "top" | "bottom";
  onSelect: (item: PickerItem) => void;
  onClose: () => void;
}

const ROW_HEIGHT = 34;
const VIEWPORT_HEIGHT = 324;
const OVERSCAN = 4;

/**
 * Searchable, virtualized picker used by every M3 selector (plan M3.4 requires virtual scrolling:
 * `get_available_models` can return thousands of rows).
 *
 * The overlay closes on Escape, the backdrop click, or after a selection.
 */
export function Picker({ title, items, placeholder, emptyText, actions, scrollPosition = "top", onSelect, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [selected, setSelected] = useState(0);
  /** Row whose delete button is awaiting a second confirming click. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollFrame = useRef<number | null>(null);
  const pendingScrollTop = useRef(0);
  useSmoothWheelScroll(listRef);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.label} ${item.detail ?? ""} ${item.badge ?? ""}`.toLowerCase().includes(needle));
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelected(firstEnabled(filtered));
    setScrollTop(0);
    setConfirmDelete(null);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    const bottom = scrollPosition === "bottom" && list ? Math.max(0, list.scrollHeight - list.clientHeight) : 0;
    setSelected(scrollPosition === "bottom" ? lastEnabled(filtered) : firstEnabled(filtered));
    setScrollTop(bottom);
    setConfirmDelete(null);
    if (list) list.scrollTop = bottom;
  }, [scrollPosition, items]);

  useEffect(() => {
    rowRefs.current[selected]?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    return () => {
      if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
    };
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(filtered.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const visible = filtered.slice(start, end);

  const choose = (item: PickerItem | undefined): void => {
    if (!item || item.disabled) return;
    setConfirmDelete(null);
    onSelect(item);
  };

  const move = (delta: number): void => {
    if (filtered.length === 0) return;
    let index = selected;
    for (let step = 0; step < filtered.length; step++) {
      index = (index + delta + filtered.length) % filtered.length;
      const candidate = filtered[index];
      if (candidate && !candidate.disabled) break;
    }
    setSelected(index);
  };

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="picker" role="dialog" aria-label={title}>
        <header className="picker-head">
          <h2 className="picker-title">{title}</h2>
          <button type="button" className="picker-close" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        </header>
        <input
          ref={inputRef}
          className="picker-search"
          value={query}
          placeholder={placeholder ?? t("filter")}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(filtered[selected]);
            }
          }}
        />
        <div
          className="picker-list"
          ref={listRef}
          style={{ height: VIEWPORT_HEIGHT }}
          onScroll={(event) => {
            pendingScrollTop.current = event.currentTarget.scrollTop;
            if (scrollFrame.current !== null) return;
            scrollFrame.current = window.requestAnimationFrame(() => {
              scrollFrame.current = null;
              setScrollTop(pendingScrollTop.current);
            });
          }}
          role="listbox"
          aria-label={title}
        >
          {filtered.length === 0 && <div className="picker-empty">{emptyText ?? t("nothingToShow")}</div>}
          <div style={{ height: start * ROW_HEIGHT }} />
          {visible.map((item, offset) => {
            const index = start + offset;
            return (
              <button
                key={item.key}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={`picker-row ${index === selected ? "picker-row-selected" : ""} ${item.active ? "picker-row-active" : ""}`}
                style={{ height: ROW_HEIGHT, paddingLeft: 10 + (item.depth ?? 0) * 14 }}
                disabled={item.disabled}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(item)}
              >
                <span className="picker-marker">{item.active ? "●" : ""}</span>
                <span className="picker-label">{item.label}</span>
                {(item.badge || item.default || item.detail) && (
                  <span className="picker-meta">
                    {item.badge && <span className="picker-badge">{item.badge}</span>}
                    {item.default && <span className="picker-default">{t("default")}</span>}
                    {item.detail && <span className="picker-detail">{item.detail}</span>}
                  </span>
                )}
                {item.onAction && (
                  <span
                    className="picker-action"
                    role="button"
                    tabIndex={0}
                    aria-label={item.actionLabel ?? t("setAsDefault")}
                    title={item.actionLabel ?? t("setAsDefault")}
                    onClick={(event) => {
                      event.stopPropagation();
                      item.onAction?.();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                        event.preventDefault();
                        item.onAction?.();
                      }
                    }}
                  >
                    {item.actionLabel ?? "Set as default"}
                  </span>
                )}
                {item.onRename && (
                  <span
                    className="picker-rename"
                    role="button"
                    tabIndex={0}
                    aria-label={t("rename")}
                    title={t("renameSession")}
                    onClick={(event) => {
                      event.stopPropagation();
                      item.onRename?.();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                        event.preventDefault();
                        item.onRename?.();
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="m4 16.5-.7 3.2 3.2-.7L18.7 6.8a2.2 2.2 0 0 0-3.1-3.1L3.4 15.9M14.4 5.6l4 4" />
                    </svg>
                  </span>
                )}
                {item.onDelete &&
                  (confirmDelete === item.key ? (
                    // The confirming button replaces the icon in place, so the second click is
                    // aimed at the same spot and cannot be a stray click elsewhere on the row.
                    <span
                      className="picker-delete picker-delete-confirm"
                      role="button"
                      tabIndex={0}
                      aria-label={t("confirmDelete")}
                      title={t("confirmDelete")}
                      onMouseLeave={() => setConfirmDelete(null)}
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDelete(null);
                        item.onDelete?.();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          event.preventDefault();
                          setConfirmDelete(null);
                        } else if (event.key === "Enter" || event.key === " ") {
                          event.stopPropagation();
                          event.preventDefault();
                          setConfirmDelete(null);
                          item.onDelete?.();
                        }
                      }}
                    >
                      {t("confirmDeleteText")}
                    </span>
                  ) : (
                    <span
                      className="picker-delete"
                      role="button"
                      tabIndex={0}
                      aria-label={t("deleteSession")}
                      title={t("deleteSession")}
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDelete(item.key);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.stopPropagation();
                          event.preventDefault();
                          setConfirmDelete(item.key);
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h8l1-13M10 11v5m4-5v5" />
                      </svg>
                    </span>
                  ))}
              </button>
            );
          })}
          <div style={{ height: Math.max(0, (filtered.length - end) * ROW_HEIGHT) }} />
        </div>
        <footer className="picker-footer">
          <span className="picker-count">{t("itemCount", { count: filtered.length })}</span>
          {actions}
        </footer>
      </div>
    </div>
  );
}

function firstEnabled(items: PickerItem[]): number {
  const index = items.findIndex((item) => !item.disabled);
  return index < 0 ? 0 : index;
}

function lastEnabled(items: PickerItem[]): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (!items[index]?.disabled) return index;
  }
  return 0;
}
