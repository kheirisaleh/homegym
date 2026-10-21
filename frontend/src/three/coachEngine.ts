import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type { CoachKey } from "@/lib/types";

const MODELS: Record<CoachKey, string> = { max: "/static/coach/max.glb", lena: "/static/coach/lena.glb" };
const OUTFITS: Record<CoachKey, Record<string, string>> = {
  max: { Shirt: "#d93a3f", Pants: "#22262c", Socks: "#f2f2f2" },
  lena: { Shirt: "#3f7bf2", Pants: "#22262c", Shoes: "#f2f2f2" },
};
const BONES = [
  "Hips", "Abdomen", "Torso", "Neck", "Head", "ShoulderL", "ShoulderR", "UpperArmL", "LowerArmL", "PalmL", "UpperArmR", "LowerArmR", "PalmR",
  "UpperLegL", "LowerLegL", "UpperLegR", "LowerLegR",
] as const;
type BoneName = (typeof BONES)[number];

const cache: Partial<Record<string, Promise<GLTF>>> = {};

function loadModel(key: CoachKey): Promise<GLTF> {
  const url = MODELS[key];
  cache[url] ??= new GLTFLoader().loadAsync(url);
  return cache[url];
}

export function preloadCoach(key: CoachKey): void {
  loadModel(key).catch(() => undefined);
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, "rgba(0,0,0,0.55)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

const pointer = { x: 0, y: 0, at: -1e9 };
let pointerBound = false;

function bindPointer(): void {
  if (pointerBound) return;
  pointerBound = true;
  const track = (event: PointerEvent) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.at = performance.now();
  };
  window.addEventListener("pointermove", track, { passive: true });
  window.addEventListener("pointerdown", track, { passive: true });
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const IDENTITY = new THREE.Quaternion();
const tmpParent = new THREE.Quaternion();
const tmpDelta = new THREE.Quaternion();
const tmpLocal = new THREE.Quaternion();
const tmpBlend = new THREE.Quaternion();
const tmpModel = new THREE.Quaternion();
const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();

function applyWorldDelta(bone: THREE.Object3D, delta: THREE.Quaternion): void {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(tmpParent);
  tmpLocal.copy(tmpParent).invert().multiply(delta).multiply(tmpParent);
  bone.quaternion.premultiply(tmpLocal);
  bone.updateMatrixWorld(true);
}

function boneTip(bone: THREE.Object3D, child: THREE.Object3D | undefined, out: THREE.Vector3): THREE.Vector3 {
  if (child) return child.getWorldPosition(out);
  bone.getWorldQuaternion(tmpParent);
  bone.getWorldPosition(out);
  return out.add(tmpAxis.copy(AXIS_Y).applyQuaternion(tmpParent).multiplyScalar(0.01));
}

function aimBone(bone: THREE.Object3D | undefined, child: THREE.Object3D | undefined, direction: THREE.Vector3, weight: number): void {
  if (!bone || weight <= 0.001) return;
  bone.getWorldPosition(tmpFrom);
  boneTip(bone, child, tmpTo);
  tmpTo.sub(tmpFrom);
  if (tmpTo.lengthSq() < 1e-10) return;
  tmpTo.normalize();
  tmpDelta.setFromUnitVectors(tmpTo, direction);
  if (weight < 1) {
    tmpBlend.copy(IDENTITY).slerp(tmpDelta, weight);
    tmpDelta.copy(tmpBlend);
  }
  applyWorldDelta(bone, tmpDelta);
}

export const rand = (min: number, max: number) => min + Math.random() * (max - min);
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const smooth = (value: number) => {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};
const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
const mirror = (pair: [THREE.Vector3, THREE.Vector3]): [THREE.Vector3, THREE.Vector3] => [vec(-pair[0].x, pair[0].y, pair[0].z), vec(-pair[1].x, pair[1].y, pair[1].z)];
const mix = (from: THREE.Vector3, to: THREE.Vector3, amount: number) => from.clone().lerp(to, clamp(amount, 0, 1)).normalize();
const mixPair = (from: [THREE.Vector3, THREE.Vector3], to: [THREE.Vector3, THREE.Vector3], amount: number): [THREE.Vector3, THREE.Vector3] => [
  mix(from[0], to[0], amount),
  mix(from[1], to[1], amount),
];
const wave01 = (t: number, period: number) => (1 - Math.cos((Math.PI * 2 * t) / period)) / 2;

export function pick<T>(list: [T, number][]): T {
  const total = list.reduce((sum, item) => sum + item[1], 0);
  let roll = Math.random() * total;
  for (const item of list) {
    roll -= item[1];
    if (roll <= 0) return item[0];
  }
  return list[0]![0];
}

type Pair = [THREE.Vector3, THREE.Vector3];

export interface Pose {
  R?: Pair;
  L?: Pair;
  RL?: Pair;
  LL?: Pair;
  lean?: number;
  side?: number;
  twist?: number;
  tilt?: number;
  nod?: number;
  shake?: number;
  lift?: number;
  ground?: boolean;
}

export interface Move {
  duration: number;
  pose: (t: number) => Pose;
  look?: (t: number) => { x: number; y: number };
}

const ARM_DOWN_R: Pair = [vec(-0.18, -1, 0.02), vec(-0.12, -1, 0.08)];
const LEG_DOWN_R: Pair = [vec(-0.06, -1, 0.02), vec(-0.04, -1, -0.02)];

function repsMove(reps: number, period: number, build: (phase: number, t: number) => Pose): Move {
  return { duration: reps * period + 0.3, pose: (t) => build(wave01(Math.max(0, t - 0.15), period), t) };
}

export const MOVES: Record<string, Move> = {
  wave: {
    duration: 2.4,
    pose: (t) => ({ R: [vec(-0.55, 0.8, 0.25), vec(-0.1 + Math.sin(t * 11) * 0.55, 1, 0.3)], tilt: 0.12 }),
  },
  flex: {
    duration: 2.6,
    pose: (t) => {
      const pulse = Math.sin(t * 7) * 0.08;
      const right: Pair = [vec(-1, 0.12 + pulse, 0.15), vec(-0.12, 1, 0.3)];
      return { R: right, L: mirror(right), lean: 0.06, nod: -0.08 };
    },
  },
  fistPump: {
    duration: 2.1,
    pose: (t) => {
      const pump = Math.abs(Math.sin(t * 6.5));
      return { R: [vec(-0.4, 0.45 + pump * 0.55, 0.3), vec(-0.1, 1, 0.15)], nod: -0.1 * pump, lean: 0.04 };
    },
  },
  point: {
    duration: 1.8,
    pose: () => ({ R: [vec(-0.22, 0.05, 1), vec(-0.08, 0.12, 1)], lean: 0.05 }),
  },
  thumbsUp: {
    duration: 2.2,
    pose: (t) => ({ R: [vec(-0.3, -0.3, 0.9), vec(-0.12, 0.85 + Math.sin(t * 8) * 0.06, 0.5)], tilt: 0.14, twist: 0.12 }),
  },
  stretch: {
    duration: 3.2,
    pose: (t) => {
      const right: Pair = [vec(-0.2, 1, 0.02), vec(-0.05, 1, 0)];
      return { R: right, L: mirror(right), side: Math.sin(t * 1.9) * 0.2, nod: -0.12 };
    },
  },
  think: {
    duration: Infinity,
    pose: (t) => ({ R: [vec(-0.12, -0.6, 0.75), vec(0.4, 0.85, 0.35)], tilt: 0.16 + Math.sin(t * 1.3) * 0.04, nod: -0.1, side: Math.sin(t * 0.9) * 0.03 }),
  },
  victory: {
    duration: 1.9,
    pose: (t) => {
      const shake = Math.sin(t * 14) * 0.12;
      const right: Pair = [vec(-0.5, 1, 0.1), vec(-0.35 + shake, 1, 0.1)];
      return { R: right, L: mirror(right), nod: -0.2 };
    },
  },
  explainR: {
    duration: 1.6,
    pose: (t) => ({ R: [vec(-0.3, -0.75, 0.55), vec(-0.35 + Math.sin(t * 5) * 0.12, 0.15 + Math.sin(t * 4) * 0.12, 1)], twist: -0.06 }),
  },
  explainL: {
    duration: 1.6,
    pose: (t) => ({ L: [vec(0.3, -0.75, 0.55), vec(0.35 + Math.sin(t * 5) * 0.12, 0.15 + Math.sin(t * 4) * 0.12, 1)], twist: 0.06 }),
  },
  explainBoth: {
    duration: 1.7,
    pose: (t) => {
      const open = Math.sin(t * 4) * 0.15;
      const right: Pair = [vec(-0.35, -0.7, 0.55), vec(-0.45 - open, 0.2, 1)];
      return { R: right, L: mirror(right), lean: 0.04 };
    },
  },
  shrug: {
    duration: 1.6,
    pose: (t) => {
      const up = Math.sin(Math.min(1, t / 1.2) * Math.PI);
      const right: Pair = [vec(-0.45, -0.75, 0.3), vec(-0.8, 0.15 + up * 0.2, 0.6)];
      return { R: right, L: mirror(right), tilt: 0.18 * up };
    },
  },
  nodYes: {
    duration: 1.4,
    pose: (t) => ({ nod: Math.sin(t * 11) * 0.16 * (1 - t / 1.4) }),
  },
  shakeNo: {
    duration: 1.4,
    pose: (t) => ({ shake: Math.sin(t * 12) * 0.22 * (1 - t / 1.4) }),
  },
  checkWatch: {
    duration: 2.6,
    pose: () => ({ L: [vec(0.32, -0.55, 0.78), vec(-0.75, 0.42, 0.52)], nod: 0.18 }),
    look: () => ({ x: 0.2, y: 0.55 }),
  },
  lookAround: {
    duration: 2.8,
    pose: () => ({}),
    look: (t) => ({ x: Math.sin(t * 2.3) * 0.95, y: -0.12 }),
  },
  squat: repsMove(3, 1.7, (depth) => {
    const thigh: Pair = mixPair(LEG_DOWN_R, [vec(-0.2, -0.32, 0.93), vec(-0.05, -0.86, -0.5)], depth);
    const arm: Pair = mixPair(ARM_DOWN_R, [vec(-0.16, 0.05, 1), vec(-0.08, 0.08, 1)], Math.min(1, depth * 1.4));
    return { RL: thigh, LL: mirror(thigh), R: arm, L: mirror(arm), lean: 0.42 * depth, nod: -0.25 * depth, ground: true };
  }),
  lunge: repsMove(2, 2.1, (depth) => {
    const front: Pair = mixPair(LEG_DOWN_R, [vec(-0.1, -0.3, 0.95), vec(-0.03, -1, 0.02)], depth);
    const back: Pair = mixPair(mirror(LEG_DOWN_R), [vec(0.06, -0.92, -0.38), vec(0.03, -0.35, -0.94)], depth);
    const arm: Pair = [vec(-0.35, -0.85, 0.1), vec(-0.55, -0.3, 0.55)];
    return { RL: front, LL: back, R: arm, L: mirror(arm), lean: 0.08 * depth, ground: true };
  }),
  hinge: repsMove(3, 2, (depth) => ({
    RL: mixPair(LEG_DOWN_R, [vec(-0.06, -1, -0.12), vec(-0.04, -0.97, 0.18)], depth),
    LL: mirror(mixPair(LEG_DOWN_R, [vec(-0.06, -1, -0.12), vec(-0.04, -0.97, 0.18)], depth)),
    R: [vec(-0.12, -1, 0.05), vec(-0.1, -1, 0.05)],
    L: [vec(0.12, -1, 0.05), vec(0.1, -1, 0.05)],
    lean: 0.95 * depth,
    nod: -0.45 * depth,
    ground: true,
  })),
  push: repsMove(3, 1.4, (extend) => {
    const arm: Pair = mixPair([vec(-0.9, -0.15, -0.35), vec(-0.25, 0.1, 1)], [vec(-0.18, 0.05, 1), vec(-0.08, 0.05, 1)], extend);
    return { R: arm, L: mirror(arm), lean: 0.05 };
  }),
  press: repsMove(3, 1.5, (extend) => {
    const arm: Pair = mixPair([vec(-1, 0.05, 0.1), vec(-0.08, 1, 0.12)], [vec(-0.25, 1, 0.05), vec(-0.08, 1, 0)], extend);
    return { R: arm, L: mirror(arm), nod: 0.05 * extend };
  }),
  pull: repsMove(3, 1.5, (pull) => {
    const arm: Pair = mixPair([vec(-0.3, 1, 0.1), vec(-0.15, 1, 0.05)], [vec(-0.95, -0.25, -0.05), vec(-0.2, 1, 0.15)], pull);
    return { R: arm, L: mirror(arm), nod: -0.12 * (1 - pull) };
  }),
  row: repsMove(3, 1.6, (pull) => {
    const arm: Pair = mixPair([vec(-0.12, -0.7, 0.7), vec(-0.08, -0.9, 0.42)], [vec(-0.35, -0.45, -0.82), vec(-0.08, -0.98, 0.15)], pull);
    const legs: Pair = [vec(-0.06, -1, -0.05), vec(-0.04, -0.96, 0.25)];
    return { R: arm, L: mirror(arm), RL: legs, LL: mirror(legs), lean: 0.78, nod: -0.35, ground: true };
  }),
  curl: repsMove(3, 1.4, (lift) => {
    const arm: Pair = mixPair([vec(-0.14, -1, 0.04), vec(-0.12, -1, 0.1)], [vec(-0.14, -1, 0.08), vec(-0.06, 0.7, 0.72)], lift);
    return { R: arm, L: mirror(arm), nod: 0.12 };
  }),
  triceps: repsMove(3, 1.5, (extend) => {
    const arm: Pair = mixPair([vec(-0.18, 1, 0.08), vec(-0.05, -0.85, -0.5)], [vec(-0.18, 1, 0.08), vec(-0.1, 1, 0.05)], extend);
    return { R: arm, L: mirror(arm) };
  }),
  lateral: repsMove(3, 1.5, (raise) => {
    const arm: Pair = mixPair(ARM_DOWN_R, [vec(-1, 0.05, 0.08), vec(-1, 0.1, 0.12)], raise);
    return { R: arm, L: mirror(arm), nod: -0.04 };
  }),
  reverseFly: repsMove(3, 1.6, (open) => {
    const arm: Pair = mixPair([vec(-0.08, -1, 0.15), vec(-0.05, -1, 0.15)], [vec(-1, -0.35, 0), vec(-1, -0.3, 0.05)], open);
    const legs: Pair = [vec(-0.06, -1, -0.05), vec(-0.04, -0.96, 0.25)];
    return { R: arm, L: mirror(arm), RL: legs, LL: mirror(legs), lean: 0.7, nod: -0.3, ground: true };
  }),
  calfRaise: repsMove(4, 1.1, (rise) => ({ lift: 0.06 * rise, R: [vec(-0.25, -1, 0.05), vec(-0.2, -1, 0.1)], L: [vec(0.25, -1, 0.05), vec(0.2, -1, 0.1)] })),
  legCurl: repsMove(3, 1.4, (curl) => {
    const working: Pair = mixPair(LEG_DOWN_R, [vec(-0.06, -1, -0.04), vec(-0.03, 0.25, -0.97)], curl);
    return { RL: working, LL: mirror(LEG_DOWN_R), R: [vec(-0.5, -0.8, 0.2), vec(-0.4, -0.5, 0.7)], L: [vec(0.5, -0.8, 0.2), vec(0.4, -0.5, 0.7)] };
  }),
  crunch: repsMove(3, 1.4, (curl) => {
    const arm: Pair = [vec(-0.55, 0.65, 0.4), vec(0.65, 0.55, -0.4)];
    return { R: arm, L: mirror(arm), lean: 0.35 * curl, nod: -0.3 * curl };
  }),
  twist: {
    duration: 3,
    pose: (t) => {
      const arm: Pair = [vec(-0.4, -0.3, 0.85), vec(0.35, -0.1, 0.95)];
      return { R: arm, L: mirror(arm), twist: Math.sin(t * 4.2) * 0.42, lean: 0.12 };
    },
  },
  jumpingJacks: {
    duration: 4 * 0.9 + 0.2,
    pose: (t) => {
      const open = wave01(t, 0.9);
      const arm: Pair = mixPair([vec(-0.25, -1, 0.02), vec(-0.2, -1, 0.05)], [vec(-0.45, 1, 0.05), vec(-0.25, 1, 0.05)], open);
      const leg: Pair = mixPair(LEG_DOWN_R, [vec(-0.36, -0.93, 0.02), vec(-0.3, -0.95, 0)], open);
      return { R: arm, L: mirror(arm), RL: leg, LL: mirror(leg), lift: 0.045 * Math.abs(Math.sin((Math.PI * 2 * t) / 0.9)), ground: true };
    },
  },
  highKnees: {
    duration: 2.8,
    pose: (t) => {
      const phase = (Math.PI * 2 * t) / 0.55;
      const right = Math.max(0, Math.sin(phase));
      const left = Math.max(0, -Math.sin(phase));
      const legUp: Pair = [vec(-0.06, -0.08, 1), vec(-0.04, -1, 0.05)];
      const rightLeg = mixPair(LEG_DOWN_R, legUp, right);
      const leftLeg = mirror(mixPair(LEG_DOWN_R, legUp, left));
      const armSwing = Math.sin(phase);
      const rightArm: Pair = [vec(-0.15, -0.8, -0.6 * armSwing), vec(-0.05, 0.2, 1)];
      const leftArm: Pair = [vec(0.15, -0.8, 0.6 * armSwing), vec(0.05, 0.2, 1)];
      return { RL: rightLeg, LL: leftLeg, R: rightArm, L: leftArm, lift: 0.02 * Math.abs(Math.sin(phase)), ground: true };
    },
  },
  armCircles: {
    duration: 3.2,
    pose: (t) => {
      const angle = t * 7;
      const right: Pair = [vec(-1, 0.3 * Math.sin(angle), 0.3 * Math.cos(angle)), vec(-1, 0.35 * Math.sin(angle + 0.3), 0.35 * Math.cos(angle + 0.3))];
      return { R: right, L: mirror(right) };
    },
  },
  shakeOut: {
    duration: 2.2,
    pose: (t) => {
      const shake = Math.sin(t * 22) * 0.18;
      const right: Pair = [vec(-0.35, -1, shake), vec(-0.3 + shake, -1, 0.1)];
      return { R: right, L: mirror(right), side: Math.sin(t * 9) * 0.05 };
    },
  },
  breathe: {
    duration: 4.5,
    pose: (t) => {
      const breath = wave01(t, 4.5);
      const right: Pair = mixPair([vec(-0.25, -1, 0.08), vec(-0.2, -1, 0.1)], [vec(-0.75, 0.65, 0.1), vec(-0.4, 1, 0.1)], breath);
      return { R: right, L: mirror(right), nod: -0.12 * breath };
    },
  },
};

const PROFILE_TURN: Record<string, number> = {
  squat: 0.85,
  lunge: 0.95,
  hinge: 1.05,
  push: 0.9,
  row: 1.05,
  reverseFly: 0.5,
  curl: 0.6,
  triceps: 0.6,
  legCurl: 1,
  highKnees: 0.8,
  crunch: 0.7,
  calfRaise: 0.9,
};

export const PATTERN_DEMOS: Record<string, string> = {
  squat: "squat",
  lunge: "lunge",
  hinge: "hinge",
  horizontal_push: "push",
  incline_push: "push",
  chest_fly: "push",
  dip: "triceps",
  vertical_push: "press",
  vertical_pull: "pull",
  horizontal_pull: "row",
  elbow_flexion: "curl",
  elbow_flexion_stretch: "curl",
  elbow_flexion_neutral: "curl",
  elbow_extension: "triceps",
  elbow_extension_overhead: "triceps",
  lateral_raise: "lateral",
  rear_delt: "reverseFly",
  calf: "calfRaise",
  knee_flexion: "legCurl",
  hip_flexion: "highKnees",
  core_flexion: "crunch",
  anti_extension: "crunch",
  anti_lateral: "twist",
  rotation: "twist",
  cardio_steady: "highKnees",
  cardio_interval: "jumpingJacks",
  mobility: "stretch",
};

export function demoForPattern(pattern: string | null | undefined): string | null {
  return pattern ? (PATTERN_DEMOS[pattern] ?? null) : null;
}

const IDLE_ACTIONS: Record<CoachKey, [string, number][]> = {
  max: [
    ["flex", 3], ["shadowbox", 3], ["squat", 3], ["jumpingJacks", 2], ["fistPump", 1], ["lookAround", 2], ["armCircles", 2], ["checkWatch", 1], ["stretch", 1],
    ["wave", 1], ["highKnees", 2], ["push", 1],
  ],
  lena: [
    ["stretch", 3], ["jump", 2], ["thumbsUp", 2], ["lunge", 2], ["jumpingJacks", 2], ["lookAround", 2], ["armCircles", 2], ["highKnees", 2], ["breathe", 1],
    ["flex", 1], ["wave", 1], ["checkWatch", 1],
  ],
};
const REST_ACTIONS: [string, number][] = [["breathe", 3], ["shakeOut", 2], ["stretch", 2], ["armCircles", 1], ["lookAround", 1], ["checkWatch", 1]];
const TALK_START: Record<string, string> = { push: "fistPump", celebrate: "clap", easy: "wave", focused: "point" };
const TALK_END: Record<string, string> = { push: "flex", celebrate: "celebrate", easy: "thumbsUp", focused: "thumbsUp" };

export type StageMode = "stage" | "overlay" | "rest" | "picker";
export type Framing = "portrait" | "full";

interface ActiveMove {
  name: string;
  def: Move;
  start: number;
  endAt?: number;
}

interface Timer {
  at: number;
  fn: () => void;
}

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
}

export class CoachStage {
  readonly container: HTMLElement;
  readonly key: CoachKey;
  readonly color: string;
  readonly framing: Framing;
  mode: StageMode;
  talking = false;
  thinking = false;
  disposed = false;
  ready = false;
  visible = true;
  private queue: (() => void)[] = [];
  private timers: Timer[] = [];
  time = 0;
  private look = { x: 0, y: 0, weight: 1 };
  private saccade = { x: 0, y: 0, at: 0 };
  private moveNow: ActiveMove | null = null;
  private movePrev: ActiveMove | null = null;
  private hop: { start: number; height: number; duration: number } | null = null;
  private spin: { start: number; duration: number } | null = null;
  private walk: { start: number; duration: number; from: number } | null = null;
  private beatImpulse = 0;
  private nextIdleAt = rand(2, 4);
  private nextTalkGestureAt = 0;
  private lastHover = -10;
  private clipBusy = false;
  private demoPattern: string | null = null;
  private timer = new THREE.Timer();
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private model: THREE.Object3D | null = null;
  private shadow: THREE.Mesh | null = null;
  private rim: THREE.DirectionalLight | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private current: THREE.AnimationAction | null = null;
  private clips: Record<string, THREE.AnimationClip> = {};
  private bones: Partial<Record<BoneName, THREE.Bone>> = {};
  private touched: THREE.Bone[] = [];
  private saved: THREE.Quaternion[] | null = null;
  private baseYaw = 0;
  private baseY = 0;
  private footRest: number | null = null;
  private baseX = 0;
  private height = 2;
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;
  private intersection: IntersectionObserver | null = null;
  private confettiMesh: THREE.InstancedMesh | null = null;
  private particles: Particle[] | null = null;
  private dummy = new THREE.Object3D();
  private onEnter = () => {
    this.hover();
  };

  constructor(container: HTMLElement, key: CoachKey, color: string, framing: Framing, mode: StageMode) {
    this.container = container;
    this.key = key;
    this.color = color;
    this.framing = framing;
    this.mode = mode;
    bindPointer();
  }

  async init(): Promise<void> {
    const gltf = await loadModel(this.key);
    if (this.disposed) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    this.container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f46, 1.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(2.5, 4, 5);
    scene.add(keyLight);
    const rim = new THREE.DirectionalLight(new THREE.Color(this.color), 2.4);
    rim.position.set(-3, 3, -4);
    scene.add(rim);
    this.rim = rim;

    const model = cloneSkinned(gltf.scene);
    this.baseYaw = this.framing === "full" ? -0.18 : -0.32;
    model.rotation.set(0, this.baseYaw, 0);
    const outfit = OUTFITS[this.key];
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.frustumCulled = false;
      const materials = (Array.isArray(node.material) ? node.material : [node.material]) as THREE.MeshStandardMaterial[];
      const updated = materials.map((material) => {
        const copy = material.clone();
        const tint = outfit[material.name];
        if (tint) copy.color = new THREE.Color(tint);
        copy.roughness = Math.max(0.55, copy.roughness);
        copy.metalness = 0;
        return copy;
      });
      node.material = Array.isArray(node.material) ? updated : updated[0]!;
    });
    scene.add(model);
    this.model = model;

    model.updateMatrixWorld(true);
    model.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.update();
    });
    const box = new THREE.Box3().setFromObject(model, true);
    if (box.isEmpty() || !Number.isFinite(box.min.y)) box.setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const height = size.y || 2;
    model.position.y = -box.min.y;
    this.baseY = model.position.y;
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(height * 0.7, height * 0.7),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.001;
    scene.add(shadow);
    this.shadow = shadow;

    this.camera = new THREE.PerspectiveCamera(28, 1, height * 0.05, height * 20);
    this.height = height;
    this.frame();

    model.traverse((node) => {
      if ((BONES as readonly string[]).includes(node.name)) this.bones[node.name as BoneName] = node as THREE.Bone;
    });
    this.touched = Object.values(this.bones).filter((bone): bone is THREE.Bone => bone instanceof THREE.Bone);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const name = (clip.name.split("|").pop() ?? clip.name).replace(/^(Man|Female)_/, "");
      this.clips[name] = clip;
    }
    this.play("Idle", true);
    this.resizeObserver = new ResizeObserver(() => {
      this.frame();
    });
    this.resizeObserver.observe(this.container);
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries.some((entry) => entry.isIntersecting);
    });
    this.intersection.observe(this.container);
    this.container.addEventListener("pointerenter", this.onEnter);
    this.ready = true;
    this.queue.splice(0).forEach((fn) => {
      fn();
    });
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.update();
    };
    loop();
  }

  run(fn: () => void): void {
    if (this.disposed) return;
    if (this.ready) fn();
    else this.queue.push(fn);
  }

  later(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  frame(): void {
    if (!this.renderer || !this.camera) return;
    const width = this.container.clientWidth || 300;
    const height = this.container.clientHeight || 300;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const top = this.height * 1.03;
    const bottom = this.framing === "full" ? -this.height * 0.01 : this.height * (width / height > 1.1 ? 0.22 : 0.34);
    const visible = top - bottom;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const byHeight = visible / 2 / Math.tan(halfFov);
    const byWidth = (this.height * 0.2) / Math.tan(halfFov) / Math.max(this.camera.aspect, 0.01);
    const distance = Math.max(byHeight, byWidth) * 1.01;
    const centerY = (top + bottom) / 2;
    this.camera.position.set(0, centerY + this.height * 0.03, distance);
    this.camera.lookAt(0, centerY, 0);
    this.camera.updateProjectionMatrix();
  }

  private play(name: string, loop: boolean, then?: () => void): boolean {
    const clip = this.clips[name];
    if (!clip || !this.mixer) {
      then?.();
      return false;
    }
    const mixer = this.mixer;
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, 0.3, false);
    action.play();
    this.current = action;
    this.clipBusy = name !== "Idle";
    if (!loop) {
      const onFinish = (event: { action: THREE.AnimationAction }) => {
        if (event.action !== action) return;
        mixer.removeEventListener("finished", onFinish);
        then?.();
      };
      mixer.addEventListener("finished", onFinish);
    }
    return true;
  }

  private playClip(names: string[], then?: () => void): void {
    this.setMove(null);
    const chain = names.filter((name) => this.clips[name]);
    const next = () => {
      const name = chain.shift();
      if (!name) {
        this.play("Idle", true);
        then?.();
        return;
      }
      this.play(name, false, next);
    };
    next();
  }

  private setMove(name: string | null): void {
    if (this.moveNow) this.movePrev = { ...this.moveNow, endAt: this.time };
    const def = name ? MOVES[name] : undefined;
    this.moveNow = name && def ? { name, def, start: this.time } : null;
  }

  private startHop(height: number, duration: number): void {
    this.hop = { start: this.time, height, duration };
  }

  private pulse(): void {
    const element = this.container;
    element.classList.remove("coach-pulse");
    element.getBoundingClientRect();
    element.classList.add("coach-pulse");
  }

  action(name: string): void {
    this.run(() => {
      if (name === "celebrate") {
        this.setMove("victory");
        if (!reducedMotion()) {
          this.spin = { start: this.time, duration: 1.1 };
          this.startHop(0.07, 0.55);
          this.later(0.25, () => {
            this.confetti();
          });
        }
        this.pulse();
        this.later(1.9, () => {
          this.playClip(["Clapping"]);
        });
      } else if (name === "clap") {
        this.pulse();
        this.playClip(["Clapping"]);
      } else if (name === "shadowbox") {
        this.playClip(["Punch", "Punch"]);
      } else if (name === "jump") {
        this.playClip(["Jump"]);
      } else if (name === "wave") {
        this.setMove("wave");
        this.startHop(0.025, 0.35);
      } else if (name === "go") {
        this.pulse();
        this.setMove("fistPump");
        this.startHop(0.05, 0.45);
      } else {
        this.setMove(name);
      }
    });
  }

  demo(pattern: string | null): boolean {
    const move = demoForPattern(pattern);
    if (!move || reducedMotion()) return false;
    this.run(() => {
      this.setMove(move);
      this.nextIdleAt = this.time + (MOVES[move]?.duration ?? 3) + rand(3, 5);
    });
    return true;
  }

  setDemoPattern(pattern: string | null): void {
    this.demoPattern = pattern;
  }

  intro(): void {
    this.run(() => {
      if (!reducedMotion() && this.clips.Walk && this.mode === "overlay") {
        this.walk = { start: this.time, duration: 1.15, from: -this.height * 0.9 };
        this.play("Walk", true);
        this.later(1.15, () => {
          this.play("Idle", true);
          this.action("wave");
        });
      } else {
        this.startHop(0.05, 0.5);
        this.later(0.15, () => {
          this.action("wave");
        });
      }
      this.nextIdleAt = this.time + rand(4, 6);
    });
  }

  greet(): void {
    this.run(() => {
      const options: [string, number][] = this.key === "max"
        ? [["celebrate", 2], ["shadowbox", 2], ["flex", 2], ["squat", 2], ["jumpingJacks", 1]]
        : [["celebrate", 2], ["jump", 2], ["thumbsUp", 1], ["wave", 1], ["lunge", 2], ["jumpingJacks", 1]];
      this.action(pick(options));
      this.nextIdleAt = this.time + rand(5, 7);
    });
  }

  hover(): void {
    this.run(() => {
      if (this.talking || this.thinking || this.clipBusy) return;
      if (this.time - this.lastHover < 8) return;
      this.lastHover = this.time;
      this.action(pick([["wave", 3], ["thumbsUp", 1], ["point", 1]]));
      this.nextIdleAt = this.time + rand(4, 7);
    });
  }

  think(): void {
    this.run(() => {
      this.thinking = true;
      this.setMove("think");
    });
  }

  talk(mood: string): void {
    this.run(() => {
      this.thinking = false;
      this.talking = true;
      this.action(TALK_START[mood] ?? "point");
      this.nextTalkGestureAt = this.time + rand(2.2, 2.8);
      if (this.demoPattern) {
        const pattern = this.demoPattern;
        this.later(rand(3.2, 4.2), () => {
          if (this.talking) this.demo(pattern);
        });
      }
    });
  }

  finish(mood: string): void {
    this.run(() => {
      this.talking = false;
      this.action(TALK_END[mood] ?? "thumbsUp");
      this.nextIdleAt = this.time + rand(4, 6);
    });
  }

  beat(strength: number): void {
    if (!this.ready) return;
    this.beatImpulse = Math.min(1.2, this.beatImpulse + strength);
  }

  private confetti(): void {
    if (!this.scene) return;
    const count = 110;
    const h = this.height;
    if (!this.confettiMesh) {
      const geometry = new THREE.PlaneGeometry(h * 0.018, h * 0.03);
      const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.frustumCulled = false;
      const palette = [this.color, "#ffffff", "#f5c542", "#3ddc97", this.color];
      const color = new THREE.Color();
      for (let index = 0; index < count; index++) {
        color.set(palette[index % palette.length]!);
        mesh.setColorAt(index, color);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
      this.confettiMesh = mesh;
    }
    this.particles = Array.from({ length: count }, () => ({
      position: new THREE.Vector3(rand(-0.12, 0.12) * h, h * rand(0.72, 0.85), rand(0, 0.15) * h),
      velocity: new THREE.Vector3(rand(-0.9, 0.9) * h, rand(1.1, 2.1) * h, rand(0.1, 0.9) * h),
      rotation: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
      spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
      life: rand(1.8, 2.8),
    }));
  }

  private updateConfetti(delta: number): void {
    const mesh = this.confettiMesh;
    if (!this.particles || !mesh) return;
    const gravity = this.height * 2.6;
    let alive = 0;
    this.particles.forEach((particle, index) => {
      particle.life -= delta;
      if (particle.life > 0) {
        alive++;
        particle.velocity.y -= gravity * delta;
        particle.velocity.multiplyScalar(1 - delta * 1.4);
        particle.position.addScaledVector(particle.velocity, delta);
        particle.rotation.x += particle.spin.x * delta;
        particle.rotation.y += particle.spin.y * delta;
        particle.rotation.z += particle.spin.z * delta;
        this.dummy.position.copy(particle.position);
        this.dummy.rotation.copy(particle.rotation);
        this.dummy.scale.setScalar(Math.min(1, particle.life * 2));
      } else {
        this.dummy.scale.setScalar(0);
      }
      this.dummy.updateMatrix();
      mesh.setMatrixAt(index, this.dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (!alive) this.particles = null;
  }

  private director(): void {
    if (reducedMotion()) return;
    if (this.talking) {
      if (this.time > this.nextTalkGestureAt && !this.clipBusy && (!this.moveNow || this.isGesture(this.moveNow.name))) {
        if (!this.moveNow || this.time - this.moveNow.start > 1) this.setMove(pick([["explainR", 3], ["explainL", 2], ["explainBoth", 2], ["point", 1], ["nodYes", 1]]));
        this.nextTalkGestureAt = this.time + rand(1.6, 2.6);
      }
      return;
    }
    if (this.thinking || this.clipBusy || this.moveNow || this.walk) return;
    if (this.time < this.nextIdleAt) return;
    if (this.mode === "rest") {
      this.action(pick(REST_ACTIONS));
      this.nextIdleAt = this.time + rand(2.5, 4.5);
      return;
    }
    if (this.demoPattern && Math.random() < 0.35 && this.demo(this.demoPattern)) return;
    const userActive = performance.now() - pointer.at < 6000;
    const options = [...IDLE_ACTIONS[this.key]];
    if (userActive) options.push(["point", 1], ["wave", 1]);
    this.action(pick(options));
    this.nextIdleAt = this.time + (this.mode === "picker" ? rand(4, 8) : rand(3, 6));
  }

  private isGesture(name: string): boolean {
    return ["explainR", "explainL", "explainBoth", "point", "nodYes", "fistPump", "wave", "thumbsUp"].includes(name);
  }

  private moveWeight(move: ActiveMove): number {
    const elapsed = this.time - move.start;
    const fadeIn = smooth(elapsed / 0.35);
    const fadeOut = Number.isFinite(move.def.duration) ? smooth((move.def.duration - elapsed) / 0.4) : 1;
    let weight = fadeIn * fadeOut;
    if (move.endAt !== undefined) weight *= smooth(1 - (this.time - move.endAt) / 0.35);
    return weight;
  }

  private lookTarget(): { x: number; y: number } {
    const looking = [this.moveNow, this.movePrev].find((move) => move?.def.look);
    if (looking?.def.look) {
      const target = looking.def.look(this.time - looking.start);
      const weight = this.moveWeight(looking);
      return { x: target.x * weight, y: target.y * weight };
    }
    if (this.thinking) return { x: 0.35, y: -0.35 };
    if (this.talking) return { x: 0.12 + Math.sin(this.time * 0.7) * 0.12, y: -0.04 + Math.sin(this.time * 1.1) * 0.05 };
    if (performance.now() - pointer.at < 4000) {
      const rect = this.container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const headY = rect.top + rect.height * (this.framing === "full" ? 0.18 : 0.28);
      return {
        x: clamp((pointer.x - centerX) / (Math.max(window.innerWidth, 1) * 0.45), -1, 1) * 0.7,
        y: clamp((pointer.y - headY) / (Math.max(window.innerHeight, 1) * 0.45), -1, 1) * 0.7,
      };
    }
    if (this.time > this.saccade.at) this.saccade = { x: rand(-0.35, 0.35), y: rand(-0.15, 0.1), at: this.time + rand(0.9, 2.6) };
    return { x: this.saccade.x, y: this.saccade.y };
  }

  private rotateModel(bone: THREE.Object3D | undefined, axis: THREE.Vector3, angle: number): void {
    if (!bone || !angle) return;
    tmpAxis.copy(axis).applyQuaternion(tmpModel).normalize();
    tmpDelta.setFromAxisAngle(tmpAxis, angle);
    applyWorldDelta(bone, tmpDelta);
  }

  private applyBody(): void {
    const model = this.model;
    if (!model) return;
    let lift = 0;
    let turn = 0;
    let offsetX = 0;
    if (this.hop) {
      const progress = (this.time - this.hop.start) / this.hop.duration;
      if (progress >= 1) this.hop = null;
      else lift = Math.sin(Math.PI * progress) * this.hop.height * this.height;
    }
    if (this.spin) {
      const progress = (this.time - this.spin.start) / this.spin.duration;
      if (progress >= 1) this.spin = null;
      else turn = Math.PI * 2 * smooth(progress);
    }
    if (this.walk) {
      const progress = (this.time - this.walk.start) / this.walk.duration;
      if (progress >= 1) this.walk = null;
      else {
        const eased = 1 - Math.pow(1 - progress, 2);
        offsetX = this.walk.from * (1 - eased);
        const facing = Math.PI / 2 - this.baseYaw;
        turn = facing * (1 - smooth((progress - 0.65) / 0.35));
      }
    }
    for (const move of [this.movePrev, this.moveNow]) {
      const profile = move ? PROFILE_TURN[move.name] : undefined;
      if (move && profile) turn += profile * this.moveWeight(move);
    }
    const sway = reducedMotion() || this.walk ? 0 : Math.sin(this.time * 0.55) * 0.012 * this.height;
    model.position.set(this.baseX + offsetX + sway, this.baseY + lift, 0);
    model.rotation.y = this.baseYaw + turn + (reducedMotion() ? 0 : Math.sin(this.time * 0.37) * 0.04);
    const squash = lift > 0 ? 1 + (lift / this.height) * 0.6 : 1;
    model.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    if (this.shadow) {
      this.shadow.scale.setScalar(Math.max(0.2, 1 - (lift / this.height) * 2.5));
      this.shadow.position.x = model.position.x;
    }
    model.updateMatrixWorld(true);
  }

  private applyIdleLife(): void {
    if (reducedMotion()) return;
    const t = this.time;
    const breath = Math.sin(t * 1.8);
    this.rotateModel(this.bones.Torso, AXIS_X, breath * 0.014);
    this.rotateModel(this.bones.ShoulderL, AXIS_Z, breath * 0.012);
    this.rotateModel(this.bones.ShoulderR, AXIS_Z, -breath * 0.012);
    const shift = Math.sin(t * 0.55);
    this.rotateModel(this.bones.Hips, AXIS_Z, shift * 0.03);
    this.rotateModel(this.bones.Abdomen, AXIS_Z, -shift * 0.022);
    this.rotateModel(this.bones.Head, AXIS_Z, -shift * 0.012);
  }

  private applyLook(delta: number): void {
    const target = this.lookTarget();
    const ease = 1 - Math.exp(-delta * 7);
    this.look.x += (target.x - this.look.x) * ease;
    this.look.y += (target.y - this.look.y) * ease;
    const wantWeight = this.clipBusy || this.spin || this.walk ? 0.25 : 1;
    this.look.weight += (wantWeight - this.look.weight) * (1 - Math.exp(-delta * 5));
    const yaw = (this.look.x * 0.85 - this.baseYaw * 0.8) * this.look.weight;
    const pitch = clamp(this.look.y * 0.5, -0.35, 0.45) * this.look.weight;
    const share: [BoneName, number][] = [["Torso", 0.22], ["Neck", 0.3], ["Head", 0.48]];
    for (const [name, part] of share) {
      const bone = this.bones[name];
      if (!bone) continue;
      tmpDelta.setFromAxisAngle(AXIS_Y, yaw * part);
      applyWorldDelta(bone, tmpDelta);
      tmpDelta.setFromAxisAngle(AXIS_X, pitch * part);
      applyWorldDelta(bone, tmpDelta);
    }
  }

  private applyMoves(): number {
    if (this.movePrev?.endAt !== undefined && this.time - this.movePrev.endAt > 0.4) this.movePrev = null;
    if (this.moveNow && this.time - this.moveNow.start > this.moveNow.def.duration) {
      this.movePrev = { ...this.moveNow, endAt: this.time };
      this.moveNow = null;
    }
    if (this.clipBusy || !this.model) return 0;
    if (!this.moveNow && !this.movePrev && !this.hop) {
      const right = this.footY(this.bones.UpperLegR, this.bones.LowerLegR);
      const left = this.footY(this.bones.UpperLegL, this.bones.LowerLegL);
      if (right !== null && left !== null) this.footRest = Math.min(right, left) - this.model.position.y;
    }
    this.model.getWorldQuaternion(tmpModel);
    const bones = this.bones;
    let groundWeight = 0;
    let liftTotal = 0;
    for (const move of [this.movePrev, this.moveNow]) {
      if (!move) continue;
      const weight = this.moveWeight(move);
      if (weight <= 0.001) continue;
      const pose = move.def.pose(this.time - move.start);
      if (pose.lean) {
        this.rotateModel(bones.Abdomen, AXIS_X, pose.lean * weight * 0.45);
        this.rotateModel(bones.Torso, AXIS_X, pose.lean * weight * 0.55);
      }
      if (pose.side) this.rotateModel(bones.Torso, AXIS_Z, pose.side * weight);
      if (pose.twist) this.rotateModel(bones.Torso, AXIS_Y, pose.twist * weight);
      if (pose.tilt) this.rotateModel(bones.Head, AXIS_Z, pose.tilt * weight);
      if (pose.nod) this.rotateModel(bones.Head, AXIS_X, pose.nod * weight);
      if (pose.shake) this.rotateModel(bones.Head, AXIS_Y, pose.shake * weight);
      const limbs: [Pair | undefined, BoneName, BoneName, BoneName | null][] = [
        [pose.R, "UpperArmR", "LowerArmR", "PalmR"],
        [pose.L, "UpperArmL", "LowerArmL", "PalmL"],
        [pose.RL, "UpperLegR", "LowerLegR", null],
        [pose.LL, "UpperLegL", "LowerLegL", null],
      ];
      for (const [pair, upper, lower, end] of limbs) {
        if (!pair) continue;
        tmpTarget.copy(pair[0]).applyQuaternion(tmpModel);
        aimBone(bones[upper], bones[lower], tmpTarget.clone(), weight);
        tmpTarget.copy(pair[1]).applyQuaternion(tmpModel);
        aimBone(bones[lower], end ? bones[end] : undefined, tmpTarget.clone(), weight);
      }
      if (pose.ground) groundWeight = Math.max(groundWeight, weight);
      if (pose.lift) liftTotal += pose.lift * weight;
    }
    if (groundWeight > 0.001) this.groundFeet(groundWeight);
    return liftTotal;
  }

  private footY(upper: THREE.Object3D | undefined, lower: THREE.Object3D | undefined): number | null {
    if (!upper || !lower) return null;
    upper.getWorldPosition(tmpFrom);
    lower.getWorldPosition(tmpTo);
    const length = tmpFrom.distanceTo(tmpTo);
    lower.getWorldQuaternion(tmpParent);
    return tmpTo.y + tmpAxis.copy(AXIS_Y).applyQuaternion(tmpParent).y * length;
  }

  private groundFeet(weight: number): void {
    const model = this.model;
    const right = this.footY(this.bones.UpperLegR, this.bones.LowerLegR);
    const left = this.footY(this.bones.UpperLegL, this.bones.LowerLegL);
    if (!model || right === null || left === null) return;
    const lowest = Math.min(right, left);
    if (this.footRest === null) return;
    const target = this.footRest + this.baseY;
    const offset = (target - lowest) * weight;
    if (Math.abs(offset) < 1e-5) return;
    model.position.y += offset;
    model.updateMatrixWorld(true);
  }

  private update(): void {
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.05);
    if (!this.visible || !this.mixer || !this.renderer || !this.scene || !this.camera || !this.model) return;
    this.time += delta;
    const due = this.timers.filter((timer) => timer.at <= this.time);
    if (due.length) {
      this.timers = this.timers.filter((timer) => timer.at > this.time);
      due.forEach((timer) => {
        timer.fn();
      });
    }
    this.director();
    if (this.saved) this.touched.forEach((bone, index) => bone.quaternion.copy(this.saved![index]!));
    this.mixer.update(delta);
    this.saved = this.touched.map((bone) => bone.quaternion.clone());
    this.applyBody();
    this.model.getWorldQuaternion(tmpModel);
    this.applyIdleLife();
    this.applyLook(delta);
    const lift = this.applyMoves();
    if (lift) {
      this.model.position.y += lift * this.height;
      this.model.updateMatrixWorld(true);
    }
    const head = this.bones.Head;
    if (head) {
      this.beatImpulse *= Math.exp(-delta * 6);
      const nod = this.talking ? Math.sin(this.time * 7.5) * 0.05 + Math.sin(this.time * 3.1) * 0.025 : 0;
      const turn = this.talking ? Math.sin(this.time * 1.7) * 0.06 : 0;
      head.rotateX(nod + this.beatImpulse * 0.14);
      head.rotateY(turn);
      head.updateMatrixWorld(true);
    }
    const torso = this.bones.Torso;
    if (torso && this.talking) torso.rotateY(Math.sin(this.time * 1.3) * 0.035);
    if (this.rim) this.rim.intensity = 2.4 + this.beatImpulse * 1.5;
    this.updateConfetti(delta);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    this.container.removeEventListener("pointerenter", this.onEnter);
    this.mixer?.stopAllAction();
    if (this.confettiMesh) {
      this.confettiMesh.geometry.dispose();
      (this.confettiMesh.material as THREE.Material).dispose();
    }
    if (this.shadow) {
      this.shadow.geometry.dispose();
      const material = this.shadow.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    }
    if (this.model) {
      this.model.parent?.remove(this.model);
      this.model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const materials = (Array.isArray(node.material) ? node.material : [node.material]) as THREE.Material[];
        materials.forEach((material) => {
          material.dispose();
        });
      });
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    }
  }
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
