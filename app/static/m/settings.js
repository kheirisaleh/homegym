import { setTop } from "./app.js?v=cycle2";
import { renderSettings } from "../js/views/settings.js?v=cycle2";

export async function renderSettingsMobile(view) {
  setTop({ title: "Settings", back: "#/more" });
  await renderSettings(view, { mobile: true });
}
