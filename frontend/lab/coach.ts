import { CoachStage, MOVES, PATTERN_DEMOS } from "@/three/coachEngine";

const params = new URLSearchParams(window.location.search);
const key = params.get("coach") === "lena" ? "lena" : "max";
const container = document.getElementById("stage");
if (!container) throw new Error("missing stage");
const stage = new CoachStage(container, key, key === "lena" ? "#3f7bf2" : "#d93a3f", params.get("framing") === "portrait" ? "portrait" : "full", "picker");
await stage.init();
Object.assign(window, { lab: { stage, MOVES, moves: Object.keys(MOVES), patterns: PATTERN_DEMOS } });
document.body.dataset.ready = "1";
