// Victoria Harbour from Tsim Sha Tsui: the Hong Kong Island skyline at dusk,
// Victoria Peak behind, the Star Ferry and a red-sail junk crossing.

import {
  C, aviationLights, bankOfChina, centralPlaza, glow, hsbc, ifc2, layer, lightBands, mirrorLayer, reflect, ridge, rng, sky, starFerry, stars,
  theCenter, tower, junk,
} from "./common.js";

const SKIES = {
  dusk: [[0, "#040816"], [0.35, "#0b1840"], [0.55, "#2a2a63"], [0.64, "#7a4a78"], [0.69, "#d07a62"]],
  night: [[0, "#02050f"], [0.45, "#08122e"], [0.62, "#14204a"], [0.69, "#2b2f5e"]],
};

export function harbour(variant = "dusk") {
  let w = 0, h = 0, dpr = 1, waterY = 0;
  let base = null;
  let mirror = null;
  let roofs = [];
  let bands = [];
  let beamsUntil = 0;
  const shimmer = [];

  function build() {
    waterY = Math.round(h * (w < 700 ? 0.6 : 0.66));
    base = layer(w, h, dpr);
    const ctx = base.ctx;
    sky(ctx, w, waterY + 2, SKIES[variant] || SKIES.dusk);
    stars(ctx, w, waterY, Math.round(w / 6), 4, 0.45);
    // Victoria Peak and the island's hills
    ridge(ctx, w, waterY, { seed: 3, height: waterY * 0.5, peaks: [{ at: 0.3, width: 0.14, height: 0.7 }, { at: 0.82, width: 0.2, height: 0.3 }], color: "#0b1534" });
    ridge(ctx, w, waterY, { seed: 9, height: waterY * 0.36, peaks: [{ at: 0.58, width: 0.2, height: 0.35 }], color: "#0e1a40", rough: 0.6 });
    // a little haze where the city lights meet the hills
    const haze = ctx.createLinearGradient(0, waterY - waterY * 0.3, 0, waterY);
    haze.addColorStop(0, "rgba(120,90,160,0)");
    haze.addColorStop(1, "rgba(150,110,170,0.18)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, waterY - waterY * 0.3, w, waterY * 0.3);

    const unit = Math.max(w / 1440, 0.5);
    const H = waterY;
    roofs = [];
    bands = [];
    // background towers
    const r = rng(21);
    let x = -10;
    while (x < w) {
      const bw = (18 + r() * 34) * unit;
      const bh = H * (0.07 + Math.pow(r(), 1.6) * 0.2);
      const roof = ["flat", "flat", "antenna", "slant", "pyramid"][Math.floor(r() * 5)];
      const p = tower(ctx, x, waterY, bw, bh, { seed: Math.floor(r() * 1000), roof, lit: 0.22 + r() * 0.2, color: "#111d40" });
      if (r() < 0.25) roofs.push(p);
      x += bw + r() * 6 * unit;
    }
    // mid towers
    x = 0;
    while (x < w) {
      const bw = (22 + r() * 30) * unit;
      const bh = H * (0.14 + r() * 0.16);
      tower(ctx, x, waterY, bw, bh, { seed: Math.floor(r() * 1000), roof: r() < 0.3 ? "antenna" : "flat", lit: 0.42, color: "#121f44" });
      x += bw + (30 + r() * 80) * unit;
    }
    // landmarks, west to east as seen from Tsim Sha Tsui
    const at = (u) => w * u;
    const center = theCenter(ctx, at(0.13), waterY, 26 * unit, H * 0.5);
    bands.push({ b: center.bands, palette: ["#00F0FF", "#FF3D8B", "#F0D27A", "#7CFF8A", "#8C6CFF"], count: 26, speed: 0.35 });
    roofs.push(center);
    roofs.push(ifc2(ctx, at(0.235), waterY, 44 * unit, H * 0.66));
    roofs.push(tower(ctx, at(0.31), waterY, 34 * unit, H * 0.36, { seed: 31, roof: "flat", lit: 0.55, warm: 0.2 }));
    roofs.push(hsbc(ctx, at(0.355), waterY, 46 * unit, H * 0.27));
    roofs.push(bankOfChina(ctx, at(0.41), waterY, 48 * unit, H * 0.54));
    roofs.push(tower(ctx, at(0.47), waterY, 40 * unit, H * 0.42, { seed: 41, roof: "flat", lit: 0.7, warm: 0.05 }));
    roofs.push(tower(ctx, at(0.52), waterY, 30 * unit, H * 0.33, { seed: 51, roof: "slant", lit: 0.5 }));
    roofs.push(tower(ctx, at(0.6), waterY, 32 * unit, H * 0.3, { seed: 61, roof: "antenna" }));
    const plaza = centralPlaza(ctx, at(0.67), waterY, 38 * unit, H * 0.52);
    bands.push({ b: plaza.bands, palette: ["#F0D27A", "#FF9E3D", "#FF3D8B", "#00F0FF"], count: 8, speed: 0.12, thickness: 0.18 });
    roofs.push(plaza);
    roofs.push(tower(ctx, at(0.75), waterY, 30 * unit, H * 0.38, { seed: 71, roof: "antenna" }));
    roofs.push(tower(ctx, at(0.84), waterY, 36 * unit, H * 0.31, { seed: 81, roof: "pyramid" }));
    // Convention centre's wing roof on the waterfront
    ctx.fillStyle = "#16244c";
    ctx.beginPath();
    ctx.moveTo(at(0.69), waterY);
    ctx.quadraticCurveTo(at(0.73), waterY - H * 0.09, at(0.79), waterY - H * 0.035);
    ctx.lineTo(at(0.8), waterY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,214,140,0.55)";
    ctx.fillRect(at(0.695), waterY - 6, at(0.1), 3);
    // the waterfront glow
    const g = ctx.createLinearGradient(0, waterY - 40, 0, waterY);
    g.addColorStop(0, "rgba(255,190,110,0)");
    g.addColorStop(1, "rgba(255,190,110,0.22)");
    ctx.fillStyle = g;
    ctx.fillRect(0, waterY - 40, w, 40);

    mirror = mirrorLayer(base.canvas, dpr, w, waterY, h - waterY);
    shimmer.length = 0;
    const rs = rng(5);
    for (let i = 0; i < Math.round(w / 9); i++) {
      shimmer.push({ x: rs() * w, y: waterY + 6 + Math.pow(rs(), 1.6) * (h - waterY - 10), len: 6 + rs() * 26, speed: 4 + rs() * 10, phase: rs() * 6 });
    }
  }

  return {
    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      build();
    },
    event(kind) {
      if (kind === "solve" || kind === "celebrate") beamsUntil = performance.now() + 6000;
    },
    draw(ctx, _w, _h, t) {
      if (!base) return;
      ctx.drawImage(base.canvas, 0, 0, w, h);
      // Symphony of Lights: beams sweep from the rooftops now and then
      const show = (t % 40) < 12 || performance.now() < beamsUntil;
      if (show) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        roofs.slice(-9).forEach((p, i) => {
          if (i % 2) return;
          const angle = -Math.PI / 2 + Math.sin(t * 0.6 + i) * 0.55;
          const len = h * 0.9;
          const spread = 0.035;
          const g = ctx.createLinearGradient(p.x, p.y, p.x + Math.cos(angle) * len, p.y + Math.sin(angle) * len);
          const color = i % 4 === 0 ? "0,240,255" : "240,210,122";
          g.addColorStop(0, `rgba(${color},0.35)`);
          g.addColorStop(1, `rgba(${color},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(angle - spread) * len, p.y + Math.sin(angle - spread) * len);
          ctx.lineTo(p.x + Math.cos(angle + spread) * len, p.y + Math.sin(angle + spread) * len);
          ctx.closePath();
          ctx.fill();
        });
        ctx.restore();
      }
      for (const band of bands) lightBands(ctx, band.b, t, band);
      aviationLights(ctx, roofs.filter((_, i) => i % 3 === 0), t);

      // harbour water
      const wg = ctx.createLinearGradient(0, waterY, 0, h);
      wg.addColorStop(0, "#0d1838");
      wg.addColorStop(1, "#02060f");
      ctx.fillStyle = wg;
      ctx.fillRect(0, waterY, w, h - waterY);
      reflect(ctx, mirror, dpr, w, waterY, h - waterY, t);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const s of shimmer) {
        const a = 0.15 + 0.25 * Math.sin(t * 1.3 + s.phase);
        if (a <= 0.05) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = s.x % 3 < 1 ? C.goldLight : "#9fdcff";
        const x = (s.x + t * s.speed) % (w + 40) - 20;
        ctx.fillRect(x, s.y, s.len, 1);
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // boats
      const ferryX = ((t * 18 + w * 0.35) % (w + 240)) - 120;
      starFerry(ctx, ferryX, waterY + (h - waterY) * 0.32, Math.max(0.7, w / 1600), 1);
      const junkX = w + 100 - ((t * 9 + w * 0.4) % (w + 200));
      junk(ctx, junkX, waterY + (h - waterY) * 0.62, Math.max(0.8, w / 1300), t);
      glow(ctx, junkX + 6, waterY + (h - waterY) * 0.62 - 20, 50, "rgba(255,60,40,0.12)");
    },
  };
}
