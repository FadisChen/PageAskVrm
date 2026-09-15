export const AVATAR_STATES = ["idle", "listening", "thinking", "speaking", "interrupted"] as const;
export type AvatarState = typeof AVATAR_STATES[number];

export class AvatarStateMachine {
  state: AvatarState = "idle";

  set(next: AvatarState): void { this.state = next; }
  toListening(): void { this.state = "listening"; }
  toThinking(): void { if (this.state === "idle" || this.state === "listening") this.state = "thinking"; }
  toSpeaking(): void { if (this.state === "thinking" || this.state === "listening") this.state = "speaking"; }
  toIdle(): void { this.state = "idle"; }
}
