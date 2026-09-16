import OpenCC from "opencc-js";

const convertToTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

export function toTraditionalChinese(text: string): string {
  return convertToTraditional(text);
}
