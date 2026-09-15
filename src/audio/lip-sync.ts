export type Viseme = "none" | "aa" | "ih" | "ou" | "ee" | "oh";

export class LipSyncAnalyzer {
  private readonly analyser: AnalyserNode;
  private readonly frequencyData: Uint8Array<ArrayBuffer>;
  private readonly timeData: Uint8Array<ArrayBuffer>;
  private currentWeight = 0;
  private currentViseme: Viseme = "none";
  private lastEmit = 0;

  constructor(analyser: AnalyserNode) {
    this.analyser = analyser;
    this.frequencyData = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    this.timeData = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
  }

  update(now = performance.now()): { viseme: Viseme; weight: number; rms: number } {
    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeData);
    let sum = 0;
    for (const sample of this.timeData) { const value = (sample - 128) / 128; sum += value * value; }
    const rms = Math.sqrt(sum / Math.max(1, this.timeData.length));
    const low = this.average(2, 11);
    const mid = this.average(11, 34);
    const high = this.average(34, 105);
    const active = rms > .012;
    const viseme: Viseme = active ? classifyViseme(low, mid, high) : "none";
    const target = active ? Math.min(1, Math.max(0, (rms - .012) * 4.6)) : 0;
    this.currentWeight += (target - this.currentWeight) * (target > this.currentWeight ? .38 : .18);
    if (this.currentWeight < .012) { this.currentWeight = 0; this.currentViseme = "none"; }
    else this.currentViseme = viseme;
    this.lastEmit = now;
    return { viseme: this.currentViseme, weight: this.currentWeight, rms };
  }

  private average(start: number, end: number): number {
    const lower = Math.min(start, this.frequencyData.length);
    const upper = Math.min(end, this.frequencyData.length);
    if (upper <= lower) return 0;
    let sum = 0;
    for (let index = lower; index < upper; index += 1) sum += this.frequencyData[index] / 255;
    return sum / (upper - lower);
  }
}

function classifyViseme(low: number, mid: number, high: number): Viseme {
  if (low > mid * 1.16 && low > high * 1.12) return "aa";
  if (high > low * 1.22 && high > mid * 1.06) return "ih";
  if (mid > low * 1.16 && mid > high * 1.08) return "ou";
  if (high >= mid) return "ee";
  return "oh";
}
