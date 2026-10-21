import { type RefObject, useEffect } from "react";

const MIN_ZOOM = 0.62;
const TRIM_LISTS = [".volume-list", ".alt-programs", ".board", ".feed", "#ex-grid", ".eq-grid", ".session-list", ".prog-list", ".report", ".lift-legend"];

function trimItems(list: Element): HTMLElement[] {
  return [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement && !child.matches(".vol-legend, .proj-more, .board-legend"));
}

function resetTrim(view: HTMLElement): void {
  view.querySelectorAll(".proj-trimmed").forEach((element) => element.classList.remove("proj-trimmed"));
  view.querySelectorAll(".proj-more").forEach((element) => element.remove());
}

function setVisible(list: Element, count: number): void {
  const items = trimItems(list);
  items.forEach((item, index) => item.classList.toggle("proj-trimmed", index >= count));
  let note = list.querySelector(":scope > .proj-more");
  const hidden = items.length - count;
  if (hidden > 0) {
    if (!note) {
      note = document.createElement("div");
      note.className = "proj-more";
      list.appendChild(note);
    }
    note.textContent = "+ " + String(hidden) + " more on your laptop or phone";
  } else {
    note?.remove();
  }
}

export function fitToScreen(view: HTMLElement, stage: HTMLElement, projector: boolean): void {
  const style = view.style as CSSStyleDeclaration & { zoom: string };
  if (!projector) {
    style.zoom = "";
    resetTrim(view);
    return;
  }
  resetTrim(view);
  style.zoom = "1";
  const available = stage.clientHeight - [...stage.children].filter((child): child is HTMLElement => child !== view && child instanceof HTMLElement && !child.hidden).reduce((sum, child) => sum + child.offsetHeight, 0);
  const availableWidth = stage.clientWidth;
  const fits = (zoom: number) => view.scrollHeight * zoom <= available + 1 && view.scrollWidth * zoom <= availableWidth + 1;
  let zoom = 1;
  for (let attempt = 0; attempt < 6 && zoom > MIN_ZOOM; attempt++) {
    style.zoom = String(zoom);
    if (fits(zoom)) break;
    zoom = Math.max(MIN_ZOOM, zoom * Math.min(available / (view.scrollHeight * zoom), availableWidth / (view.scrollWidth * zoom)) * 0.99);
  }
  style.zoom = String(zoom);
  if (fits(zoom)) return;
  const lists = [...view.querySelectorAll(TRIM_LISTS.join(","))].filter((list) => trimItems(list).length > 1).reverse();
  const fitList = (list: Element) => {
    const total = trimItems(list).length;
    setVisible(list, total);
    const before = view.scrollHeight;
    setVisible(list, 1);
    if (view.scrollHeight >= before - 1 && !fits(zoom)) {
      setVisible(list, total);
      return;
    }
    let low = 1;
    let high = total;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      setVisible(list, middle);
      if (fits(zoom)) low = middle;
      else high = middle - 1;
    }
    setVisible(list, low);
  };
  for (const list of lists) {
    fitList(list);
    if (fits(zoom)) break;
  }
  if (!fits(zoom)) lists.forEach(fitList);
  for (let attempt = 0; attempt < 6 && !fits(zoom) && zoom > 0.3; attempt++) {
    zoom = Math.max(0.3, zoom * Math.min(available / (view.scrollHeight * zoom), availableWidth / (view.scrollWidth * zoom)) * 0.99);
    style.zoom = String(zoom);
  }
}

export function useProjectorFit(view: RefObject<HTMLElement | null>, stage: RefObject<HTMLElement | null>, projector: boolean, key: string): void {
  useEffect(() => {
    const viewElement = view.current;
    const stageElement = stage.current;
    if (!viewElement || !stageElement) return;
    let debounce = 0;
    const observer = new MutationObserver(() => {
      if (!projector) return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(run, 180);
    });
    function run() {
      fitToScreen(viewElement!, stageElement!, projector);
      observer.takeRecords();
    }
    const frame = requestAnimationFrame(run);
    const early = window.setTimeout(run, 400);
    const late = window.setTimeout(run, 1200);
    observer.observe(viewElement, { childList: true, subtree: true });
    window.addEventListener("resize", run);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(early);
      window.clearTimeout(late);
      window.clearTimeout(debounce);
      observer.disconnect();
      window.removeEventListener("resize", run);
    };
  }, [view, stage, projector, key]);
}
