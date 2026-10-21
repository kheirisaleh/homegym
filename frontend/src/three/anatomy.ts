import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URLS: Record<string, string> = {
  male: "/static/models/full-body-male-mobile.glb",
  female: "/static/models/full-body-female-mobile.glb",
};

const KEY_MAP: Record<string, string> = {
  deltoid_anterior: "front_delts",
  deltoid_lateral: "side_delts",
  deltoid_posterior: "rear_delts",
  brachialis: "biceps",
  coracobrachialis: "biceps",
  teres_major: "lats",
  serratus_anterior: "obliques",
};

const GROUP_MAP: Record<string, string> = {
  Chest: "chest",
  Triceps: "triceps",
  Biceps: "biceps",
  Forearms: "forearms",
  Lats: "lats",
  "Teres major": "lats",
  Trapezius: "upper_back",
  "Upper back": "upper_back",
  "Rotator cuff": "upper_back",
  "Lower back": "lower_back",
  "Spinal extensors": "lower_back",
  Abdominals: "abs",
  Obliques: "obliques",
  Serratus: "obliques",
  Quadriceps: "quads",
  Sartorius: "quads",
  Glutes: "glutes",
  "Hip rotators": "glutes",
  Hamstrings: "hamstrings",
  Calves: "calves",
};

export const SELECTABLE_MUSCLES = [
  "chest", "front_delts", "side_delts", "rear_delts", "biceps", "triceps", "forearms", "lats", "upper_back", "lower_back", "abs", "obliques", "glutes", "quads",
  "hamstrings", "calves",
];

export function muscleForNode(data: { key?: string; group?: string } | null | undefined): string | null {
  if (!data?.key) return null;
  return KEY_MAP[data.key] ?? GROUP_MAP[data.group ?? ""] ?? null;
}

const cache: Record<string, Promise<GLTF> | undefined> = {};

function loadModel(sex: string): Promise<GLTF> {
  const url = MODEL_URLS[sex] ?? MODEL_URLS.male!;
  cache[url] ??= new GLTFLoader().loadAsync(url);
  return cache[url];
}

interface Colors {
  muscle: string;
  selected: string;
  hover: string;
  other: string;
}

function readColors(container: HTMLElement): Colors {
  const style = getComputedStyle(container);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    muscle: read("--body-muscle", "#8c5a52"),
    selected: read("--body-selected", "#f2c14e"),
    hover: read("--body-hover", "#e9d9a6"),
    other: read("--body-other", "#55504a"),
  };
}

export interface BodyViewerOptions {
  sex: string;
  selected?: string[];
  interactive?: boolean;
  autoRotate?: boolean;
  labels?: Record<string, string>;
  onToggle?: (muscle: string, on: boolean) => void;
}

export interface BodyViewer {
  setSelected: (list: string[]) => void;
  front: () => void;
  back: () => void;
  setAutoRotate: (on: boolean) => void;
  destroy: () => void;
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function createBodyViewer(container: HTMLElement, options: BodyViewerOptions): BodyViewer | null {
  if (!webglAvailable()) {
    container.textContent = "3D is not available on this device. Use the muscle list instead.";
    return null;
  }
  const interactive = options.interactive !== false;
  const selected = new Set(options.selected ?? []);
  container.classList.add("body-viewer");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "3D muscle model");
  const tip = document.createElement("div");
  tip.className = "body-tip";
  tip.hidden = true;
  const loading = document.createElement("div");
  loading.className = "body-loading";
  loading.textContent = "Loading 3D model";
  container.replaceChildren(canvas, tip, loading);
  const colors = readColors(container);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.5, 2.5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  rim.position.set(-2, 1.5, -3);
  scene.add(rim);

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.8;
  controls.minPolarAngle = Math.PI * 0.2;
  controls.maxPolarAngle = Math.PI * 0.8;
  controls.autoRotate = Boolean(options.autoRotate);
  controls.autoRotateSpeed = 1.6;

  const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  let hovered: string | null = null;
  let disposed = false;
  let frame = 0;

  const paint = () => {
    for (const mesh of meshes) {
      const muscle = mesh.userData.muscle as string | null;
      if (!muscle) {
        mesh.material.color.set(colors.other);
        continue;
      }
      const isSelected = selected.has(muscle);
      mesh.material.color.set(isSelected ? colors.selected : hovered === muscle ? colors.hover : colors.muscle);
      mesh.material.emissive.set(isSelected ? colors.selected : "#000000");
      mesh.material.emissiveIntensity = isSelected ? 0.35 : 0;
    }
  };

  const resize = () => {
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 400;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const render = () => {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };

  loadModel(options.sex).then(
    (gltf) => {
      if (disposed) return;
      const root = gltf.scene.clone(true);
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const data = node.userData as { key?: string; group?: string };
        const muscle = muscleForNode(data);
        node.material = muscle
          ? new THREE.MeshStandardMaterial({ color: colors.muscle, roughness: 0.6, metalness: 0.05 })
          : new THREE.MeshStandardMaterial({ color: colors.other, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
        node.userData = { ...data, muscle };
        meshes.push(node as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>);
      });
      scene.add(root);
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      controls.target.copy(center);
      const distance = (size.y / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.15;
      camera.position.set(center.x, center.y + size.y * 0.04, center.z + distance);
      controls.minDistance = distance * 0.45;
      controls.maxDistance = distance * 1.6;
      paint();
      loading.remove();
      resize();
      render();
    },
    () => {
      loading.textContent = "The 3D model could not be loaded. Use the muscle list instead.";
    },
  );

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pick = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes, false).find((entry) => entry.object.userData.muscle);
    return hit ? (hit.object.userData.muscle as string) : null;
  };

  let downAt: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => {
    downAt = { x: event.clientX, y: event.clientY };
    controls.autoRotate = false;
  };
  const onUp = (event: PointerEvent) => {
    if (!interactive || !downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return;
    const muscle = pick(event);
    if (!muscle) return;
    if (selected.has(muscle)) selected.delete(muscle);
    else selected.add(muscle);
    paint();
    options.onToggle?.(muscle, selected.has(muscle));
  };
  const onMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const muscle = pick(event);
    if (muscle !== hovered) {
      hovered = muscle;
      paint();
      canvas.style.cursor = muscle && interactive ? "pointer" : "grab";
    }
    if (muscle && options.labels) {
      tip.hidden = false;
      tip.textContent = options.labels[muscle] ?? muscle;
      const rect = container.getBoundingClientRect();
      tip.style.left = String(event.clientX - rect.left + 14) + "px";
      tip.style.top = String(event.clientY - rect.top + 10) + "px";
    } else {
      tip.hidden = true;
    }
  };
  const onLeave = () => {
    hovered = null;
    tip.hidden = true;
    paint();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  const turnTo = (angle: number) => {
    const offset = camera.position.clone().sub(controls.target);
    const radius = Math.hypot(offset.x, offset.z);
    camera.position.set(controls.target.x + Math.sin(angle) * radius, camera.position.y, controls.target.z + Math.cos(angle) * radius);
    controls.update();
  };

  return {
    setSelected(list) {
      selected.clear();
      list.forEach((muscle) => selected.add(muscle));
      paint();
    },
    front() {
      turnTo(0);
    },
    back() {
      turnTo(Math.PI);
    },
    setAutoRotate(on) {
      controls.autoRotate = on;
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      meshes.forEach((mesh) => mesh.material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
