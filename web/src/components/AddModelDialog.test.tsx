import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("accepts k-unit input for token counts", () => {
    const onSave = vi.fn();
    render(<AddModelDialog knownProviders={[]} onSave={onSave} onClose={() => {}} />);

    fill({ provider: "p", modelId: "m", baseUrl: "https://api.example.com/v1", contextWindow: 524288, maxTokens: 128000 });
    fireEvent.change(screen.getByLabelText(/Context window/), { target: { value: "128k" } });
    fireEvent.change(screen.getByLabelText(/Max output tokens/), { target: { value: "1.5K" } });
    fireEvent.click(screen.getByText("Save model"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ contextWindow: 128000, maxTokens: 1500 }),
    );
  });

  it("edits an existing custom model with locked identity and prefilled fields", () => {
    const onSave = vi.fn();
    render(
      <AddModelDialog
        knownProviders={["agent-plan"]}
        initial={{
          provider: "agent-plan",
          api: "openai-completions",
          baseUrl: "https://api.example.com/v1",
          apiKey: "",
          modelId: "glm-6",
          name: "GLM 6",
          contextWindow: 524288,
          maxTokens: 128000,
          reasoning: true,
          input: ["text", "image"],
        }}
        onSave={onSave}
        onClose={() => {}}
      />,
    );

    const providerInput = screen.getByLabelText(/Provider/) as HTMLInputElement;
    const modelIdInput = screen.getByLabelText(/Model ID/) as HTMLInputElement;
    expect(providerInput.disabled).toBe(true);
    expect(modelIdInput.disabled).toBe(true);
    expect((screen.getByLabelText(/Display name/) as HTMLInputElement).value).toBe("GLM 6");
    expect((screen.getByLabelText(/Context window/) as HTMLInputElement).value).toBe("524288");

    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "GLM 6 Pro" } });
    fireEvent.click(screen.getByText("Save model"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "agent-plan",
        modelId: "glm-6",
        name: "GLM 6 Pro",
        contextWindow: 524288,
        maxTokens: 128000,
        reasoning: true,
        input: ["text", "image"],
      }),
    );
  });

  it("lists existing providers in a dropdown and still accepts a new one", () => {
    render(<AddModelDialog knownProviders={["agent-plan", "openai"]} onSave={() => {}} onClose={() => {}} />);

    const providerInput = screen.getByLabelText(/Provider/) as HTMLInputElement;
    fireEvent.focus(providerInput);
    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["agent-plan", "openai"]);

    fireEvent.click(options[1]!);
    expect(providerInput.value).toBe("openai");

    // Typing filters the list; a brand-new provider can still be entered directly.
    fireEvent.change(providerInput, { target: { value: "my-new-provider" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(providerInput.value).toBe("my-new-provider");
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
