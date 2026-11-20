import { useEffect, useRef, useState, type JSX } from "react";
import { useI18n } from "../i18n";

/** Parse a token count that may use a "k" suffix (e.g. "4k", "1.5K") into an absolute count. */
function parseTokenCount(raw: string): number {
  const text = raw.trim();
  if (text === "") return 0;
  const kMatch = /^(\d+(?:\.\d+)?)\s*[kK]$/.exec(text);
  if (kMatch) return Math.round(parseFloat(kMatch[1]!) * 1000);
  const count = Number(text);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export interface CustomModelDraft {
  provider: string;
  api: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: string[];
}

interface Props {
  /** Providers already present in the model list; used to hint whether the provider is new. */
  knownProviders: string[];
  /** When set, the dialog edits that existing custom model instead of adding a new one. */
  initial?: CustomModelDraft | null;
  onSave: (draft: CustomModelDraft) => void;
  onClose: () => void;
}

/** API names accepted by pi's models.json provider config. */
const API_OPTIONS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "bedrock-converse-stream",
];

const DEFAULT_DRAFT: CustomModelDraft = {
  provider: "",
  api: "openai-completions",
  baseUrl: "",
  apiKey: "",
  modelId: "",
  name: "",
  contextWindow: 0,
  maxTokens: 0,
  reasoning: false,
  input: ["text"],
};

/**
 * Form dialog behind the "Add model" action of the Models picker. Submitting posts
 * `save_custom_model`; the host appends the entry to ~/.pi/agent/models.json without
 * touching existing configuration.
 */
export function AddModelDialog({ knownProviders, initial = null, onSave, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const editing = initial !== null;
  const [draft, setDraft] = useState<CustomModelDraft>(initial ?? DEFAULT_DRAFT);
  const [contextWindowText, setContextWindowText] = useState(
    initial && initial.contextWindow > 0 ? String(initial.contextWindow) : "",
  );
  const [maxTokensText, setMaxTokensText] = useState(
    initial && initial.maxTokens > 0 ? String(initial.maxTokens) : "",
  );
  const [providerOpen, setProviderOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const providerWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close the provider dropdown when clicking outside of it (JCEF has no native datalist popup).
  useEffect(() => {
    if (!providerOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      if (!providerWrapRef.current?.contains(event.target as Node)) setProviderOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [providerOpen]);

  const provider = draft.provider.trim();
  const modelId = draft.modelId.trim();
  const isNewProvider = provider.length > 0 && !knownProviders.includes(provider);
  const valid =
    provider.length > 0 &&
    modelId.length > 0 &&
    // A brand-new provider needs somewhere to send requests.
    (!isNewProvider || draft.baseUrl.trim().length > 0);

  const update = <K extends keyof CustomModelDraft>(key: K, value: CustomModelDraft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }));

  const providerOptions = knownProviders.filter((provider) =>
    provider.toLowerCase().includes(draft.provider.trim().toLowerCase()),
  );

  const toggleInput = (modality: string): void =>
    setDraft((current) => ({
      ...current,
      input: current.input.includes(modality)
        ? current.input.filter((candidate) => candidate !== modality)
        : [...current.input, modality],
    }));

  const submit = (): void => {
    if (!valid) return;
    onSave({
      ...draft,
      provider,
      modelId,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      name: draft.name.trim(),
      contextWindow: parseTokenCount(contextWindowText),
      maxTokens: parseTokenCount(maxTokensText),
    });
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="overlay overlay-front" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        className="picker rename-dialog add-model-dialog"
        role="dialog"
        aria-label={t("addModelDialog")}
        onKeyDown={onKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <header className="picker-head">
          <h2 className="picker-title">{editing ? t("editModelDialog") : t("addModelDialog")}</h2>
          <button type="button" className="picker-close" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        </header>
        <div className="add-model-grid">
          <label className="add-model-field">
            <span>{t("provider")}</span>
            <div className="provider-combobox" ref={providerWrapRef}>
              <input
                ref={inputRef}
                value={draft.provider}
                placeholder={editing ? undefined : t("providerPlaceholder")}
                spellCheck={false}
                disabled={editing}
                onChange={(event) => {
                  update("provider", event.target.value);
                  setProviderOpen(true);
                }}
                onFocus={() => setProviderOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && providerOpen && providerOptions.length > 0) {
                    event.stopPropagation();
                    setProviderOpen(false);
                  }
                }}
              />
              {providerOpen && !editing && providerOptions.length > 0 && (
                <div className="provider-combobox-list" role="listbox">
                  {providerOptions.map((provider) => (
                    <button
                      type="button"
                      key={provider}
                      role="option"
                      className="provider-combobox-option"
                      onClick={() => {
                        update("provider", provider);
                        setProviderOpen(false);
                      }}
                    >
                      {provider}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </label>
          <label className="add-model-field">
            <span>{t("api")}</span>
            <select value={draft.api} onChange={(event) => update("api", event.target.value)}>
              {API_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="add-model-field add-model-field-wide">
            <span>{t("baseUrl")}{isNewProvider ? "" : t("existingProvidersKeepTheirs")}</span>
            <input
              value={draft.baseUrl}
              placeholder={isNewProvider ? "https://api.example.com/v1" : "optional"}
              spellCheck={false}
              onChange={(event) => update("baseUrl", event.target.value)}
            />
          </label>
          <label className="add-model-field add-model-field-wide">
            <span>{t("apiKey")}</span>
            <input
              type="password"
              value={draft.apiKey}
              placeholder={editing ? t("keepExistingKey") : "optional"}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => update("apiKey", event.target.value)}
            />
          </label>
          <label className="add-model-field">
            <span>{t("modelId")}</span>
            <input
              value={draft.modelId}
              placeholder="e.g. my-model-v1"
              spellCheck={false}
              disabled={editing}
              onChange={(event) => update("modelId", event.target.value)}
            />
          </label>
          <label className="add-model-field">
            <span>{t("displayName")}</span>
            <input
              value={draft.name}
              placeholder="optional"
              spellCheck={false}
              onChange={(event) => update("name", event.target.value)}
            />
          </label>
          <label className="add-model-field">
            <span>{t("contextWindow")}</span>
            <input
              type="text"
              inputMode="numeric"
              value={contextWindowText}
              placeholder="optional, e.g. 128k"
              spellCheck={false}
              onChange={(event) => setContextWindowText(event.target.value)}
            />
          </label>
          <label className="add-model-field">
            <span>{t("maxOutputTokens")}</span>
            <input
              type="text"
              inputMode="numeric"
              value={maxTokensText}
              placeholder="optional, e.g. 8k"
              spellCheck={false}
              onChange={(event) => setMaxTokensText(event.target.value)}
            />
          </label>
        </div>
        <div className="add-model-checks">
          <label className="add-model-check">
            <input
              type="checkbox"
              checked={draft.reasoning}
              onChange={(event) => update("reasoning", event.target.checked)}
            />
            <span>{t("reasoning")}</span>
          </label>
          <span className="add-model-check">
            <span>{t("input")}</span>
            <label>
              <input
                type="checkbox"
                aria-label={`${t("input")} ${t("text")}`}
                checked={draft.input.includes("text")}
                onChange={() => toggleInput("text")}
              />
              <span>{t("text")}</span>
            </label>
            <label>
              <input
                type="checkbox"
                aria-label="input: image"
                checked={draft.input.includes("image")}
                onChange={() => toggleInput("image")}
              />
              <span>image</span>
            </label>
          </span>
        </div>
        <footer className="picker-footer">
          <span className="picker-count">{editing ? t("modelConfigUpdated") : t("modelConfigKept")}</span>
          <button type="button" className="button button-secondary" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="button" disabled={!valid}>
            {t("saveModel")}
          </button>
        </footer>
      </form>
    </div>
  );
}
