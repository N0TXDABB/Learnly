// Central from street level: glass towers rising and converging overhead, the Bank of China
// Tower in the gap, and an elevated walkway across. Used for Solve: while the AI writes a
// solution, floors light up from the street upwards (setData({progress}) from 0 to 1;
// events "solve" to start the scanning beam, "stage" with {index} out of 6, "done", "reset").

import { C, bankOfChina, glow, layer, rng, sky, stars } from "./common.js";

export function central() {
  let w = 0, h = 0, dpr = 1;
  let base = null;
  let overlay = []; // windows that light up as a solution is written
  let progress = 0;
  let target = 0;
  let scanUntil = 0;
  let facades = [];

  function build() {
    base = layer(w, h, dpr);
    const ctx = base.ctx;
    sky(ctx, w, h, [[0, "#020510"], [0.5, "#0a1636"], [1, "#1c2350"]]);
    stars(ctx, w, h, Math.round(w / 8), 23, 0.6);
    const vp = { x: w * 0.5, y: -h * 0.75 };
    // the Bank of China Tower seen through the gap
    bankOfChina(ctx, w * 0.5 - w * 0.028, h * 0.98, w * 0.056, h * 0.74);
    const r = rng(42);
    facades = [];
    overlay = [];
    const ground = h * 1.05;
    const groups = [
      // [x0, x1] on the ground line, height as a fraction of the way to the vanishing point
      [-0.6, -0.12, 0.66], [-0.14, 0.2, 0.52], [0.18, 0.43, 0.4],
      [1.6, 1.12, 0.64], [1.14, 0.8, 0.5], [0.82, 0.57, 0.38],
    ];
    // draw the shorter, inner buildings first, then the tall outer ones in front
    const order = [2, 5, 1, 4, 0, 3];
    for (const gi of order) {
      const [a, b, top] = groups[gi];
      const x0 = w * a;
      const x1 = w * b;
      const P = (x, f) => [x + (vp.x - x) * f, ground + (vp.y - ground) * f];
      const quad = [P(x0, 0), P(x1, 0), P(x1, top), P(x0, top)];
      const g = ctx.createLinearGradient(quad[0][0], 0, quad[1][0], 0);
      const tone = gi % 3 === 0 ? ["#1d2d5c", "#0c1636"] : gi % 3 === 1 ? ["#15224a", "#0a122d"] : ["#1a2850", "#0b142f"];
      g.addColorStop(0, tone[0]);
      g.addColorStop(1, tone[1]);
      ctx.beginPath();
      quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      // sky reflected in the glass
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.18;
      const refl = ctx.createLinearGradient(0, ground, 0, ground + (vp.y - ground) * top);
      refl.addColorStop(0, "rgba(0,240,255,0)");
      refl.addColorStop(1, "rgba(120,170,255,0.6)");
      ctx.fillStyle = refl;
      ctx.fill();
      ctx.globalAlpha = 1;
      // mullions converge on the vanishing point
      const cols = 22;
      ctx.strokeStyle = "rgba(170,200,255,0.16)";
      ctx.lineWidth = 1;
      for (let c = 0; c <= cols; c++) {
        const x = x0 + (x1 - x0) * (c / cols);
        const [tx, ty] = P(x, top);
        ctx.beginPath();
        ctx.moveTo(x, ground);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      // floors: closer together higher up (perspective)
      const floors = 58;
      for (let f = 0; f < floors; f++) {
        const fa = top * (1 - Math.pow(1 - f / floors, 1.0));
        const fb = top * (1 - Math.pow(1 - (f + 0.6) / floors, 1.0));
        for (let c = 0; c < cols; c++) {
          const xa = x0 + (x1 - x0) * ((c + 0.15) / cols);
          const xb = x0 + (x1 - x0) * ((c + 0.85) / cols);
          const pts = [P(xa, fa), P(xb, fa), P(xb, fb), P(xa, fb)];
          const roll = r();
          if (roll < 0.3) {
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fillStyle = r() < 0.7 ? "rgba(255,214,140,0.38)" : "rgba(190,232,255,0.3)";
            ctx.fill();
          } else if (roll < 0.62) {
            overlay.push({ pts, level: f / floors, color: r() < 0.6 ? C.goldLight : C.neon, order: r() });
          }
        }
      }
      ctx.restore();
      // lit roof edge
      ctx.strokeStyle = "rgba(240,210,122,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(...quad[3]);
      ctx.lineTo(...quad[2]);
      ctx.stroke();
      facades.push({ quad, P, top, x0, x1 });
    }
    // elevated walkway across the street
    const wy = h * 0.74;
    ctx.fillStyle = "#0b1230";
    ctx.fillRect(0, wy, w, h * 0.06);
    ctx.fillStyle = "rgba(255,214,140,0.75)";
    for (let x = 8; x < w; x += 22) ctx.fillRect(x, wy + h * 0.018, 12, h * 0.022);
    ctx.fillStyle = "rgba(240,210,122,0.8)";
    ctx.fillRect(0, wy, w, 2);
    // street glow
    const sg = ctx.createLinearGradient(0, h * 0.8, 0, h);
    sg.addColorStop(0, "rgba(255,180,90,0)");
    sg.addColorStop(1, "rgba(255,180,90,0.22)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, h * 0.8, w, h * 0.2);
    overlay.sort((a, b) => a.level - b.level || a.order - b.order);
  }

  return {
    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      build();
    },
    onData(data) {
      if (typeof data.progress === "number") target = Math.max(0, Math.min(1, data.progress));
    },
    event(kind, payload) {
      if (kind === "stage") target = Math.max(target, (payload?.index ?? 0) / 6 + 1 / 12);
      if (kind === "solve") {
        target = 0.04;
        scanUntil = performance.now() + 120000;
      }
      if (kind === "done") {
        target = 1;
        scanUntil = performance.now() + 1500;
      }
      if (kind === "reset") {
        target = 0;
        scanUntil = 0;
      }
    },
    draw(ctx, _w, _h, t, dt) {
      if (!base) return;
      ctx.drawImage(base.canvas, 0, 0, w, h);
      progress += (target - progress) * Math.min(1, dt * 2.5 + (dt === 0 ? 1 : 0));
      // floors lit by the solution so far
      const idle = 0.12 + 0.04 * Math.sin(t * 0.5);
      const level = Math.max(idle, progress);
      for (const o of overlay) {
        if (o.level > level) break;
        ctx.beginPath();
        o.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        const fresh = level - o.level < 0.05 && progress > idle;
        ctx.globalAlpha = fresh ? 0.95 : 0.42;
        ctx.fillStyle = fresh ? "#ffffff" : o.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // a scanning beam sweeps up the facades while the AI is working
      if (performance.now() < scanUntil) {
        const f = (t * 0.35) % 1;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const fc of facades) {
          const a = fc.P(fc.x0, fc.top * f);
          const b = fc.P(fc.x1, fc.top * f);
          const g = ctx.createLinearGradient(0, a[1] - 18, 0, a[1] + 18);
          g.addColorStop(0, "rgba(0,240,255,0)");
          g.addColorStop(0.5, "rgba(0,240,255,0.35)");
          g.addColorStop(1, "rgba(0,240,255,0)");
          ctx.strokeStyle = "rgba(0,240,255,0.7)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
        ctx.restore();
      }
      glow(ctx, w * 0.5, h * 0.1, w * 0.18, "rgba(0,240,255,0.05)");
    },
  };
}
