// Mong Kok at night in the rain: a street canyon of tong lau tenements, neon signs
// hanging over the road, red taxis, and neon reflected on wet tarmac. Used for Review:
// a sign lights up for every card mastered, and 答對 ("correct") flashes on a right answer.

import { glow, layer, rng, taxi, tongLau } from "./common.js";

const SIGNS = [
  { text: "溫習", color: "#FF3D8B" },
  { text: "測驗", color: "#00F0FF" },
  { text: "考試", color: "#FFD23F" },
  { text: "答對", color: "#7CFF6A" },
  { text: "旺角", color: "#FF5A36" },
  { text: "知識", color: "#B57CFF" },
  { text: "夜市", color: "#FF3D8B" },
  { text: "香港", color: "#00F0FF" },
  { text: "學習", color: "#FFD23F" },
  { text: "加油", color: "#FF5A36" },
];

export function mongkok() {
  let w = 0, h = 0, dpr = 1, vx = 0, vy = 0;
  let base = null;
  let signs = [];
  let drops = [];
  let taxis = [];
  let litCount = 99;
  let flashUntil = 0;

  function build() {
    vx = w * 0.5;
    vy = h * 0.46;
    base = layer(w, h, dpr);
    const ctx = base.ctx;
    // sky slit between the buildings, lit orange by the city
    const g = ctx.createLinearGradient(0, 0, 0, vy);
    g.addColorStop(0, "#07040f");
    g.addColorStop(1, "#3a1630");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // far end of the street: a wall of small lit windows
    const r = rng(8);
    for (let i = 0; i < 260; i++) {
      const x = vx - w * 0.12 + r() * w * 0.24;
      const y = vy - h * 0.25 + r() * h * 0.26;
      ctx.fillStyle = r() < 0.5 ? "rgba(255,200,120,0.6)" : "rgba(120,220,255,0.4)";
      ctx.fillRect(x, y, 2, 2);
    }
    // the two facades, receding to the vanishing point
    for (const side of [-1, 1]) {
      const near = side < 0 ? 0 : w;
      ctx.save();
      // facade plane, drawn as slabs of different heights
      let u = 0;
      while (u < 0.94) {
        const du = 0.06 + r() * 0.12;
        const x0 = near + (vx - near) * u;
        const x1 = near + (vx - near) * Math.min(0.96, u + du);
        const rise = 0.6 + r() * 0.5;
        const t0 = vy - (vy + h * 0.1) * rise * (1 - u);
        const t1 = vy - (vy + h * 0.1) * rise * (1 - Math.min(0.96, u + du));
        const b0 = h + (vy - h) * u;
        const b1 = h + (vy - h) * Math.min(0.96, u + du);
        ctx.beginPath();
        ctx.moveTo(x0, t0);
        ctx.lineTo(x1, t1);
        ctx.lineTo(x1, b1);
        ctx.lineTo(x0, b0);
        ctx.closePath();
        const tint = ["#1a1424", "#141a2a", "#21162a", "#18121f"][Math.floor(r() * 4)];
        ctx.fillStyle = tint;
        ctx.fill();
        // windows on the receding facade, as perspective strips
        ctx.save();
        ctx.clip();
        const floors = 16;
        for (let f = 0; f < floors; f++) {
          for (let k = 0; k < 4; k++) {
            if (r() < 0.45) continue;
            const ua = u + du * (k + 0.2) / 4;
            const ub = u + du * (k + 0.75) / 4;
            const xa = near + (vx - near) * ua;
            const xb = near + (vx - near) * ub;
            const top = (uu) => vy - (vy + h * 0.1) * rise * (1 - uu);
            const bot = (uu) => h + (vy - h) * uu;
            const fa = (f + 0.25) / floors;
            const fb = (f + 0.75) / floors;
            const ya0 = top(ua) + (bot(ua) - top(ua)) * fa;
            const ya1 = top(ua) + (bot(ua) - top(ua)) * fb;
            const yb0 = top(ub) + (bot(ub) - top(ub)) * fa;
            const yb1 = top(ub) + (bot(ub) - top(ub)) * fb;
            ctx.beginPath();
            ctx.moveTo(xa, ya0);
            ctx.lineTo(xb, yb0);
            ctx.lineTo(xb, yb1);
            ctx.lineTo(xa, ya1);
            ctx.closePath();
            ctx.fillStyle = r() < 0.65 ? "rgba(255,196,110,0.55)" : "rgba(140,220,255,0.4)";
            ctx.fill();
          }
        }
        ctx.restore();
        u += du;
      }
      ctx.restore();
    }
    // street
    ctx.fillStyle = "#07060c";
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(vx - w * 0.02, vy + 2);
    ctx.lineTo(vx + w * 0.02, vy + 2);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    // lane markings
    ctx.strokeStyle = "rgba(255,220,120,0.35)";
    ctx.lineWidth = 2;
    for (let k = 0; k < 12; k++) {
      const a = Math.pow(k / 12, 1.8);
      const b = Math.pow((k + 0.45) / 12, 1.8);
      ctx.beginPath();
      ctx.moveTo(vx + (w * 0.5 - vx) * (1 - a) * 0.0, h + (vy - h) * (1 - (1 - a)));
      ctx.lineTo(vx, h + (vy - h) * (1 - (1 - b)));
      ctx.stroke();
    }
    // a tenement corner close to the viewer on each side
    tongLau(ctx, -w * 0.02, h, w * 0.1, h * 1.05, 3, "#120f1c");
    tongLau(ctx, w * 0.92, h, w * 0.1, h * 1.05, 4, "#140f1e");

    // signs hanging over the street, far to near
    signs = [];
    const rs = rng(31);
    const count = 18;
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const u = 0.9 - (i / count) * 0.85 + rs() * 0.04;
      const near = side < 0 ? 0 : w;
      const fx = near + (vx - near) * u;
      const scale = Math.pow(1 - u, 1.05) * Math.min(1.6, h / 650);
      const info = SIGNS[(i * 3 + (side > 0 ? 1 : 0)) % SIGNS.length];
      const size = Math.max(6, 30 * scale);
      const offset = side < 0 ? size * 0.5 : -size * 1.9;
      const top = vy - (vy * 0.95) * (1 - u) * (0.45 + rs() * 0.45);
      signs.push({ x: fx + offset, y: top, size, ...info, phase: rs() * 10, flicker: rs() < 0.25, u, i });
    }
    signs.sort((a, b) => b.u - a.u);

    drops = [];
    for (let i = 0; i < Math.round(w / 3); i++) drops.push({ x: Math.random() * w, y: Math.random() * h, len: 8 + Math.random() * 14, speed: 600 + Math.random() * 500 });
    taxis = [0.25, 0.6].map((d, i) => ({ d, speed: 0.04 + i * 0.02 }));
  }

  function signGlowOn(s, t) {
    if (s.i >= litCount) return 0.08;
    if (performance.now() < flashUntil && s.text === "答對") return Math.sin(t * 20) > 0 ? 1 : 0.4;
    if (s.flicker) {
      const f = Math.sin(t * 13 + s.phase) + Math.sin(t * 7.3 + s.phase * 2);
      return f > -1.4 ? 1 : 0.25;
    }
    return 0.92 + 0.08 * Math.sin(t * 3 + s.phase);
  }

  function drawSign(ctx, s, on) {
    const cell = s.size * 1.12;
    const bw = cell + s.size * 0.5;
    const bh = cell * s.text.length + s.size * 0.5;
    ctx.fillStyle = "rgba(10,6,16,0.9)";
    ctx.fillRect(s.x, s.y, bw, bh);
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = 0.3 + 0.7 * on;
    ctx.lineWidth = Math.max(1, s.size * 0.08);
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.size * 0.7 * on;
    ctx.strokeRect(s.x + 2, s.y + 2, bw - 4, bh - 4);
    ctx.font = `700 ${s.size}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = on > 0.6 ? "#fff6fb" : s.color;
    [...s.text].forEach((ch, k) => ctx.fillText(ch, s.x + bw / 2, s.y + s.size * 0.25 + cell * k + cell / 2));
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    return { bw, bh };
  }

  return {
    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      build();
    },
    onData(data) {
      if (typeof data.cardsMastered === "number") litCount = Math.max(6, Math.min(99, 6 + Math.floor(data.cardsMastered / 2)));
    },
    event(kind) {
      if (kind === "correct") flashUntil = performance.now() + 2500;
    },
    draw(ctx, _w, _h, t, dt) {
      if (!base) return;
      ctx.drawImage(base.canvas, 0, 0, w, h);
      // neon reflections on the wet road (drawn first, under the signs)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const s of signs) {
        const on = signGlowOn(s, t);
        if (on < 0.3) continue;
        const rx = s.x + s.size * 0.7;
        const ry = h - (h - vy) * s.u * 0.9;
        const len = (h - ry) * 0.9 + s.size * 2;
        const g = ctx.createLinearGradient(0, ry, 0, ry + len);
        g.addColorStop(0, s.color + "55");
        g.addColorStop(1, s.color + "00");
        ctx.fillStyle = g;
        const wob = Math.sin(t * 3 + s.phase) * 2;
        ctx.fillRect(rx - s.size * 0.4 + wob, ry, s.size * 0.8, len);
      }
      ctx.restore();
      for (const s of signs) drawSign(ctx, s, signGlowOn(s, t));
      // taxis heading away up the street
      for (const tx of taxis) {
        tx.d = (tx.d + dt * tx.speed) % 1;
        const u = tx.d;
        const y = h + (vy - h) * u;
        const x = vx + (w * 0.42 - vx) * (1 - u) * 0.55;
        const s = Math.max(0.15, (1 - u) * Math.min(3.2, h / 300));
        taxi(ctx, x, y, s);
      }
      // rain
      ctx.strokeStyle = "rgba(190,210,255,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of drops) {
        d.y += d.speed * dt;
        d.x += d.speed * dt * 0.12;
        if (d.y > h) {
          d.y = -20;
          d.x = Math.random() * w;
        }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.len * 0.12, d.y + d.len);
      }
      ctx.stroke();
      glow(ctx, vx, vy, w * 0.25, "rgba(255,80,120,0.08)");
    },
  };
}
