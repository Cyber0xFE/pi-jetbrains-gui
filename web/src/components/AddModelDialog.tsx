import { useEffect, useRef, useState } from "react";

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
export function AddModelDialog({ knownProviders, onSave, onClose }: Props): JSX.Element {
  const [draft, setDraft] = useState<CustomModelDraft>(DEFAULT_DRAFT);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      contextWindow: Number(draft.contextWindow) || 0,
      maxTokens: Number(draft.maxTokens) || 0,
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
        aria-label="Add model"
        onKeyDown={onKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <header className="picker-head">
          <h2 className="picker-title">Add model</h2>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="add-model-grid">
          <label className="add-model-field">
            <span>Provider</span>
            <input
              ref={inputRef}
              value={draft.provider}
              placeholder="e.g. my-provider"
              spellCheck={false}
              onChange={(event) => update("provider", event.target.value)}
            />
          </label>
          <label className="add-model-field">
            <span>API</span>
            <select value={draft.api} onChange={(event) => update("api", event.target.value)}>
              {API_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="add-model-field add-model-field-wide">
            <span>Base URL{isNewProvider ? "" : " (existing providers keep theirs)"}</span>
            <input
              value={draft.baseUrl}
              placeholder={isNewProvider ? "https://api.example.com/v1" : "optional"}
              spellCheck={false}
              onChange={(event) => update("baseUrl", event.target.value)}
            />
          </label>
          <label className="add-model-field add-model-field-wide">
            <span>API key (only set when missing; never overwritten)</span>
            <input
              type="password"
              value={draft.apiKey}
              placeholder="optional"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => update("apiKey", event.target.value)}
            />
          </label>
          <label className="add-model-field">
            <span>Model ID</span>
            <input
              value={draft.modelId}
              placeholder="e.g. my-model-v1"
              spellCheck={false}
              onChange={(event) => update("modelId", event.target.value)}
            />
          </label>
          <label className="add-model-field">
            <span>Display name</span>
            <input
              value={draft.name}
              placeholder="optional"
              spellCheck={false}
              onChange={(event) => update("name", event.target.value)}
            />
          </label>
          <label className="add-model-field">
            <span>Context window (tokens)</span>
            <input
              type="number"
              min={0}
              value={draft.contextWindow || ""}
              placeholder="optional"
              onChange={(event) => update("contextWindow", Number(event.target.value) || 0)}
            />
          </label>
          <label className="add-model-field">
            <span>Max output tokens</span>
            <input
              type="number"
              min={0}
              value={draft.maxTokens || ""}
              placeholder="optional"
              onChange={(event) => update("maxTokens", Number(event.target.value) || 0)}
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
            <span>thinking (reasoning)</span>
          </label>
          <span className="add-model-check">
            <span>input:</span>
            <label>
              <input
                type="checkbox"
                aria-label="input: text"
                checked={draft.input.includes("text")}
                onChange={() => toggleInput("text")}
              />
              <span>text</span>
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
          <span className="picker-count">appended to ~/.pi/agent/models.json; existing config is kept</span>
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={!valid}>
            Save model
          </button>
        </footer>
      </form>
    </div>
  );
}
