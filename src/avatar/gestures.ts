import { Type, type FunctionDeclaration } from "@google/genai";

export const AVATAR_GESTURES = [
  "nod", "shake_head", "wave", "present", "tilt_head",
  "bow", "shrug", "hand_on_chest", "beckon", "salute",
] as const;
export type AvatarGesture = typeof AVATAR_GESTURES[number];

export const AVATAR_GESTURE_TOOL: FunctionDeclaration = {
  name: "play_avatar_gesture",
  description: "依照即將說出的內容選擇一個自然動作：肯定用 nod，否定用 shake_head，招呼或道別用 wave，解釋介紹用 present，疑問思考用 tilt_head，道謝或道歉用 bow，不確定用 shrug，感謝或關心用 hand_on_chest，請對方繼續用 beckon，正式確認用 salute。每個回覆最多一次，沒有適合情境就不呼叫。",
  parameters: {
    type: Type.OBJECT,
    properties: { gesture: { type: Type.STRING, enum: [...AVATAR_GESTURES] } },
    required: ["gesture"],
  },
};

export function normalizeAvatarGesture(args: unknown): { ok: true; gesture: AvatarGesture } | { ok: false; error: string } {
  const gesture = args && typeof args === "object" && !Array.isArray(args)
    ? (args as { gesture?: unknown }).gesture
    : undefined;
  if (!AVATAR_GESTURES.includes(gesture as AvatarGesture)) {
    return { ok: false, error: `請使用支援的 gesture：${AVATAR_GESTURES.join("、")}。` };
  }
  return { ok: true, gesture: gesture as AvatarGesture };
}

const DURATIONS: Record<AvatarGesture, number> = {
  nod: 1.5,
  shake_head: 1.6,
  wave: 2.4,
  present: 2.6,
  tilt_head: 1.8,
  bow: 1.9,
  shrug: 1.6,
  hand_on_chest: 2.2,
  beckon: 2.4,
  salute: 1.9,
};

type Pose = Record<string, [number, number, number]>;
const smooth = (value: number) => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };

function sampleGesture(name: AvatarGesture, time: number): Pose {
  const duration = DURATIONS[name];
  const weight = smooth(time / .35) * smooth((duration - time) / .45);
  const beat = Math.sin(time * Math.PI * 3);
  const offer = smooth((time - .35) / .65) * (1 - smooth((time - 1.65) / .45));
  switch (name) {
    case "nod": return { head: [.16 * beat * weight, 0, 0], neck: [.04 * beat * weight, 0, 0] };
    case "shake_head": return { head: [0, .21 * beat * weight, 0], neck: [0, .05 * beat * weight, 0] };
    case "tilt_head": return { head: [0, -.06 * weight, -.16 * weight], neck: [0, 0, -.04 * weight] };
    case "bow": return { spine: [-.16 * weight, 0, 0], chest: [-.22 * weight, 0, 0], neck: [-.08 * weight, 0, 0], head: [-.12 * weight, 0, 0] };
    case "shrug": return {
      leftShoulder: [0, 0, -.18 * weight], rightShoulder: [0, 0, .18 * weight],
      leftUpperArm: [.15 * weight, .21 * weight, .25 * weight], rightUpperArm: [.15 * weight, -.21 * weight, -.25 * weight],
      leftLowerArm: [0, -2.15 * weight, 0], rightLowerArm: [0, 2.15 * weight, 0],
      leftHand: [1.7 * weight, -.19 * weight, -.19 * weight], rightHand: [1.7 * weight, .19 * weight, .19 * weight],
      head: [-.03 * weight, 0, 0],
    };
    case "hand_on_chest": return { rightUpperArm: [-.38 * weight, .31 * weight, .13 * weight], rightLowerArm: [0, 1.94 * weight, 0], rightHand: [.83 * weight, -.11 * weight, -.88 * weight] };
    case "beckon": {
      const curl = .5 - .5 * Math.cos(Math.max(0, time - .4) * Math.PI * 3);
      const pose: Pose = {
        rightUpperArm: [.2 * weight, 0, -.09 * weight],
        rightLowerArm: [0, (2.1 + .08 * curl) * weight, 0],
        rightHand: [1.82 * weight, -.06 * weight, .19 * weight],
      };
      for (const finger of ["Index", "Middle", "Ring", "Little"]) {
        pose[`right${finger}Proximal`] = [0, 0, -(.1 + .85 * curl) * weight];
        pose[`right${finger}Intermediate`] = [0, 0, -(.1 + .95 * curl) * weight];
        pose[`right${finger}Distal`] = [0, 0, -(.05 + .5 * curl) * weight];
      }
      return pose;
    }
    case "salute": {
      const lift = smooth((time - .1) / .4) * smooth((duration - time) / .45);
      const bend = smooth(time / .24) * smooth((duration - time) / .24);
      return {
        rightUpperArm: [1.56 * lift, 1.13 * lift, -.89 * lift], rightLowerArm: [0, 2.15 * bend, 0],
        rightHand: [.56 * weight, -.32 * weight, -1.08 * weight], rightIndexProximal: [0, -.12 * weight, 0],
        rightRingProximal: [0, .1 * weight, 0], rightLittleProximal: [0, .22 * weight, 0], rightThumbMetacarpal: [0, -.45 * weight, -.15 * weight],
      };
    }
    case "wave": return { rightUpperArm: [0, 0, -.08 * weight], rightLowerArm: [0, 2.7 * weight, (.2 + .1 * beat) * weight], rightHand: [-1.51 * weight, -.28 * weight, .36 * weight] };
    case "present": return { rightUpperArm: [.63 * weight, .25 * weight, -.28 * weight], rightLowerArm: [0, 1.4 * weight, (-.55 + .3 * offer) * weight], rightHand: [1.42 * weight, .86 * weight, .33 * weight] };
  }
}

export class AvatarGesturePlayer {
  private pending: { gesture: AvatarGesture; wait: number; finished: boolean } | null = null;
  private active: { gesture: AvatarGesture; time: number; release?: number } | null = null;

  queue(gesture: AvatarGesture): boolean {
    if (!AVATAR_GESTURES.includes(gesture) || this.pending || this.active) return false;
    this.pending = { gesture, wait: 0, finished: false };
    return true;
  }

  finishTurn(): void { if (this.pending) this.pending.finished = true; }
  reset(immediate = false): void { this.pending = null; if (immediate) this.active = null; else if (this.active && this.active.release === undefined) this.active.release = 0; }

  update(deltaTime: number, playing: boolean): Pose {
    if (this.pending) {
      this.pending.wait += deltaTime;
      if (this.pending.wait > 8 || (this.pending.finished && !playing)) this.pending = null;
      else if (playing) { this.active = { gesture: this.pending.gesture, time: 0 }; this.pending = null; }
    }
    if (!this.active) return {};
    const active = this.active;
    if (!playing && active.release === undefined) active.release = 0;
    if (active.release !== undefined) active.release += deltaTime;
    else active.time += deltaTime;
    if (active.time >= DURATIONS[active.gesture] || (active.release ?? 0) >= .25) { this.active = null; return {}; }
    const pose = sampleGesture(active.gesture, active.time);
    const fade = active.release === undefined ? 1 : 1 - smooth(active.release / .25);
    for (const angles of Object.values(pose)) for (let index = 0; index < 3; index += 1) angles[index] *= fade;
    return pose;
  }
}
