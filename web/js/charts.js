// Small SVG charts in the app's gold/neon style.

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function gradient(svg, id, a, b, vertical = true) {
  const defs = svg.querySelector("defs") || svg.appendChild(el("defs"));
  const g = el("linearGradient", vertical ? { id, x1: 0, x2: 0, y1: 0, y2: 1 } : { id, x1: 0, x2: 1, y1: 0, y2: 0 });
  g.append(el("stop", { offset: 0, "stop-color": a }), el("stop", { offset: 1, "stop-color": b }));
  defs.append(g);
}

let uid = 0;

/** Vertical bars. items: [{label, value, title}] */
export function barChart(items, { height = 220, format = (v) => v, color = ["#F0D27A", "#B8912A"] } = {}) {
  const width = Math.max(320, items.length * 56);
  const pad = { l: 8, r: 8, t: 22, b: 30 };
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  const id = `bar${uid++}`;
  gradient(svg, id, color[0], color[1]);
  const max = Math.max(1, ...items.map((i) => i.value));
  const bw = (width - pad.l - pad.r) / Math.max(1, items.length);
  svg.append(el("line", { class: "axis", x1: pad.l, x2: width - pad.r, y1: height - pad.b, y2: height - pad.b }));
  items.forEach((item, i) => {
    const bh = ((height - pad.t - pad.b) * Math.max(0, item.value)) / max;
    const x = pad.l + i * bw + bw * 0.18;
    const y = height - pad.b - bh;
    const rect = el("rect", { x, y, width: bw * 0.64, height: Math.max(1, bh), rx: 4, fill: `url(#${id})` });
    rect.append(el("title", {}, item.title || `${item.label}: ${format(item.value)}`));
    svg.append(rect);
    svg.append(el("text", { x: x + bw * 0.32, y: height - 10, "text-anchor": "middle" }, item.label));
    svg.append(el("text", { x: x + bw * 0.32, y: y - 6, "text-anchor": "middle", fill: "#EEF2F8" }, format(item.value)));
  });
  svg.querySelectorAll("text").forEach((t) => t.setAttribute("font-size", "11"));
  const wrap = document.createElement("div");
  wrap.className = "chart";
  wrap.append(svg);
  return wrap;
}

/** Area/line chart for a series. points: [{label, value}] */
export function areaChart(points, { height = 160, format = (v) => v } = {}) {
  const width = 520;
  const pad = { l: 10, r: 10, t: 16, b: 24 };
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  const id = `area${uid++}`;
  gradient(svg, id, "rgba(0,240,255,0.45)", "rgba(0,240,255,0)");
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = (width - pad.l - pad.r) / Math.max(1, points.length - 1);
  const xy = points.map((p, i) => [pad.l + i * step, height - pad.b - ((height - pad.t - pad.b) * p.value) / max]);
  if (xy.length === 1) xy.push([width - pad.r, xy[0][1]]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  svg.append(el("path", { d: `${line} L${xy[xy.length - 1][0]},${height - pad.b} L${xy[0][0]},${height - pad.b} Z`, fill: `url(#${id})` }));
  svg.append(el("path", { d: line, fill: "none", stroke: "#00F0FF", "stroke-width": 2 }));
  xy.forEach(([x, y], i) => {
    const dot = el("circle", { cx: x, cy: y, r: 3.2, fill: "#F0D27A" });
    if (points[i]) dot.append(el("title", {}, `${points[i].label}: ${format(points[i].value)}`));
    svg.append(dot);
  });
  if (points.length) {
    svg.append(el("text", { x: pad.l, y: height - 6, "font-size": 11 }, points[0].label));
    svg.append(el("text", { x: width - pad.r, y: height - 6, "text-anchor": "end", "font-size": 11 }, points[points.length - 1].label));
  }
  const wrap = document.createElement("div");
  wrap.className = "chart";
  wrap.append(svg);
  return wrap;
}

/** Semi-circular gauge for a 0..1 score. */
export function gauge(score, label) {
  const svg = el("svg", { viewBox: "0 0 140 84", class: "gauge", role: "img", "aria-label": `${label}: ${Math.round(score * 100)}%` });
  const id = `g${uid++}`;
  gradient(svg, id, "#00E676", "#FF5468", false);
  const arc = (from, to) => {
    const a0 = Math.PI * (1 - from);
    const a1 = Math.PI * (1 - to);
    const p = (a) => [70 + 58 * Math.cos(a), 74 - 58 * Math.sin(a)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0},${y0} A58,58 0 0 1 ${x1},${y1}`;
  };
  svg.append(el("path", { d: arc(0, 1), stroke: "rgba(255,255,255,0.1)", "stroke-width": 11, fill: "none", "stroke-linecap": "round" }));
  svg.append(el("path", { d: arc(0, Math.max(0.01, score)), stroke: `url(#${id})`, "stroke-width": 11, fill: "none", "stroke-linecap": "round" }));
  svg.append(el("text", { x: 70, y: 68, "text-anchor": "middle", "font-size": 22, "font-weight": 700, fill: "#EEF2F8" }, `${Math.round(score * 100)}`));
  return svg;
}
