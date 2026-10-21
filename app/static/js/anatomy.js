import * as THREE from "../vendor/three/three.module.min.js?v=cycle2";
import { OrbitControls } from "../vendor/three/addons/controls/OrbitControls.js?v=cycle2";
import { GLTFLoader } from "../vendor/three/addons/loaders/GLTFLoader.js?v=cycle2";

const MODEL_URLS = {
  male: "/static/models/full-body-male-mobile.glb",
  female: "/static/models/full-body-female-mobile.glb",
};

const KEY_MAP = {
  deltoid_anterior: "front_delts",
  deltoid_lateral: "side_delts",
  deltoid_posterior: "rear_delts",
  brachialis: "biceps",
  coracobrachialis: "biceps",
  teres_major: "lats",
  serratus_anterior: "obliques",
};

const GROUP_MAP = {
  "Chest": "chest",
  "Triceps": "triceps",
  "Biceps": "biceps",
  "Forearms": "forearms",
  "Lats": "lats",
  "Teres major": "lats",
  "Trapezius": "upper_back",
  "Upper back": "upper_back",
  "Rotator cuff": "upper_back",
  "Lower back": "lower_back",
  "Spinal extensors": "lower_back",
  "Abdominals": "abs",
  "Obliques": "obliques",
  "Serratus": "obliques",
  "Quadriceps": "quads",
  "Sartorius": "quads",
  "Glutes": "glutes",
  "Hip rotators": "glutes",
  "Hamstrings": "hamstrings",
  "Calves": "calves",
};

export const SELECTABLE_MUSCLES = ["chest", "front_delts", "side_delts", "rear_delts", "biceps", "triceps", "forearms", "lats", "upper_back",
  "lower_back", "abs", "obliques", "glutes", "quads", "hamstrings", "calves"];

export function muscleForNode(data) {
  if (!data || !data.key) return null;
  if (KEY_MAP[data.key]) return KEY_MAP[data.key];
  return GROUP_MAP[data.group] || null;
}

const gltfCache = {};
function loadModel(sex) {
  const url = MODEL_URLS[sex] || MODEL_URLS.male;
  if (!gltfCache[url]) {
    gltfCache[url] = new Promise((resolve, reject) => new GLTFLoader().load(url, resolve, undefined, reject));
  }
  return gltfCache[url];
}

function readColors(container) {
  const style = getComputedStyle(container);
  const read = (name, fallback) => (style.getPropertyValue(name).trim() || fallback);
  return {
    muscle: read("--body-muscle", "#8c5a52"),
    selected: read("--body-selected", "#f2c14e"),
    hover: read("--body-hover", "#e9d9a6"),
    other: read("--body-other", "#55504a"),
    background: read("--body-bg", "#1b1e22"),
  };
}

export async function createBodyViewer(container, options = {}) {
  const interactive = options.interactive !== false;
  const selected = new Set(options.selected || []);
  container.classList.add("body-viewer");
  container.innerHTML = '<canvas aria-label="3D muscle model"></canvas><div class="body-tip" hidden></div>' +
    '<div class="body-loading">Loading 3D model</div>';
  const canvas = container.querySelector("canvas");
  const tip = container.querySelector(".body-tip");
  const loading = container.querySelector(".body-loading");
  let colors = readColors(container);

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

  const meshes = [];
  const byMuscle = new Map();
  let hovered = null;
  let disposed = false;
  let frame = null;

  const materialFor = (muscle) => {
    if (!muscle) return new THREE.MeshStandardMaterial({ color: colors.other, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
    return new THREE.MeshStandardMaterial({ color: colors.muscle, roughness: 0.6, metalness: 0.05 });
  };

  const paint = () => {
    meshes.forEach((mesh) => {
      const muscle = mesh.userData.muscle;
      if (!muscle) {
        mesh.material.color.set(colors.other);
        return;
      }
      const isSelected = selected.has(muscle);
      const isHovered = hovered === muscle;
      mesh.material.color.set(isSelected ? colors.selected : isHovered ? colors.hover : colors.muscle);
      mesh.material.emissive.set(isSelected ? colors.selected : "#000000");
      mesh.material.emissiveIntensity = isSelected ? 0.35 : 0;
    });
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

  try {
    const gltf = await loadModel(options.sex);
    if (disposed) return null;
    const root = gltf.scene.clone(true);
    root.traverse((node) => {
      if (!node.isMesh) return;
      const data = node.userData || {};
      const muscle = muscleForNode(data);
      node.material = materialFor(muscle);
      node.userData = { ...data, muscle };
      meshes.push(node);
      if (muscle) {
        if (!byMuscle.has(muscle)) byMuscle.set(muscle, []);
        byMuscle.get(muscle).push(node);
      }
    });
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    controls.target.copy(center);
    const distance = (size.y / 2) / Math.tan((camera.fov * Math.PI) / 360) * 1.15;
    camera.position.set(center.x, center.y + size.y * 0.04, center.z + distance);
    controls.minDistance = distance * 0.45;
    controls.maxDistance = distance * 1.6;
    paint();
    loading.remove();
  } catch (error) {
    loading.textContent = "The 3D model could not be loaded. Use the muscle list instead.";
    return null;
  }

  resize();
  render();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pick = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes, false).find((entry) => entry.object.userData.muscle);
    return hit ? hit.object : null;
  };

  let downAt = null;
  const onDown = (event) => { downAt = { x: event.clientX, y: event.clientY }; controls.autoRotate = false; };
  const onUp = (event) => {
    if (!interactive || !downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return;
    const mesh = pick(event);
    if (!mesh) return;
    const muscle = mesh.userData.muscle;
    if (selected.has(muscle)) selected.delete(muscle); else selected.add(muscle);
    paint();
    if (options.onToggle) options.onToggle(muscle, selected.has(muscle), new Set(selected));
  };
  const onMove = (event) => {
    if (event.pointerType === "touch") return;
    const mesh = pick(event);
    const muscle = mesh ? mesh.userData.muscle : null;
    if (muscle !== hovered) {
      hovered = muscle;
      paint();
      canvas.style.cursor = muscle && interactive ? "pointer" : "grab";
    }
    if (mesh && options.labels) {
      tip.hidden = false;
      tip.textContent = options.labels[muscle] || muscle;
      const rect = container.getBoundingClientRect();
      tip.style.left = event.clientX - rect.left + 14 + "px";
      tip.style.top = event.clientY - rect.top + 10 + "px";
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

  const turnTo = (angle) => {
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
    getSelected() {
      return new Set(selected);
    },
    front() { turnTo(0); },
    back() { turnTo(Math.PI); },
    setAutoRotate(on) { controls.autoRotate = on; },
    refreshTheme() {
      colors = readColors(container);
      paint();
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      meshes.forEach((mesh) => mesh.material.dispose());
      renderer.dispose();
    },
  };
}
