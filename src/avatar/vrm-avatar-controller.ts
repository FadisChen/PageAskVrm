import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { AVATAR_EMOTIONS, type AvatarEmotion } from "./emotions";
import { AvatarGesturePlayer, type AvatarGesture } from "./gestures";
import { type AvatarState } from "./state-machine";

type AvatarCallbacks = {
  onLoading?: (progress: number) => void;
  onReady?: (expressionNames: string[]) => void;
  onError?: (error: Error) => void;
};

type BoneMap = Record<string, THREE.Object3D | null>;
type ExpressionManager = {
  expressionMap?: Record<string, unknown>;
  getExpression?: (name: string) => unknown;
  setValue?: (name: string, value: number) => void;
};
type LoadedVrm = {
  scene: THREE.Object3D;
  humanoid?: { getNormalizedBoneNode?: (name: string) => THREE.Object3D | null; getRawBoneNode?: (name: string) => THREE.Object3D | null };
  expressionManager?: ExpressionManager;
  update?: (deltaTime: number) => void;
};

const NATURAL_ARM_DROP = 1.25;
const PLACEMENT_YAW = THREE.MathUtils.degToRad(15);
const SHA_MOUTH_INTENSITY = .45;
const EXPRESSION_ALIASES: Record<string, string[]> = {
  neutral: ["neutral", "Neutral"],
  happy: ["happy", "Happy", "joy", "Joy", "smile"],
  sad: ["sad", "Sad"],
  angry: ["angry", "Angry"],
  surprised: ["surprised", "Surprised"],
  aa: ["aa", "A", "a", "mouthA", "mouth_aa", "vowelA"],
  ih: ["ih", "I", "i", "mouthI", "mouth_ih", "vowelI"],
  ou: ["ou", "U", "u", "mouthU", "mouth_ou", "vowelU"],
  ee: ["ee", "E", "e", "mouthE", "mouth_ee", "vowelE"],
  oh: ["oh", "O", "o", "mouthO", "mouth_oh", "vowelO"],
  blink: ["blink", "Blink", "eyesClosed"],
  blinkLeft: ["blinkLeft", "Blink_L", "blink_l", "eyeBlinkLeft"],
  blinkRight: ["blinkRight", "Blink_R", "blink_r", "eyeBlinkRight"],
};

const normalizeName = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

export class VrmAvatarController {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: AvatarCallbacks;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private vrm: LoadedVrm | null = null;
  private loaded = false;
  private loadToken = 0;
  private bones: BoneMap = {};
  private restPose = new Map<THREE.Object3D, THREE.Quaternion>();
  private expressions: Record<string, string | null> = {};
  private gestures = new AvatarGesturePlayer();
  private state: AvatarState = "idle";
  private emotion: AvatarEmotion = "neutral";
  private emotionFrom: AvatarEmotion = "neutral";
  private emotionMix = 1;
  private viseme = "none";
  private mouthWeight = 0;
  private outputLevel = 0;
  private elapsed = 0;
  private blinkTimer = randomBetween(2, 6);
  private blinkProgress = 0;
  private blinkDirection = 0;
  private targetYaw = Math.PI - PLACEMENT_YAW;
  private yaw = Math.PI - PLACEMENT_YAW;
  private zoom = 1;
  private basePosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3(0, 1.5, 0);
  private readonly euler = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();

  constructor(canvas: HTMLCanvasElement, callbacks: AvatarCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.setupScene();
    this.bindPointerRotation();
  }

  async load(modelUrl: string): Promise<void> {
    if (!this.renderer || !this.scene || !this.camera) return;
    const requestToken = ++this.loadToken;
    this.loaded = false;
    this.gestures.reset(true);
    this.disposeModel();
    this.callbacks.onLoading?.(0);
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    try {
      const gltf = await loader.loadAsync(modelUrl, (progress) => {
        if (requestToken !== this.loadToken) return;
        this.callbacks.onLoading?.(progress.total ? clamp(progress.loaded / progress.total) : 0);
      });
      if (requestToken !== this.loadToken) {
        VRMUtils.deepDispose(gltf.scene);
        return;
      }
      const loadedVrm = gltf.userData.vrm as LoadedVrm | undefined;
      if (!loadedVrm?.scene) throw new Error("sha.vrm 沒有可顯示的 VRM scene。 ");
      this.vrm = loadedVrm;
      this.scene.add(loadedVrm.scene);
      this.prepareModel();
      this.loaded = true;
      this.callbacks.onReady?.(Object.entries(this.expressions).filter(([, name]) => Boolean(name)).map(([name]) => name));
    } catch (error) {
      if (requestToken !== this.loadToken) return;
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  setState(state: AvatarState): void { this.state = state; }

  setPlacement(side: "left" | "right"): void {
    this.targetYaw = Math.PI + (side === "left" ? PLACEMENT_YAW : -PLACEMENT_YAW);
  }

  setEmotion(emotion: AvatarEmotion): void {
    if (!AVATAR_EMOTIONS.includes(emotion) || emotion === this.emotion) return;
    this.emotionFrom = this.emotion;
    this.emotion = emotion;
    this.emotionMix = 0;
  }

  setViseme(viseme: string, weight: number, rms: number): void {
    this.viseme = viseme;
    this.mouthWeight = clamp(weight);
    this.outputLevel = clamp(rms * 3.5);
  }

  playGesture(gesture: AvatarGesture): void { this.gestures.queue(gesture); }
  finishTurn(): void { this.gestures.finishTurn(); }
  resetAnimation(): void { this.gestures.reset(); this.setEmotion("neutral"); this.setViseme("none", 0, 0); }

  update(deltaTime: number, audioPlaying: boolean): void {
    this.elapsed += deltaTime;
    this.yaw += (this.targetYaw - this.yaw) * (1 - Math.exp(-deltaTime * 10));
    if (this.vrm?.scene) this.vrm.scene.rotation.y = this.yaw;
    const stateBlend = 1 - Math.exp(-deltaTime * 4.5);
    if (this.emotionMix < 1) this.emotionMix = Math.min(1, this.emotionMix + deltaTime / .3);
    this.updateBlink(deltaTime);
    if (this.loaded && this.vrm) {
      this.resetPose();
      this.animatePose();
      for (const [name, angles] of Object.entries(this.gestures.update(deltaTime, audioPlaying))) {
        this.applyBoneOffset(name, angles[0], angles[1], angles[2], true);
      }
      this.applyExpressions();
      this.vrm.update?.(deltaTime);
    }
    void stateBlend;
    this.renderer?.render(this.scene!, this.camera!);
  }

  dispose(): void {
    ++this.loadToken;
    this.disposeModel();
    this.restPose.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }

  private setupScene(): void {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(25, 1, .01, 100);
      this.camera.position.set(0, 1.55, 8.2);
      this.camera.lookAt(this.cameraTarget);
      this.scene.add(new THREE.HemisphereLight(0xc9c4ff, 0x19152e, 1.8));
      const keyLight = new THREE.DirectionalLight(0xffd6c6, 3.2);
      keyLight.position.set(-2.5, 4.5, 4);
      this.scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0x9dacf8, 1.8);
      fillLight.position.set(3.5, 2.4, 2.5);
      this.scene.add(fillLight);
      const rimLight = new THREE.PointLight(0x86e4ce, 3.2, 8, 2);
      rimLight.position.set(0, 2.5, -1.8);
      this.scene.add(rimLight);
      this.resize();
      new ResizeObserver(() => this.resize()).observe(this.canvas);
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || 300);
    const height = Math.max(1, rect.height || 350);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private bindPointerRotation(): void {
    let pointerId: number | null = null;
    let previousX = 0;
    this.canvas.addEventListener("pointerdown", (event) => {
      pointerId = event.pointerId;
      previousX = event.clientX;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      this.targetYaw += (event.clientX - previousX) * .008;
      previousX = event.clientX;
    });
    const release = (event: PointerEvent) => { if (pointerId === event.pointerId) pointerId = null; };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    this.canvas.addEventListener("wheel", (event) => {
      if (!this.camera) return;
      event.preventDefault();
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(-delta * .001), .72, 2.15);
      this.camera.zoom = this.zoom;
      this.camera.updateProjectionMatrix();
    }, { passive: false });
  }

  private disposeModel(): void {
    if (this.vrm?.scene && this.scene) this.scene.remove(this.vrm.scene);
    if (this.vrm?.scene) VRMUtils.deepDispose(this.vrm.scene);
    this.vrm = null;
    this.bones = {};
    this.restPose.clear();
    this.expressions = {};
  }

  private prepareModel(): void {
    if (!this.vrm?.scene || !this.camera) return;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const targetHeight = 3.35;
    this.vrm.scene.scale.setScalar(targetHeight / Math.max(size.y, .01));
    const scaledBox = new THREE.Box3().setFromObject(this.vrm.scene);
    const center = scaledBox.getCenter(new THREE.Vector3());
    this.vrm.scene.position.x -= center.x;
    this.vrm.scene.position.y -= scaledBox.min.y;
    this.vrm.scene.position.z -= center.z;
    this.basePosition.copy(this.vrm.scene.position);
    const targetY = targetHeight * .78;
    const visibleHeight = targetHeight * .42;
    const distance = visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.cameraTarget.set(0, targetY, 0);
    this.camera.position.set(0, targetY, distance);
    this.zoom = 1;
    this.camera.zoom = this.zoom;
    this.camera.lookAt(this.cameraTarget);
    this.resolveBones();
    this.resolveExpressions();
    this.applyExpressions();
    this.resize();
  }

  private resolveBones(): void {
    const humanoid = this.vrm?.humanoid;
    if (!humanoid) return;
    const getBone = (name: string) => humanoid.getNormalizedBoneNode?.(name) || humanoid.getRawBoneNode?.(name) || null;
    this.bones = {
      hips: getBone("hips"), spine: getBone("spine"), chest: getBone("chest"), neck: getBone("neck"), head: getBone("head"),
      leftShoulder: getBone("leftShoulder"), rightShoulder: getBone("rightShoulder"), leftUpperArm: getBone("leftUpperArm"), leftLowerArm: getBone("leftLowerArm"), leftHand: getBone("leftHand"),
      rightUpperArm: getBone("rightUpperArm"), rightLowerArm: getBone("rightLowerArm"), rightHand: getBone("rightHand"),
    };
    for (const finger of ["Index", "Middle", "Ring", "Little"]) for (const segment of ["Proximal", "Intermediate", "Distal"]) this.bones[`right${finger}${segment}`] = getBone(`right${finger}${segment}`);
    this.bones.rightThumbMetacarpal = getBone("rightThumbMetacarpal");
    for (const bone of new Set(Object.values(this.bones).filter((value): value is THREE.Object3D => Boolean(value)))) this.restPose.set(bone, bone.quaternion.clone());
  }

  private resolveExpressions(): void {
    const manager = this.vrm?.expressionManager;
    if (!manager) return;
    const names = Object.keys(manager.expressionMap || {});
    const normalized = new Map(names.map((name) => [normalizeName(name), name]));
    this.expressions = {};
    for (const [logical, candidates] of Object.entries(EXPRESSION_ALIASES)) {
      this.expressions[logical] = candidates.find((candidate) => names.includes(candidate) || Boolean(manager.getExpression?.(candidate)))
        || candidates.map(normalizeName).map((name) => normalized.get(name)).find(Boolean)
        || null;
    }
  }

  private setExpression(name: string, weight: number): void {
    const manager = this.vrm?.expressionManager;
    const expression = this.expressions[name];
    if (manager?.setValue && expression) manager.setValue(expression, clamp(weight));
  }

  private applyExpressions(): void {
    for (const name of AVATAR_EMOTIONS) {
      const weight = name === this.emotion ? this.emotionMix : name === this.emotionFrom ? 1 - this.emotionMix : 0;
      const mouthExpression = name === "happy" || name === "surprised";
      this.setExpression(name, mouthExpression ? weight * SHA_MOUTH_INTENSITY : weight);
    }
    for (const name of ["aa", "ih", "ou", "ee", "oh"]) this.setExpression(name, name === this.viseme ? this.mouthWeight * SHA_MOUTH_INTENSITY : 0);
    if (this.expressions.blink) this.setExpression("blink", this.blinkProgress);
    else { this.setExpression("blinkLeft", this.blinkProgress); this.setExpression("blinkRight", this.blinkProgress); }
  }

  private resetPose(): void { for (const [bone, quaternion] of this.restPose) bone.quaternion.copy(quaternion); }

  private applyBoneOffset(name: string, x: number, y: number, z: number, multiply = false): void {
    const bone = this.bones[name];
    if (!bone) return;
    const rest = this.restPose.get(bone);
    if (!rest) return;
    this.euler.set(x, y, z);
    this.quaternion.setFromEuler(this.euler);
    if (multiply) bone.quaternion.multiply(this.quaternion);
    else bone.quaternion.copy(rest).multiply(this.quaternion);
  }

  private animatePose(): void {
    const t = this.elapsed;
    const listening = this.state === "listening" ? 1 : 0;
    const thinking = this.state === "thinking" ? 1 : 0;
    const speaking = this.state === "speaking" ? 1 : 0;
    const interrupted = this.state === "interrupted" ? 1 : 0;
    const breath = Math.sin(t * 1.52 + Math.sin(t * .17) * .2) * .018;
    const shift = Math.sin(t * .37 + .4) * .025 + Math.sin(t * .19 + 2.2) * .012;
    const gazeYaw = Math.sin(t * .23 + .5) * .022 + Math.sin(t * .071 + 1.8) * .018;
    const gazePitch = Math.sin(t * .29 + 2.4) * .011;
    const speechBeat = Math.sin(t * 2.4) + Math.sin(t * 4.1 + 1.1) * .32;
    const energy = speaking * (.25 + this.outputLevel * .75);
    const pitch = breath * .35 + gazePitch + listening * Math.pow(Math.max(0, Math.sin(t * .68 - .7)), 10) * .035 + speechBeat * .016 * energy + interrupted * .025;
    const yaw = gazeYaw + shift * .45 + Math.sin(t * .91 + .8) * .018 * energy - thinking * .035;
    const roll = Math.sin(t * .31 + .8) * .016 + listening * Math.sin(t * .75) * .018 + thinking * (Math.sin(t * .8) * .035 - .055);
    const bodyBob = breath * .25 + speechBeat * .005 * energy;
    const armDrift = Math.sin(t * .53 + .4) * .018 + Math.sin(t * .21 + 2) * .009;
    const elbowRelax = .05 + Math.sin(t * .47 + 1.5) * .012;
    this.applyBoneOffset("hips", 0, shift * .2, shift * .12);
    this.applyBoneOffset("spine", breath * .18 - listening * .008, shift * .22, -shift * .12);
    this.applyBoneOffset("chest", breath * .45 + speechBeat * .006 * energy, shift * .42, shift * .2);
    this.applyBoneOffset("leftShoulder", 0, 0, shift * .32);
    this.applyBoneOffset("rightShoulder", 0, 0, shift * .23);
    this.applyBoneOffset("neck", pitch * .35, yaw * .35, roll * .35);
    this.applyBoneOffset("head", pitch, yaw, roll);
    this.applyBoneOffset("leftUpperArm", 0, 0, NATURAL_ARM_DROP + armDrift - shift * .16);
    this.applyBoneOffset("leftLowerArm", -elbowRelax, 0, 0);
    this.applyBoneOffset("rightUpperArm", 0, 0, -NATURAL_ARM_DROP + armDrift * .76 + shift * .13);
    this.applyBoneOffset("rightLowerArm", -elbowRelax, 0, 0);
    if (this.vrm?.scene) { this.vrm.scene.position.x = this.basePosition.x + shift * .018; this.vrm.scene.position.y = this.basePosition.y + bodyBob; }
  }

  private updateBlink(deltaTime: number): void {
    this.blinkTimer -= deltaTime;
    if (this.blinkDirection === 0 && this.blinkTimer <= 0) { this.blinkDirection = 1; this.blinkTimer = .075; }
    if (this.blinkDirection === 1) {
      this.blinkProgress = Math.min(1, this.blinkProgress + deltaTime / .075);
      if (this.blinkProgress >= 1) { this.blinkDirection = -1; this.blinkTimer = .075; }
    } else if (this.blinkDirection === -1) {
      this.blinkProgress = Math.max(0, this.blinkProgress - deltaTime / .075);
      if (this.blinkProgress <= 0) { this.blinkDirection = 0; this.blinkTimer = randomBetween(2, 6); }
    }
  }
}
