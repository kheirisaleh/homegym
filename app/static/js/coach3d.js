import * as THREE from "../vendor/three/three.module.min.js?v=cycle2";
import { GLTFLoader } from "../vendor/three/addons/loaders/GLTFLoader.js?v=cycle2";
import { clone as cloneSkinned } from "../vendor/three/addons/utils/SkeletonUtils.js?v=cycle2";
import { esc } from "./core.js?v=cycle2";

const MODELS = { max: "/static/coach/max.glb", lena: "/static/coach/lena.glb" };
const OUTFITS = {
  max: { Shirt: "#d93a3f", Pants: "#22262c", Socks: "#f2f2f2" },
  lena: { Shirt: "#3f7bf2", Pants: "#22262c", Shoes: "#f2f2f2" },
};
const cache = {};
const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function loadModel(key) {
  const url = MODELS[key] || MODELS.max;
  if (!cache[url]) cache[url] = new Promise((resolve, reject) => new GLTFLoader().load(url, resolve, undefined, reject));
  return cache[url];
}

export function preloadCoach(key) {
  loadModel(key).catch(() => {});
}

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch (error) {
    return false;
  }
}

function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export const COACHES = {
  max: { key: "max", name: "Max", title: "Strength coach", color: "#d93a3f", style: "Direct, energetic, a bit of humor. Pushes you to beat last week." },
  lena: { key: "lena", name: "Lena", title: "Performance coach", color: "#3f7bf2", style: "Warm, precise, technique first. Makes every rep count." },
};

const pointer = { x: 0, y: 0, at: -1e9 };
let pointerBound = false;
function bindPointer() {
  if (pointerBound) return;
  pointerBound = true;
  const track = (event) => {
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
const identity = new THREE.Quaternion();
const tmpParent = new THREE.Quaternion();
const tmpDelta = new THREE.Quaternion();
const tmpLocal = new THREE.Quaternion();
const tmpBlend = new THREE.Quaternion();
const tmpModel = new THREE.Quaternion();
const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();

function applyWorldDelta(bone, delta) {
  bone.parent.getWorldQuaternion(tmpParent);
  tmpLocal.copy(tmpParent).invert().multiply(delta).multiply(tmpParent);
  bone.quaternion.premultiply(tmpLocal);
  bone.updateMatrixWorld(true);
}

function rotateWorld(bone, axis, angle) {
  if (!bone || !angle) return;
  tmpDelta.setFromAxisAngle(axis, angle);
  applyWorldDelta(bone, tmpDelta);
}

function aimBone(bone, child, direction, weight) {
  if (!bone || !child || weight <= 0.001) return;
  bone.getWorldPosition(tmpFrom);
  child.getWorldPosition(tmpTo);
  tmpTo.sub(tmpFrom);
  if (tmpTo.lengthSq() < 1e-10) return;
  tmpTo.normalize();
  tmpDelta.setFromUnitVectors(tmpTo, direction);
  if (weight < 1) {
    tmpBlend.copy(identity).slerp(tmpDelta, weight);
    tmpDelta.copy(tmpBlend);
  }
  applyWorldDelta(bone, tmpDelta);
}

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = (value) => {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
};
const vec = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const mirror = (pair) => pair.map((item) => vec(-item.x, item.y, item.z));

function pick(list) {
  const total = list.reduce((sum, item) => sum + item[1], 0);
  let roll = Math.random() * total;
  for (const item of list) {
    roll -= item[1];
    if (roll <= 0) return item[0];
  }
  return list[0][0];
}

const GESTURES = {
  wave: {
    duration: 2.4,
    pose: (t) => ({ R: [vec(-0.55, 0.8, 0.25), vec(-0.1 + Math.sin(t * 11) * 0.55, 1, 0.3)], tilt: 0.12 }),
  },
  flex: {
    duration: 2.6,
    pose: (t) => {
      const pulse = Math.sin(t * 7) * 0.08;
      const right = [vec(-1, 0.12 + pulse, 0.15), vec(-0.12, 1, 0.3)];
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
      const right = [vec(-0.2, 1, 0.02), vec(-0.05, 1, 0)];
      return { R: right, L: mirror(right), side: Math.sin(t * 1.9) * 0.2, nod: -0.12 };
    },
  },
  think: {
    duration: Infinity,
    pose: (t) => ({ R: [vec(-0.12, -0.6, 0.75), vec(0.4, 0.85, 0.35)], tilt: 0.16 + Math.sin(t * 1.3) * 0.04, nod: -0.1 }),
  },
  victory: {
    duration: 1.9,
    pose: (t) => {
      const shake = Math.sin(t * 14) * 0.12;
      const right = [vec(-0.5, 1, 0.1), vec(-0.35 + shake, 1, 0.1)];
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
      const right = [vec(-0.35, -0.7, 0.55), vec(-0.45 - open, 0.2, 1)];
      return { R: right, L: mirror(right), lean: 0.04 };
    },
  },
  lookAround: {
    duration: 2.8,
    pose: () => ({}),
    look: (t) => ({ x: Math.sin(t * 2.3) * 0.95, y: -0.12 }),
  },
};

const IDLE_ACTIONS = {
  max: [["flex", 3], ["shadowbox", 3], ["fistPump", 1], ["lookAround", 2], ["stretch", 1], ["wave", 1]],
  lena: [["stretch", 3], ["jump", 2], ["thumbsUp", 2], ["lookAround", 2], ["flex", 1], ["wave", 1]],
};
const TALK_START = { push: "fistPump", celebrate: "clap", easy: "wave", focused: "point" };
const TALK_END = { push: "flex", celebrate: "celebrate", easy: "thumbsUp", focused: "thumbsUp" };

class CoachStage {
  constructor(container, key, color, framing) {
    this.container = container;
    this.key = key;
    this.color = color;
    this.framing = framing || "portrait";
    this.talking = false;
    this.disposed = false;
    this.ready = false;
    this.visible = true;
    this.queue = [];
    this.timers = [];
    this.time = 0;
    this.look = { x: 0, y: 0, weight: 1 };
    this.saccade = { x: 0, y: 0, at: 0 };
    this.gestureNow = null;
    this.gesturePrev = null;
    this.effects = { hop: null, spin: null };
    this.beatImpulse = 0;
    this.nextIdleAt = rand(3, 6);
    this.nextTalkGestureAt = 0;
    this.lastHover = -10;
    this.clock = new THREE.Clock();
    bindPointer();
  }

  async init() {
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
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(this.color), 2.4);
    rim.position.set(-3, 3, -4);
    scene.add(rim);
    this.rim = rim;

    const model = cloneSkinned(gltf.scene);
    this.baseYaw = this.framing === "full" ? -0.18 : -0.32;
    model.rotation.set(0, this.baseYaw, 0);
    model.position.set(0, 0, 0);
    model.scale.setScalar(1);
    const outfit = OUTFITS[this.key] || {};
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.frustumCulled = false;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const updated = materials.map((material) => {
        if (!material) return material;
        const copy = material.clone();
        if (outfit[material.name]) copy.color = new THREE.Color(outfit[material.name]);
        copy.roughness = Math.max(0.55, copy.roughness ?? 0.8);
        copy.metalness = 0;
        return copy;
      });
      node.material = Array.isArray(node.material) ? updated : updated[0];
    });
    scene.add(model);
    this.model = model;

    model.updateMatrixWorld(true);
    model.traverse((node) => { if (node.isSkinnedMesh) node.skeleton.update(); });
    const box = new THREE.Box3().setFromObject(model, true);
    if (box.isEmpty() || !isFinite(box.min.y)) box.setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const height = size.y || 2;
    model.position.y = -box.min.y;
    this.baseY = model.position.y;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(height * 0.7, height * 0.7), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.001;
    scene.add(shadow);
    this.shadow = shadow;

    this.camera = new THREE.PerspectiveCamera(28, 1, height * 0.05, height * 20);
    this.height = height;
    this.frame();

    this.bones = {};
    const wanted = ["Torso", "Neck", "Head", "UpperArm.L", "LowerArm.L", "Palm.L", "UpperArm.R", "LowerArm.R", "Palm.R"];
    model.traverse((node) => {
      if (node.isBone && wanted.includes(node.name)) this.bones[node.name] = node;
    });
    this.touched = Object.values(this.bones);
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = {};
    for (const clip of gltf.animations) {
      const name = clip.name.split("|").pop().replace(/^(Man|Female)_/, "");
      this.clips[name] = clip;
    }
    this.play("Idle", true);
    this.resizeObserver = new ResizeObserver(() => this.frame());
    this.resizeObserver.observe(this.container);
    if (window.IntersectionObserver) {
      this.intersection = new IntersectionObserver((entries) => {
        this.visible = entries.some((entry) => entry.isIntersecting);
      });
      this.intersection.observe(this.container);
    }
    this.onEnter = () => this.hover();
    this.container.addEventListener("pointerenter", this.onEnter);
    this.ready = true;
    const queued = this.queue.splice(0);
    queued.forEach((fn) => fn());
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.update();
    };
    loop();
  }

  run(fn) {
    if (this.disposed) return;
    if (this.ready) fn();
    else this.queue.push(fn);
  }

  later(seconds, fn) {
    this.timers.push({ at: this.time + seconds, fn });
  }

  frame() {
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

  play(name, loop, then) {
    const clip = this.clips[name];
    if (!clip) {
      if (then) then();
      return false;
    }
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, 0.3, false);
    action.play();
    this.current = action;
    this.clipBusy = name !== "Idle";
    if (!loop) {
      const onFinish = (event) => {
        if (event.action !== action) return;
        this.mixer.removeEventListener("finished", onFinish);
        if (then) then();
      };
      this.mixer.addEventListener("finished", onFinish);
    }
    return true;
  }

  playClip(names, then) {
    this.setGesture(null);
    const chain = names.filter((name) => this.clips[name]);
    const next = () => {
      const name = chain.shift();
      if (!name) {
        this.play("Idle", true);
        if (then) then();
        return;
      }
      this.play(name, false, next);
    };
    next();
  }

  setGesture(name) {
    if (this.gestureNow) this.gesturePrev = { ...this.gestureNow, endAt: this.time };
    this.gestureNow = name && GESTURES[name] ? { name, def: GESTURES[name], start: this.time } : null;
  }

  hop(height, duration) {
    this.effects.hop = { start: this.time, height, duration };
  }

  spin(duration) {
    this.effects.spin = { start: this.time, duration };
  }

  pulse() {
    const element = this.container;
    element.classList.remove("coach-pulse");
    void element.offsetWidth;
    element.classList.add("coach-pulse");
  }

  action(name) {
    this.run(() => {
      if (name === "celebrate") {
        this.setGesture("victory");
        if (!reducedMotion) {
          this.spin(1.1);
          this.hop(0.07, 0.55);
          this.later(0.25, () => this.confetti());
        }
        this.pulse();
        this.later(1.9, () => this.playClip(["Clapping"]));
      } else if (name === "clap") {
        this.pulse();
        this.playClip(["Clapping"]);
      } else if (name === "shadowbox") {
        this.playClip(["Punch", "Punch"]);
      } else if (name === "jump") {
        this.playClip(["Jump"]);
      } else if (name === "wave") {
        this.setGesture("wave");
        this.hop(0.025, 0.35);
      } else {
        this.setGesture(name);
      }
    });
  }

  intro() {
    this.run(() => {
      this.hop(0.05, 0.5);
      this.later(0.15, () => this.action("wave"));
      this.nextIdleAt = this.time + rand(5, 8);
    });
  }

  greet() {
    this.run(() => {
      const options = this.key === "max" ? [["celebrate", 2], ["shadowbox", 2], ["flex", 2]] : [["celebrate", 2], ["jump", 2], ["thumbsUp", 1], ["wave", 1]];
      this.action(pick(options));
      this.nextIdleAt = this.time + rand(6, 9);
    });
  }

  hover() {
    this.run(() => {
      if (this.talking || this.thinking || this.clipBusy) return;
      if (this.time - this.lastHover < 8) return;
      this.lastHover = this.time;
      this.action("wave");
      this.nextIdleAt = this.time + rand(5, 8);
    });
  }

  think() {
    this.run(() => {
      this.thinking = true;
      this.setGesture("think");
    });
  }

  talk(mood) {
    this.run(() => {
      this.thinking = false;
      this.talking = true;
      this.action(TALK_START[mood] || "point");
      this.nextTalkGestureAt = this.time + rand(2.2, 2.8);
    });
  }

  finish(mood) {
    this.run(() => {
      this.talking = false;
      this.action(TALK_END[mood] || "thumbsUp");
      this.nextIdleAt = this.time + rand(6, 9);
    });
  }

  beat(strength) {
    if (!this.ready) return;
    this.beatImpulse = Math.min(1.2, this.beatImpulse + strength);
  }

  confetti() {
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
        color.set(palette[index % palette.length]);
        mesh.setColorAt(index, color);
      }
      mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
      this.confettiMesh = mesh;
      this.dummy = new THREE.Object3D();
    }
    this.particles = Array.from({ length: count }, () => ({
      position: new THREE.Vector3(rand(-0.12, 0.12) * h, h * rand(0.72, 0.85), rand(0, 0.15) * h),
      velocity: new THREE.Vector3(rand(-0.9, 0.9) * h, rand(1.1, 2.1) * h, rand(0.1, 0.9) * h),
      rotation: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
      spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
      life: rand(1.8, 2.8),
    }));
  }

  updateConfetti(delta) {
    if (!this.particles || !this.confettiMesh) return;
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
      this.confettiMesh.setMatrixAt(index, this.dummy.matrix);
    });
    this.confettiMesh.instanceMatrix.needsUpdate = true;
    if (!alive) this.particles = null;
  }

  director() {
    if (reducedMotion) return;
    if (this.talking) {
      if (this.time > this.nextTalkGestureAt && !this.clipBusy) {
        if (!this.gestureNow || this.time - this.gestureNow.start > 1) this.setGesture(pick([["explainR", 3], ["explainL", 2], ["explainBoth", 2], ["point", 1]]));
        this.nextTalkGestureAt = this.time + rand(1.6, 2.6);
      }
      return;
    }
    if (this.thinking || this.clipBusy || this.gestureNow) return;
    if (this.time < this.nextIdleAt) return;
    const userActive = performance.now() - pointer.at < 6000;
    const options = (IDLE_ACTIONS[this.key] || IDLE_ACTIONS.max).slice();
    if (userActive) options.push(["point", 1], ["wave", 1]);
    this.action(pick(options));
    this.nextIdleAt = this.time + rand(6, 11);
  }

  gestureWeight(gesture) {
    const elapsed = this.time - gesture.start;
    const fadeIn = smooth(elapsed / 0.35);
    const fadeOut = isFinite(gesture.def.duration) ? smooth((gesture.def.duration - elapsed) / 0.4) : 1;
    let weight = fadeIn * fadeOut;
    if (gesture.endAt !== undefined) weight *= smooth(1 - (this.time - gesture.endAt) / 0.35);
    return weight;
  }

  lookTarget() {
    const gestures = [this.gestureNow, this.gesturePrev].filter((gesture) => gesture && gesture.def.look);
    if (gestures.length) {
      const gesture = gestures[0];
      const target = gesture.def.look(this.time - gesture.start);
      const weight = this.gestureWeight(gesture);
      return { x: target.x * weight, y: target.y * weight };
    }
    if (this.thinking) return { x: 0.35, y: -0.35 };
    if (performance.now() - pointer.at < 5000) {
      const rect = this.container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const headY = rect.top + rect.height * (this.framing === "full" ? 0.18 : 0.28);
      return {
        x: clamp((pointer.x - centerX) / (Math.max(window.innerWidth, 1) * 0.45), -1, 1),
        y: clamp((pointer.y - headY) / (Math.max(window.innerHeight, 1) * 0.45), -1, 1),
      };
    }
    if (this.time > this.saccade.at) {
      this.saccade = { x: rand(-0.22, 0.22), y: rand(-0.15, 0.08), at: this.time + rand(1.2, 3.2) };
    }
    return { x: this.saccade.x, y: this.saccade.y };
  }

  applyBody() {
    const model = this.model;
    let lift = 0;
    let turn = 0;
    const hop = this.effects.hop;
    if (hop) {
      const progress = (this.time - hop.start) / hop.duration;
      if (progress >= 1) this.effects.hop = null;
      else lift = Math.sin(Math.PI * progress) * hop.height * this.height;
    }
    const spin = this.effects.spin;
    if (spin) {
      const progress = (this.time - spin.start) / spin.duration;
      if (progress >= 1) this.effects.spin = null;
      else turn = Math.PI * 2 * smooth(progress);
    }
    model.position.y = this.baseY + lift;
    model.rotation.y = this.baseYaw + turn;
    const squash = lift > 0 ? 1 + (lift / this.height) * 0.6 : 1;
    model.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    if (this.shadow) this.shadow.scale.setScalar(1 - (lift / this.height) * 2.5);
    model.updateMatrixWorld(true);
  }

  applyLook(delta) {
    const target = this.lookTarget();
    const ease = 1 - Math.exp(-delta * 7);
    this.look.x += (target.x - this.look.x) * ease;
    this.look.y += (target.y - this.look.y) * ease;
    const wantWeight = this.clipBusy || this.effects.spin ? 0.25 : 1;
    this.look.weight += (wantWeight - this.look.weight) * (1 - Math.exp(-delta * 5));
    const yaw = (this.look.x * 0.85 - this.baseYaw * 0.8) * this.look.weight;
    const pitch = clamp(this.look.y * 0.5, -0.35, 0.45) * this.look.weight;
    const share = [["Torso", 0.22], ["Neck", 0.3], ["Head", 0.48]];
    for (const [name, part] of share) {
      const bone = this.bones[name];
      rotateWorld(bone, AXIS_Y, yaw * part);
      rotateWorld(bone, AXIS_X, pitch * part);
    }
  }

  applyGestures() {
    const gestures = [this.gesturePrev, this.gestureNow].filter(Boolean);
    if (this.gesturePrev && this.time - this.gesturePrev.endAt > 0.4) this.gesturePrev = null;
    if (this.gestureNow && this.time - this.gestureNow.start > this.gestureNow.def.duration) {
      this.gesturePrev = { ...this.gestureNow, endAt: this.time };
      this.gestureNow = null;
    }
    if (this.clipBusy) return;
    this.model.getWorldQuaternion(tmpModel);
    const bones = this.bones;
    for (const gesture of gestures) {
      const weight = this.gestureWeight(gesture);
      if (weight <= 0.001) continue;
      const pose = gesture.def.pose(this.time - gesture.start);
      if (pose.lean) rotateWorld(bones.Torso, AXIS_X, pose.lean * weight);
      if (pose.side) rotateWorld(bones.Torso, AXIS_Z, pose.side * weight);
      if (pose.twist) rotateWorld(bones.Torso, AXIS_Y, pose.twist * weight);
      if (pose.tilt) rotateWorld(bones.Head, AXIS_Z, pose.tilt * weight);
      if (pose.nod) rotateWorld(bones.Head, AXIS_X, pose.nod * weight);
      for (const side of ["R", "L"]) {
        const arm = pose[side];
        if (!arm) continue;
        tmpTarget.copy(arm[0]).applyQuaternion(tmpModel);
        aimBone(bones["UpperArm." + side], bones["LowerArm." + side], tmpTarget.clone(), weight);
        tmpTarget.copy(arm[1]).applyQuaternion(tmpModel);
        aimBone(bones["LowerArm." + side], bones["Palm." + side], tmpTarget.clone(), weight);
      }
    }
  }

  update() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (!this.visible) return;
    this.time += delta;
    const due = this.timers.filter((timer) => timer.at <= this.time);
    if (due.length) {
      this.timers = this.timers.filter((timer) => timer.at > this.time);
      due.forEach((timer) => timer.fn());
    }
    this.director();
    if (this.saved) this.touched.forEach((bone, index) => bone.quaternion.copy(this.saved[index]));
    this.mixer.update(delta);
    this.saved = this.touched.map((bone) => bone.quaternion.clone());
    this.applyBody();
    const torso = this.bones.Torso;
    if (torso) rotateWorld(torso, AXIS_X, Math.sin(this.time * 1.8) * 0.012);
    this.applyLook(delta);
    this.applyGestures();
    const head = this.bones.Head;
    if (head) {
      this.beatImpulse *= Math.exp(-delta * 6);
      const nod = this.talking ? Math.sin(this.time * 7.5) * 0.05 + Math.sin(this.time * 3.1) * 0.025 : 0;
      const turn = this.talking ? Math.sin(this.time * 1.7) * 0.06 : 0;
      head.rotateX(nod + this.beatImpulse * 0.14);
      head.rotateY(turn);
      head.updateMatrixWorld(true);
    }
    if (torso && this.talking) torso.rotateY(Math.sin(this.time * 1.3) * 0.035);
    if (this.rim) this.rim.intensity = 2.4 + this.beatImpulse * 1.5;
    this.updateConfetti(delta);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.intersection) this.intersection.disconnect();
    if (this.onEnter) this.container.removeEventListener("pointerenter", this.onEnter);
    if (this.mixer) this.mixer.stopAllAction();
    if (this.confettiMesh) {
      this.confettiMesh.geometry.dispose();
      this.confettiMesh.material.dispose();
    }
    if (this.model) {
      if (this.model.parent) this.model.parent.remove(this.model);
      this.model.traverse((node) => {
        if (!node.isMesh) return;
        (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => material && material.dispose());
      });
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    }
  }
}

export function mountCoachStage(container, key, options = {}) {
  const coach = COACHES[key] || COACHES.max;
  container.classList.add("coach-mini");
  container.style.setProperty("--coach-color", coach.color);
  container.innerHTML = '<div class="coach-fallback"><span style="background:' + coach.color + '">' + coach.name[0] + "</span></div>";
  let stage = null;
  if (webglAvailable()) {
    stage = new CoachStage(container, coach.key, coach.color, options.framing || "full");
    stage.init().then(() => {
      if (!stage.disposed) container.classList.add("ready");
    }).catch(() => { stage = null; });
    if (options.intro !== false) stage.intro();
  }
  return {
    greet() { if (stage) stage.greet(); },
    action(name) { if (stage) stage.action(name); },
    dispose() { if (stage) stage.dispose(); },
  };
}

export function coachPicker(root, current, onPick) {
  root.classList.add("coach-picker");
  root.innerHTML = Object.values(COACHES).map((coach) =>
    '<button type="button" class="coach-pick" data-coach="' + coach.key + '" aria-pressed="' + (current === coach.key) + '" style="--coach-color:' + coach.color + '">' +
    '<div class="coach-pick-stage"></div><div class="coach-pick-text"><b>' + esc(coach.name) + "</b><span>" + esc(coach.title) + "</span><small>" + esc(coach.style) + "</small></div>" +
    '<span class="coach-pick-badge">Your coach</span></button>').join("");
  const stages = {};
  root.querySelectorAll("[data-coach]").forEach((button) => {
    stages[button.dataset.coach] = mountCoachStage(button.querySelector(".coach-pick-stage"), button.dataset.coach);
    button.addEventListener("click", () => {
      root.querySelectorAll("[data-coach]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      stages[button.dataset.coach].action("celebrate");
      if (onPick) onPick(button.dataset.coach);
    });
  });
  return {
    dispose() { Object.values(stages).forEach((stage) => stage.dispose()); },
  };
}

function typeText(element, text, onDone, onTick) {
  if (reducedMotion) {
    element.textContent = text;
    onDone();
    return () => {};
  }
  let index = 0;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    const chunk = text.slice(index, Math.min(text.length, index + 2));
    index = Math.min(text.length, index + 2);
    element.textContent = text.slice(0, index);
    if (onTick) onTick(chunk);
    if (index < text.length) setTimeout(step, /[.!?]/.test(chunk) ? 180 : /,/.test(chunk) ? 90 : 22);
    else onDone();
  };
  step();
  return () => {
    if (stopped) return;
    stopped = true;
    element.textContent = text;
    onDone();
  };
}

export function openCoach(options) {
  const persona = options.persona || { coach: "max", name: "Max", title: "Strength coach", color: "#e5484d" };
  const overlay = document.createElement("div");
  overlay.className = "coach-overlay";
  overlay.style.setProperty("--coach-color", persona.color || "#e5484d");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML =
    '<div class="coach-stage" aria-hidden="true"><div class="coach-fallback"><span>' + esc((persona.name || "C").slice(0, 1)) + "</span></div></div>" +
    '<div class="coach-card">' +
    '<div class="coach-tag"><b class="coach-name">' + esc(persona.name || "Coach") + '</b><span class="coach-title">' + esc(persona.title || "") + "</span></div>" +
    '<h2 class="coach-heading"></h2>' +
    '<p class="coach-text"><span class="coach-dots"><i></i><i></i><i></i></span></p>' +
    '<ul class="coach-points"></ul>' +
    '<div class="coach-extra"></div>' +
    '<div class="coach-actions">' +
    (options.secondary ? '<button class="btn" data-secondary>' + esc(options.secondary) + "</button>" : "") +
    '<button class="btn primary" data-primary>' + esc(options.primary || "Continue") + "</button></div></div>";
  document.body.appendChild(overlay);
  document.body.classList.add("coach-open");
  requestAnimationFrame(() => overlay.classList.add("show"));

  let stage = null;
  let finishTyping = () => {};
  let closed = false;
  const stageElement = overlay.querySelector(".coach-stage");
  if (webglAvailable()) {
    stage = new CoachStage(stageElement, persona.coach || "max", persona.color || "#e5484d", "portrait");
    stage.init().then(() => {
      if (!closed) stageElement.classList.add("ready");
    }).catch(() => { stage = null; });
    if (!options.message && options.load) {
      stage.intro();
      stage.later(1.2, () => { if (!stage.talking) stage.think(); });
    }
  }

  const close = () => {
    if (closed) return;
    closed = true;
    finishTyping();
    overlay.classList.remove("show");
    document.body.classList.remove("coach-open");
    setTimeout(() => {
      if (stage) stage.dispose();
      overlay.remove();
    }, 250);
  };

  const show = (message) => {
    if (closed) return;
    if (message.persona && message.persona.name) {
      overlay.querySelector(".coach-name").textContent = message.persona.name;
      overlay.querySelector(".coach-title").textContent = message.persona.title || "";
    }
    overlay.querySelector(".coach-heading").textContent = message.title || "";
    const text = overlay.querySelector(".coach-text");
    const points = overlay.querySelector(".coach-points");
    points.innerHTML = "";
    const mood = message.mood || "focused";
    if (stage) stage.talk(mood);
    let finished = false;
    finishTyping = typeText(text, message.message || "", () => {
      if (finished) return;
      finished = true;
      if (stage && !closed) stage.finish(mood);
      points.innerHTML = (message.points || []).map((point) => "<li>" + esc(point) + "</li>").join("");
      points.classList.add("show");
    }, (chunk) => {
      if (!stage) return;
      if (/[.!?]/.test(chunk)) stage.beat(0.9);
      else if (/,/.test(chunk)) stage.beat(0.4);
      else if (/ /.test(chunk) && Math.random() < 0.12) stage.beat(0.25);
    });
  };

  overlay.querySelector("[data-primary]").addEventListener("click", () => {
    close();
    if (options.onPrimary) options.onPrimary();
  });
  const secondary = overlay.querySelector("[data-secondary]");
  if (secondary) secondary.addEventListener("click", () => {
    close();
    if (options.onSecondary) options.onSecondary();
  });
  overlay.querySelector(".coach-card").addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    finishTyping();
  });
  stageElement.addEventListener("click", () => { if (stage) stage.greet(); });

  const api = {
    close,
    show,
    setExtra(html) { overlay.querySelector(".coach-extra").innerHTML = html; },
    element: overlay,
  };
  if (options.extraHtml) api.setExtra(options.extraHtml);
  if (options.message) {
    if (stage) stage.intro();
    setTimeout(() => show(options.message), stage ? 900 : 0);
  } else if (options.load) {
    const started = Date.now();
    options.load().then((message) => {
      const wait = Math.max(0, 1200 - (Date.now() - started));
      setTimeout(() => show(message), wait);
    }).catch(() => {
      show(options.fallback || { title: "Let's go", message: "Your coach could not be reached right now, but your plan is ready. Train with focus and log every set.", points: [], mood: "focused" });
    });
  }
  return api;
}
