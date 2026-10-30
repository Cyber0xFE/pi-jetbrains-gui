import { initialState, reduce, type Action, type ChatState } from "./state/sessionReducer";

/**
 * Holds the transcript and coalesces inbound actions into one React render per animation frame
 * (plan 5.4 "渲染节流" / 7.5 layer 3).
 */
export class ChatStore {
  private state: ChatState = initialState;
  private readonly listeners = new Set<() => void>();
  private queued: Action[] = [];
  private frame: number | null = null;

  getSnapshot = (): ChatState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch(action: Action): void {
    this.queued.push(action);
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.frame = null;
    const actions = this.queued;
    this.queued = [];
    if (actions.length === 0) return;

    let next = this.state;
    for (const action of actions) next = reduce(next, action);
    if (next === this.state) return;

    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
