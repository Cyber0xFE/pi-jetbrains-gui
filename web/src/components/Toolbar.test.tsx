import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "./Toolbar";

afterEach(cleanup);

describe("Toolbar", () => {
  it("keeps the session picker without a new-session button", () => {
    const onOpenSessions = vi.fn();
    render(
      <Toolbar
        status={{ phase: "running", message: "ready" }}
        disabled={false}
        onOpenSessions={onOpenSessions}
      />,
    );

    expect(screen.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    const sessionButton = screen.getByRole("button", { name: "未命名会话" });
    expect(sessionButton.querySelector(".toolbar-session-chevron")).not.toBeNull();

    fireEvent.click(sessionButton);
    expect(onOpenSessions).toHaveBeenCalledTimes(1);
  });
});
