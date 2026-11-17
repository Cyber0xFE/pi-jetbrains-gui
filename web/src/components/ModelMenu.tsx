import { useEffect, useMemo, useRef, useState } from "react";
import { formatTokens } from "../format";
import { useSmoothWheelScroll } from "../scroll";
import type { ModelInfo } from "../types";

interface Props {
  models: ModelInfo[];
  /** pi is running, so an empty list means "loading" instead of "not running". */
  ready: boolean;
  activeProvider?: string | null;
  activeModel?: string | null;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  onSelect: (model: ModelInfo) => void;
  onSetDefault: (model: ModelInfo) => void;
  onAddModel: () => void;
}

interface GroupRow {
  kind: "group";
  key: string;
  label: string;
  count: number;
}

interface ModelRow {
  kind: "model";
  key: string;
  model: ModelInfo;
  label: string;
  detail: string | null;
  active: boolean;
  isDefault: boolean;
}

type Row = GroupRow | ModelRow;

const ROW_HEIGHT = 32;
const VIEWPORT_HEIGHT = 300;
const OVERSCAN = 4;

/**
 * Model picker rendered as a small popup above the footer entry, grouped by provider (the same
 * shape as pi's TUI model list). `get_available_models` can return thousands of rows, so the
 * list stays virtualized like the full Picker overlay.
 */
export function ModelMenu({
  models,
  ready,
  activeProvider,
  activeModel,
  defaultProvider,
  defaultModel,
  onSelect,
  onSetDefault,
  onAddModel,
}: Props): JSX.Element {
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useSmoothWheelScroll(listRef);

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    const groups = new Map<string, ModelInfo[]>();
    for (const model of models) {
      const haystack = `${model.name ?? ""} ${model.id} ${model.provider ?? ""}`.toLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      const provider = model.provider?.trim() || "other";
      const entries = groups.get(provider);
      if (entries) entries.push(model);
      else groups.set(provider, [model]);
    }
    const result: Row[] = [];
    for (const [provider, entries] of groups) {
      result.push({ kind: "group", key: `group:${provider}`, label: provider, count: entries.length });
      for (const model of entries) {
        result.push({
          kind: "model",
          key: `${model.provider ?? ""}/${model.id}`,
          model,
          label: model.name?.trim() || model.id,
          detail: (() => {
            const name = model.name?.trim();
            const showId = Boolean(name) && name !== model.id;
            return [showId ? model.id : null, model.contextWindow ? `${formatTokens(model.contextWindow)} ctx` : null]
              .filter(Boolean)
              .join(" · ") || null;
          })(),
          active: model.provider === activeProvider && model.id === activeModel,
          isDefault: model.provider === defaultProvider && model.id === defaultModel,
        });
      }
    }
    return result;
  }, [models, query, activeProvider, activeModel, defaultProvider, defaultModel]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const height = Math.min(VIEWPORT_HEIGHT, Math.max(ROW_HEIGHT, rows.length * ROW_HEIGHT));
    const activeIndex = rows.findIndex((row) => row.kind === "model" && row.active);
    const index = activeIndex >= 0 && query.trim() === "" ? activeIndex : firstModelIndex(rows);
    // Center the active row in the popup; the list virtualizes from `scrollTop`, so the offset is
    // re-applied after the frame that renders the matching window of rows.
    const target = Math.max(0, index * ROW_HEIGHT - Math.floor(height / 2) + ROW_HEIGHT);
    setSelected(index);
    setScrollTop(target);
    const list = listRef.current;
    if (list) {
      list.scrollTop = target;
      window.requestAnimationFrame(() => {
        list.scrollTop = target;
      });
    }
  }, [rows]);

  useEffect(() => {
    rowRefs.current[selected]?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  // Keep the popup flush with its content: few models mean a short list, many models scroll.
  const listHeight = Math.min(VIEWPORT_HEIGHT, Math.max(ROW_HEIGHT, rows.length * ROW_HEIGHT));
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + listHeight) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(start, end);

  const move = (delta: number): void => {
    if (rows.length === 0) return;
    let index = selected;
    for (let step = 0; step < rows.length; step++) {
      index = (index + delta + rows.length) % rows.length;
      if (rows[index]?.kind === "model") break;
    }
    setSelected(index);
  };

  return (
    <div className="model-menu" role="dialog" aria-label="Models">
      <input
        ref={inputRef}
        className="model-menu-search"
        value={query}
        placeholder="Search models…"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const row = rows[selected];
            if (row?.kind === "model") onSelect(row.model);
          }
        }}
      />
      <div
        className="model-menu-list"
        ref={listRef}
        style={{ height: listHeight }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        role="listbox"
        aria-label="Models"
      >
        {rows.length === 0 && (
          <div className="model-menu-empty">{ready ? "loading models…" : "pi is not running"}</div>
        )}
        <div style={{ height: start * ROW_HEIGHT }} />
        {visible.map((row, offset) => {
          const index = start + offset;
          if (row.kind === "group") {
            return (
              <div key={row.key} className="model-menu-group" style={{ height: ROW_HEIGHT }}>
                {row.label}
              </div>
            );
          }
          return (
            <button
              key={row.key}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={row.active}
              className={`model-menu-row ${index === selected ? "model-menu-row-selected" : ""} ${row.active ? "model-menu-row-active" : ""} ${row.isDefault ? "model-menu-row-default" : ""}`}
              style={{ height: ROW_HEIGHT }}
              onMouseEnter={() => setSelected(index)}
              onClick={() => onSelect(row.model)}
            >
              <span className="model-menu-name">{row.label}</span>
              {row.model.reasoning ? <span className="model-menu-badge">thinking</span> : null}
              {row.detail ? <span className="model-menu-detail">{row.detail}</span> : null}
              {/* Floating so idle rows do not reserve an empty strip on the right. */}
              <span className="model-menu-actions">
                {row.isDefault ? (
                  <span className="model-menu-default">default</span>
                ) : (
                  <span
                    className="model-menu-default-action"
                    role="button"
                    tabIndex={0}
                    aria-label="Set as default"
                    title="Set as default"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetDefault(row.model);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.stopPropagation();
                      event.preventDefault();
                      onSetDefault(row.model);
                    }}
                  >
                    Set as default
                  </span>
                )}
                {row.active && (
                  <svg className="model-menu-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="m5 13 5 5L20 7" />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
        <div style={{ height: Math.max(0, (rows.length - end) * ROW_HEIGHT) }} />
      </div>
      <footer className="model-menu-footer">
        <button type="button" className="model-menu-add" onClick={onAddModel}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add model
        </button>
        <span className="model-menu-count">{models.length} model(s)</span>
      </footer>
    </div>
  );
}

function firstModelIndex(rows: Row[]): number {
  const index = rows.findIndex((row) => row.kind === "model");
  return index < 0 ? 0 : index;
}
