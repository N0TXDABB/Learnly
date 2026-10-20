// The view from Victoria Peak: the whole city below, harbour in the middle, Kowloon and
// Lion Rock beyond. Used for Study: every uploaded document switches on more windows,
// so the city fills with light as the course material grows.

import { C, bankOfChina, centralPlaza, glow, icc, ifc2, layer, mirrorLayer, peakTower, reflect, ridge, rng, sky, stars, windows } from "./common.js";

export function peak() {
  let w = 0, h = 0, dpr = 1, waterTop = 0, waterBottom = 0;
  let base = null;
  let front = null;
  let mirror = null;
  let lights = [];
  let goal = 0;
  let lit = 0;
  let flashFrom = 0;
  let flashAt = 0;
  let iccFace = null;

  function build() {
    const horizon = h * 0.3;
    waterTop = h * 0.4;
    waterBottom = h * 0.55;
    base = layer(w, h, dpr);
    const ctx = base.ctx;
    sky(ctx, w, horizon + 4, [[0, "#02040d"], [0.6, "#0b1636"], [1, "#2a2350"]]);
    stars(ctx, w, horizon, Math.round(w / 7), 17, 1);
    // Kowloon hills with Lion Rock's head on the left
    ridge(ctx, w, horizon + h * 0.04, { seed: 4, height: h * 0.1, peaks: [{ at: 0.3, width: 0.05, height: 0.9 }, { at: 0.36, width: 0.05, height: 0.55 }, { at: 0.75, width: 0.12, height: 0.4 }], color: "#091128" });
    // Kowloon city band
    ctx.fillStyle = "#0b1431";
    ctx.fillRect(0, horizon + h * 0.03, w, waterTop - horizon - h * 0.03);
    const r = rng(77);
    lights = [];
    for (let x = 0; x < w; x += 6 + r() * 10) {
      const bh = h * (0.02 + r() * 0.06);
      const bw = 6 + r() * 12;
      ctx.fillStyle = "#0e1a3c";
      ctx.fillRect(x, waterTop - bh, bw, bh);
      windows(ctx, x + 1, waterTop - bh + 2, bw - 2, bh - 3, { seed: Math.floor(r() * 999), cols: 3, rows: 6, lit: 0.45, size: 0.5 });
    }
    // ICC on the West Kowloon waterfront
    const iccTop = icc(ctx, w * 0.2, waterTop, Math.max(12, w * 0.016), h * 0.2, 9);
    iccFace = iccTop.face;
    // harbour
    ctx.fillStyle = "#050b1d";
    ctx.fillRect(0, waterTop, w, waterBottom - waterTop);
    // Hong Kong Island: seen from above. The nearer the row, the taller the towers,
    // so the front towers rise up over the harbour, as they do from the Peak.
    const rows = 7;
    const landmarksRow = 2;
    for (let row = 0; row < rows; row++) {
      const depth = row / (rows - 1);
      const y0 = waterBottom + (h * 0.95 - waterBottom) * Math.pow(depth, 1.25);
      const scale = 0.6 + depth * 1.5;
      let x = -20 + r() * 20;
      while (x < w + 20) {
        const bw = (12 + r() * 26) * scale;
        const bh = (h * 0.03 + r() * h * 0.09) * (0.6 + depth * 1.7);
        const top = y0 - bh;
        const shade = 13 + Math.floor(depth * 9);
        const g = ctx.createLinearGradient(x, 0, x + bw, 0);
        g.addColorStop(0, `rgb(${shade + 6}, ${shade + 16}, ${shade + 44})`);
        g.addColorStop(1, `rgb(${shade - 4}, ${shade + 4}, ${shade + 24})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, top, bw, bh + h * 0.3);
        ctx.fillStyle = "rgba(170,190,240,0.12)";
        ctx.fillRect(x, top, bw, 1.5);
        if (row <= landmarksRow) {
          // far rows: fixed lights (they sit behind the landmarks)
          windows(ctx, x + 1, top + 2, bw - 2, bh - 2, { seed: Math.floor(r() * 999), lit: 0.4, size: 0.4, cols: Math.max(1, Math.floor(bw / 4)), rows: Math.max(2, Math.floor(bh / 6)) });
          x += bw + r() * 3 * scale;
          continue;
        }
        // window positions, switched on as the library grows
        const cols = Math.max(1, Math.floor(bw / (4.2 * scale)));
        const floors = Math.max(2, Math.floor(bh / (6.5 * scale)));
        for (let f = 0; f < floors; f++) {
          for (let c = 0; c < cols; c++) {
            if (r() < 0.5) continue;
            lights.push({
              x: x + (c + 0.25) * (bw / cols),
              y: top + 3 + f * (bh / floors),
              s: Math.max(1, 1.5 * scale),
              color: r() < 0.72 ? C.warm : C.cool,
              order: r(),
            });
          }
        }
        x += bw + r() * 3 * scale;
      }
      if (row === landmarksRow) {
        // Central's landmarks rising above the rooftops
        const s = Math.max(0.6, w / 1440);
        ifc2(ctx, w * 0.42, y0, 40 * s, h * 0.42);
        bankOfChina(ctx, w * 0.52, y0, 40 * s, h * 0.33);
        centralPlaza(ctx, w * 0.66, y0, 32 * s, h * 0.34);
      }
    }
    lights.sort((a, b) => a.order - b.order);
    mirror = mirrorLayer(base.canvas, dpr, w, waterTop, waterBottom - waterTop);
    // foreground: the Peak's hillside and the Peak Tower, on their own layer above the lights
    front = layer(w, h, dpr);
    {
    const ctx = front.ctx;
    ctx.fillStyle = "#03060f";
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.82);
    for (let x = 0; x <= w; x += 12) {
      const y = h * 0.86 + Math.sin(x * 0.013) * h * 0.02 + Math.sin(x * 0.051) * h * 0.012 + (x > w * 0.6 ? (x - w * 0.6) / w * h * 0.1 : 0);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    // tree tops
    for (let x = 0; x < w; x += 9) {
      const y = h * 0.86 + Math.sin(x * 0.013) * h * 0.02 + Math.sin(x * 0.051) * h * 0.012 + (x > w * 0.6 ? (x - w * 0.6) / w * h * 0.1 : 0);
      ctx.beginPath();
      ctx.arc(x, y + 2, 5 + Math.abs(Math.sin(x * 0.7)) * 9, Math.PI, 0);
      ctx.fill();
    }
    peakTower(ctx, w * 0.06, h * 0.88, Math.max(110, w * 0.12));
    }
  }

  return {
    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      build();
      lit = Math.min(lit, lights.length);
    },
    onData(data) {
      if (typeof data.documents === "number") {
        // a base glow so the city is never dark, then more windows per document
        const next = Math.min(lights.length, Math.round(lights.length * 0.18) + data.documents * 12);
        if (next > goal) {
          flashFrom = lit;
          flashAt = performance.now();
        }
        goal = next;
      }
    },
    event(kind) {
      if (kind === "celebrate") flashAt = performance.now();
    },
    draw(ctx, _w, _h, t, dt) {
      if (!base) return;
      if (!goal) goal = Math.round(lights.length * 0.18);
      ctx.drawImage(base.canvas, 0, 0, w, h);
      // ICC's light show
      if (iccFace) {
        const f = iccFace;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const stripes = 18;
        for (let i = 0; i < stripes; i++) {
          const a = 0.5 + 0.5 * Math.sin(t * 2 - i * 0.5);
          ctx.fillStyle = `rgba(0,240,255,${0.12 + a * 0.4})`;
          ctx.fillRect(f.x + 2, f.y + (f.h / stripes) * i, f.w - 4, Math.max(1, f.h / stripes / 2.5));
        }
        ctx.restore();
      }
      reflect(ctx, mirror, dpr, w, waterTop, waterBottom - waterTop, t, { strength: 0.6, amp: 2 });
      // windows of the island switch on towards the goal
      lit += Math.sign(goal - lit) * Math.min(Math.abs(goal - lit), Math.max(2, lights.length * dt * 0.25));
      const flashing = performance.now() - flashAt < 5000;
      for (let i = 0; i < lit; i++) {
        const L = lights[i];
        const isNew = flashing && i >= flashFrom;
        ctx.globalAlpha = isNew ? 1 : 0.55 + 0.35 * Math.sin(i * 12.9 + t * (i % 7 === 0 ? 1.7 : 0));
        ctx.fillStyle = isNew ? C.goldLight : L.color;
        ctx.fillRect(L.x, L.y, L.s, L.s);
      }
      ctx.globalAlpha = 1;
      if (flashing) glow(ctx, w * 0.5, h * 0.7, w * 0.5, "rgba(240,210,122,0.06)");
      ctx.drawImage(front.canvas, 0, 0, w, h);
    },
  };
}
