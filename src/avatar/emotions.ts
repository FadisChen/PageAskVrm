import { Type, type FunctionDeclaration } from "@google/genai";

export const AVATAR_EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised"] as const;
export type AvatarEmotion = typeof AVATAR_EMOTIONS[number];

export const AVATAR_EMOTION_TOOL: FunctionDeclaration = {
  name: "set_avatar_emotion",
  description: "只有在回覆需要明顯表情或情緒轉折時選擇一個表情。每個回覆最多呼叫一次；不需要時不要呼叫。",
  parameters: {
    type: Type.OBJECT,
    properties: {
      emotion: { type: Type.STRING, enum: [...AVATAR_EMOTIONS], description: "回覆的主要表情。" },
    },
    required: ["emotion"],
  },
};

export function normalizeAvatarEmotion(args: unknown): { ok: true; emotion: AvatarEmotion } | { ok: false; error: string } {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: "set_avatar_emotion 需要 object 參數。" };
  }
  const emotion = (args as { emotion?: unknown }).emotion;
  if (!AVATAR_EMOTIONS.includes(emotion as AvatarEmotion)) {
    return { ok: false, error: `不支援的 emotion：${String(emotion ?? "")}。` };
  }
  return { ok: true, emotion: emotion as AvatarEmotion };
}
