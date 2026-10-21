import {
  BarController, BarElement, CategoryScale, Chart, type ChartDataset, Filler, LinearScale, LineController, LineElement, PointElement, Tooltip,
} from "chart.js";
import { useEffect, useRef } from "react";
import { formatShortDay, num } from "@/lib/format";
import { cssVar } from "@/lib/catalog";

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Filler);

export type LineChartInstance = Chart<"line", (number | null)[], string>;

export interface Series {
  label: string;
  data: (number | null)[];
  color: string;
  borderWidth?: number;
  pointRadius?: number;
  borderDash?: number[];
  hidden?: boolean;
}

function projector(): boolean {
  return document.documentElement.dataset.projector === "on";
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function applyDefaults(): void {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = projector() ? 16 : 12;
  Chart.defaults.color = cssVar("--chalk-3");
  Chart.defaults.borderColor = cssVar("--iron-3");
}

function tooltip() {
  return {
    backgroundColor: cssVar("--chalk"),
    titleColor: cssVar("--iron"),
    bodyColor: cssVar("--iron"),
    padding: 10,
    cornerRadius: 8,
    displayColors: true,
    boxPadding: 4,
    titleFont: { weight: 600 as const },
  };
}

export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const value = parseInt(color.slice(1), 16);
    return "rgba(" + String(value >> 16) + "," + String((value >> 8) & 255) + "," + String(value & 255) + "," + String(alpha) + ")";
  }
  return color;
}

interface LineProps {
  labels: string[];
  series: Series[];
  unit?: string;
  dateLabels?: boolean;
  area?: boolean;
  suggestedMin?: number;
  className?: string;
  onReady?: (chart: LineChartInstance) => void;
}

export function LineChart({ labels, series, unit = "", dateLabels = true, area = false, suggestedMin, className = "chart-box", onReady }: LineProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  });
  useEffect(() => {
    if (!canvas.current) return;
    applyDefaults();
    const width = Number(cssVar("--chart-line")) || 2;
    const datasets: ChartDataset<"line", (number | null)[]>[] = series.map((entry) => ({
      label: entry.label,
      data: entry.data,
      borderWidth: entry.borderWidth ?? width,
      pointRadius: entry.pointRadius ?? (projector() ? 4 : 2.5),
      pointHoverRadius: 6,
      pointBackgroundColor: entry.color,
      borderColor: entry.color,
      backgroundColor: area ? withAlpha(entry.color, 0.12) : entry.color,
      fill: area ? "origin" : false,
      tension: 0.25,
      spanGaps: true,
      hidden: entry.hidden ?? false,
      borderDash: entry.borderDash ?? [],
    }));
    const chart: LineChartInstance = new Chart<"line", (number | null)[], string>(canvas.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        animation: reducedMotion() ? false : { duration: 700, easing: "easeOutQuart" },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltip(),
            callbacks: {
              title: (items) => {
                const label = items[0]?.label ?? "";
                return dateLabels ? formatShortDay(label) : label;
              },
              label: (item) => " " + (item.dataset.label ?? "") + ": " + num(item.parsed.y) + (unit ? " " + unit : ""),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 0,
              autoSkipPadding: 18,
              callback(value) {
                const label = this.getLabelForValue(Number(value));
                return dateLabels ? formatShortDay(label) : label;
              },
            },
          },
          y: {
            ...(suggestedMin === undefined ? {} : { suggestedMin }),
            grid: { color: cssVar("--iron-3") },
            border: { display: false },
            ticks: { callback: (value) => num(Number(value), 0) + (unit ? " " + unit : "") },
          },
        },
      },
    });
    readyRef.current?.(chart);
    return () => {
      chart.destroy();
    };
  }, [labels, series, unit, dateLabels, area, suggestedMin]);
  return (
    <div className={className}>
      <canvas ref={canvas} />
    </div>
  );
}

interface BarProps {
  labels: string[];
  series: Series[];
  unit?: string;
  dateLabels?: boolean;
  weekTitles?: boolean;
  className?: string;
  suggestedMin?: number;
  suggestedMax?: number;
  formatLabel?: (label: string) => string;
}

export function BarChart({ labels, series, unit = "", dateLabels = true, weekTitles = true, className = "chart-box", suggestedMin, suggestedMax, formatLabel }: BarProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    applyDefaults();
    const label = (text: string) => (formatLabel ? formatLabel(text) : dateLabels ? formatShortDay(text) : text);
    const chart = new Chart(canvas.current, {
      type: "bar",
      data: {
        labels,
        datasets: series.map((entry) => ({ label: entry.label, data: entry.data, borderRadius: 4, backgroundColor: entry.color })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion() ? false : { duration: 600, easing: "easeOutQuart" },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltip(),
            callbacks: {
              title: (items) => {
                const text = items[0]?.label ?? "";
                return dateLabels && weekTitles ? "Week of " + label(text) : label(text);
              },
              label: (item) => " " + (item.dataset.label ?? "") + ": " + num(item.parsed.y) + (unit ? " " + unit : ""),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              callback(value) {
                return label(this.getLabelForValue(Number(value)));
              },
            },
          },
          y: {
            ...(suggestedMin === undefined ? {} : { suggestedMin }),
            ...(suggestedMax === undefined ? {} : { suggestedMax }),
            grid: { color: cssVar("--iron-3") },
            border: { display: false },
            ticks: { callback: (value) => num(Number(value), 0) },
          },
        },
      },
    });
    return () => {
      chart.destroy();
    };
  }, [labels, series, unit, dateLabels, weekTitles, suggestedMin, suggestedMax, formatLabel]);
  return (
    <div className={className}>
      <canvas ref={canvas} />
    </div>
  );
}
