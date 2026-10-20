// Wan Chai in the evening: Central Plaza's gold bands above, the Convention Centre's
// wing roof by the harbour, a row of shophouses with warm study lights, and the
// double-decker "ding ding" tram rolling past under its wires. Used for the tutor:
// the tram sets off whenever the tutor answers.

import { centralPlaza, glow, layer, lightBands, rng, sky, stars, tongLau, tower, tram } from "./common.js";

export function wanchai() {
  let w = 0, h = 0, dpr = 1, street = 0;
  let base = null;
  let front = null;
  let plaza = null;
  let trams = [];
  let thinking = false;
  let lampPhase = [];

  function build() {
    street = Math.round(h * 0.8);
    base = layer(w, h, dpr);
    const ctx = base.ctx;
    sky(ctx, w, street, [[0, "#050818"], [0.45, "#12193f"], [0.75, "#3b2a55"], [1, "#a0566a"]]);
    stars(ctx, w, street * 0.5, Math.round(w / 9), 31, 1);
    const unit = Math.max(w / 1440, 0.55);
    const r = rng(12);
    // far towers
    let x = -10;
    while (x < w) {
      const bw = (20 + r() * 30) * unit;
      tower(ctx, x, street - h * 0.08, bw, h * (0.18 + r() * 0.22), { seed: Math.floor(r() * 999), lit: 0.3, color: "#111c3e", roof: r() < 0.3 ? "antenna" : "flat" });
      x += bw + r() * 30 * unit;
    }
    // Central Plaza and Hopewell Centre (the round one)
    plaza = centralPlaza(ctx, w * 0.62, street - h * 0.08, 46 * unit, h * 0.62);
    const hx = w * 0.82;
    const hw = 34 * unit;
    ctx.fillStyle = "#14204a";
    ctx.fillRect(hx, street - h * 0.08 - h * 0.42, hw, h * 0.42);
    ctx.beginPath();
    ctx.ellipse(hx + hw / 2, street - h * 0.08 - h * 0.42, hw / 2, hw * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,214,140,0.6)";
    for (let i = 0; i < 26; i++) ctx.fillRect(hx + 2, street - h * 0.1 - i * h * 0.016, hw - 4, 1.2);
    // shophouses, shop signs, wires and the street go on a front layer,
    // so Central Plaza's animated bands stay behind them
    front = layer(w, h, dpr);
    {
    const ctx = front.ctx;
    // shophouses along the street
    x = -5;
    const rs = rng(55);
    while (x < w) {
      const bw = (70 + rs() * 70) * unit;
      const bh = h * (0.13 + rs() * 0.12);
      tongLau(ctx, x, street, bw, bh, Math.floor(rs() * 999), ["#1b1626", "#191a2c", "#20172a"][Math.floor(rs() * 3)]);
      x += bw + 2;
    }
    // shop signs at street level
    const shop = rng(9);
    for (let sx = 20; sx < w; sx += 120 * unit + shop() * 90 * unit) {
      ctx.fillStyle = ["#ff9e3d", "#00F0FF", "#FF3D8B", "#F0D27A"][Math.floor(shop() * 4)];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(sx, street - h * 0.05, 50 * unit, 8 * unit);
      ctx.globalAlpha = 1;
    }
    // the street, tram tracks and overhead wires
    ctx.fillStyle = "#08080f";
    ctx.fillRect(0, street, w, h - street);
    ctx.fillStyle = "rgba(200,200,220,0.25)";
    ctx.fillRect(0, street + (h - street) * 0.45, w, 1.5);
    ctx.fillRect(0, street + (h - street) * 0.6, w, 1.5);
    ctx.strokeStyle = "rgba(160,170,200,0.4)";
    ctx.lineWidth = 1;
    for (const y of [street - h * 0.115, street - h * 0.12]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    }
    lampPhase = Array.from({ length: Math.ceil(w / 160) }, (_, i) => i * 1.7);
    trams = [{ x: w * 0.3, dir: 1, speed: 0, color: "#1e6b3a" }];
  }

  return {
    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      build();
    },
    onData(data) {
      thinking = !!data.tutorBusy;
    },
    event(kind) {
      if (kind === "answer" || kind === "ask") {
        const dir = Math.random() < 0.5 ? 1 : -1;
        trams.push({ x: dir > 0 ? -80 : w + 80, dir, speed: 70 + Math.random() * 40, color: Math.random() < 0.5 ? "#1e6b3a" : "#a8322b" });
      }
    },
    draw(ctx, _w, _h, t, dt) {
      if (!base) return;
      ctx.drawImage(base.canvas, 0, 0, w, h);
      if (plaza) lightBands(ctx, plaza.bands, t, { count: 9, palette: ["#F0D27A", "#FF9E3D", "#F0D27A", "#00F0FF"], speed: 0.1, thickness: 0.16 });
      ctx.drawImage(front.canvas, 0, 0, w, h);
      // street lamps
      lampPhase.forEach((p, i) => {
        const x = i * 160 + 60;
        ctx.fillStyle = "#2a2f45";
        ctx.fillRect(x, street - h * 0.1, 2, h * 0.1);
        glow(ctx, x + 1, street - h * 0.1, 26, "rgba(255,200,120,0.4)");
      });
      // trams: one waits at the stop; more roll by when the tutor answers
      const s = Math.max(0.9, h / 480);
      trams = trams.filter((tr) => tr.x > -120 && tr.x < w + 120);
      if (!trams.length) trams.push({ x: w * 0.3, dir: 1, speed: 0, color: "#1e6b3a" });
      for (const tr of trams) {
        if (thinking && tr.speed === 0) tr.speed = 10;
        tr.x += tr.dir * tr.speed * dt;
        tram(ctx, tr.x, street + (h - street) * 0.55, s, tr.color);
        if (thinking && Math.sin(t * 10) > 0) glow(ctx, tr.x + 10 * s, street + (h - street) * 0.55 - 64 * s, 8, "rgba(0,240,255,0.9)");
      }
      // warm light spilling onto the wet street
      const g = ctx.createLinearGradient(0, street, 0, h);
      g.addColorStop(0, "rgba(255,190,110,0.16)");
      g.addColorStop(1, "rgba(255,190,110,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, street, w, h - street);
      glow(ctx, w * 0.5, street, w * 0.4, "rgba(255,160,80,0.05)");
    },
  };
}
