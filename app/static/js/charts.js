import { cssVar, num, onCleanup, formatShortDay } from "./core.js?v=cycle2";

function projector() {
  return document.documentElement.dataset.projector === "on";
}

function base() {
  const Chart = window.Chart;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = projector() ? 16 : 12;
  Chart.defaults.color = cssVar("--chalk-3");
  Chart.defaults.borderColor = cssVar("--iron-3");
  return Chart;
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
    titleFont: { weight: "600" },
  };
}

export function withAlpha(color, alpha) {
  if (color.startsWith("#") && color.length === 7) {
    const value = parseInt(color.slice(1), 16);
    return "rgba(" + (value >> 16) + "," + ((value >> 8) & 255) + "," + (value & 255) + "," + alpha + ")";
  }
  return color;
}

export function lineChart(canvas, { labels, datasets, unit = "", yTitle = "", suggestedMin, dateLabels = true, area = false }) {
  const Chart = base();
  const width = Number(cssVar("--chart-line")) || 2;
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((dataset) => ({
        borderWidth: dataset.borderWidth || width,
        pointRadius: dataset.pointRadius ?? (projector() ? 4 : 2.5),
        pointHoverRadius: 6,
        pointBackgroundColor: dataset.color,
        borderColor: dataset.color,
        backgroundColor: area ? withAlpha(dataset.color, 0.12) : dataset.color,
        fill: area ? "origin" : false,
        tension: 0.25,
        spanGaps: true,
        ...dataset,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltip(),
          callbacks: {
            title: (items) => (dateLabels && items.length ? formatShortDay(items[0].label) : items[0] ? items[0].label : ""),
            label: (item) => " " + item.dataset.label + ": " + num(item.parsed.y) + (unit ? " " + unit : ""),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkipPadding: 18, callback(value) { const label = this.getLabelForValue(value); return dateLabels ? formatShortDay(label) : label; } },
        },
        y: {
          suggestedMin,
          grid: { color: cssVar("--iron-3") },
          border: { display: false },
          title: { display: Boolean(yTitle), text: yTitle },
          ticks: { callback: (value) => num(value, 0) + (unit ? " " + unit : "") },
        },
      },
    },
  });
  onCleanup(() => chart.destroy());
  return chart;
}

export function barChart(canvas, { labels, datasets, unit = "", stacked = false, dateLabels = true }) {
  const Chart = base();
  const chart = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: datasets.map((dataset) => ({ borderRadius: 4, backgroundColor: dataset.color, ...dataset })) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltip(),
          callbacks: {
            title: (items) => (dateLabels && items.length ? "Week of " + formatShortDay(items[0].label) : items[0].label),
            label: (item) => " " + item.dataset.label + ": " + num(item.parsed.y) + (unit ? " " + unit : ""),
          },
        },
      },
      scales: {
        x: { stacked, grid: { display: false }, ticks: { callback(value) { const label = this.getLabelForValue(value); return dateLabels ? formatShortDay(label) : label; } } },
        y: { stacked, grid: { color: cssVar("--iron-3") }, border: { display: false }, ticks: { callback: (value) => num(value, 0) } },
      },
    },
  });
  onCleanup(() => chart.destroy());
  return chart;
}
