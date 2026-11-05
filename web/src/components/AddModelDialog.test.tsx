import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddModelDialog, type CustomModelDraft } from "./AddModelDialog";

function fill(draft: Partial<CustomModelDraft>): void {
  if (draft.provider !== undefined) fireEvent.change(screen.getByLabelText(/Provider/), { target: { value: draft.provider } });
  if (draft.modelId !== undefined) fireEvent.change(screen.getByLabelText(/Model ID/), { target: { value: draft.modelId } });
  if (draft.baseUrl !== undefined) fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: draft.baseUrl } });
  if (draft.apiKey !== undefined) fireEvent.change(screen.getByLabelText(/API key/), { target: { value: draft.apiKey } });
  if (draft.name !== undefined) fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: draft.name } });
  if (draft.contextWindow !== undefined) fireEvent.change(screen.getByLabelText(/Context window/), { target: { value: String(draft.contextWindow) } });
  if (draft.maxTokens !== undefined) fireEvent.change(screen.getByLabelText(/Max output tokens/), { target: { value: String(draft.maxTokens) } });
  if (draft.reasoning !== undefined) fireEvent.click(screen.getByLabelText(/thinking/));
  if (draft.input) {
    for (const modality of ["text", "image"]) {
      fireEvent.click(screen.getByLabelText(`input: ${modality}`));
    }
  }
}

afterEach(() => cleanup());

describe("AddModelDialog", () => {
  it("disables save until provider and model id are present", () => {
    render(<AddModelDialog knownProviders={["agent-plan"]} onSave={() => {}} onClose={() => {}} />);
    expect((screen.getByText("Save model") as HTMLButtonElement).disabled).toBe(true);

    fill({ provider: "agent-plan", modelId: "glm-6" });
    expect((screen.getByText("Save model") as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires a base url only for a new provider", () => {
    render(<AddModelDialog knownProviders={["agent-plan"]} onSave={() => {}} onClose={() => {}} />);

    fill({ provider: "new-provider", modelId: "m1" });
    expect((screen.getByText("Save model") as HTMLButtonElement).disabled).toBe(true);

    fill({ baseUrl: "https://api.example.com/v1" });
    expect((screen.getByText("Save model") as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits a trimmed draft with optional fields normalized", () => {
    const onSave = vi.fn();
    render(<AddModelDialog knownProviders={[]} onSave={onSave} onClose={() => {}} />);

    fill({
      provider: "  my-provider  ",
      modelId: " my-model ",
      baseUrl: " https://api.example.com/v1 ",
      apiKey: " sk-test ",
      name: " My Model ",
      contextWindow: 524288,
      maxTokens: 128000,
      reasoning: true,
      input: ["image"],
    });
    fireEvent.click(screen.getByText("Save model"));

    expect(onSave).toHaveBeenCalledWith({
      provider: "my-provider",
      api: "openai-completions",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelId: "my-model",
      name: "My Model",
      contextWindow: 524288,
      maxTokens: 128000,
      reasoning: true,
      input: ["image"],
    });
  });

  it("closes on Escape without saving", () => {
    const onClose = vi.fn();
    render(<AddModelDialog knownProviders={[]} onSave={() => {}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText(/Provider/), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click without saving", () => {
    const onClose = vi.fn();
    const { container } = render(<AddModelDialog knownProviders={[]} onSave={() => {}} onClose={onClose} />);
    fireEvent.mouseDown(container.querySelector(".overlay") as Element, { target: container.querySelector(".overlay") });
    expect(onClose).toHaveBeenCalled();
  });
});
