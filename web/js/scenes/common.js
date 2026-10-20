// Shared drawing helpers and Hong Kong landmarks for the canvas scenes.
// All shapes are drawn procedurally, so the scenes work offline and stay sharp at any size.

export const C = {
  night: "#0A1128",
  gold: "#D4AF37",
  goldLight: "#F0D27A",
  neon: "#00F0FF",
  pink: "#FF3D8B",
  warm: "#FFD27A",
  cool: "#BFE8FF",
  white: "#F4F8FF",
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function layer(w, h, dpr) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx };
}

export function sky(ctx, w, h, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function stars(ctx, w, h, count, seed, maxY = 0.5) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const y = r() * h * maxY;
    const size = r() < 0.08 ? 1.4 : 0.8;
    ctx.globalAlpha = 0.25 + r() * 0.6;
    ctx.fillStyle = r() < 0.2 ? "#ffe9b0" : "#dfe9ff";
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalAlpha = 1;
}

export function glow(ctx, x, y, radius, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

/** A hill ridge (Victoria Peak, Lion Rock …) as a filled silhouette. */
export function ridge(ctx, w, baseY, { seed = 1, height = 120, peaks = [], color = "#0b1328", rough = 1 } = {}) {
  const r = rng(seed);
  const phases = [r() * 6, r() * 6, r() * 6];
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let x = 0; x <= w; x += 4) {
    const u = x / w;
    let y = Math.sin(u * 3.1 + phases[0]) * 0.35 + Math.sin(u * 7.3 + phases[1]) * 0.18 * rough + Math.sin(u * 17 + phases[2]) * 0.06 * rough;
    for (const p of peaks) {
      const d = (u - p.at) / p.width;
      y += p.height * Math.exp(-d * d);
    }
    ctx.lineTo(x, baseY - height * (0.45 + y * 0.5));
  }
  ctx.lineTo(w, baseY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function facade(ctx, x, y, w, h, top = "#16244a", bottom = "#0a1330") {
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, bottom);
  g.addColorStop(0.55, top);
  g.addColorStop(1, bottom);
  return g;
}

/** Grid of windows. `lit` is the share of windows switched on. */
export function windows(ctx, x, y, w, h, { seed = 1, cols, rows, lit = 0.45, warm = 0.7, size = 0.55, colors } = {}) {
  const r = rng(seed);
  cols = cols || Math.max(2, Math.floor(w / 5));
  rows = rows || Math.max(2, Math.floor(h / 6));
  const cw = w / cols;
  const rh = h / rows;
  const ww = Math.max(1, cw * size);
  const wh = Math.max(1, rh * size);
  for (let i = 0; i < rows; i++) {
    const rowBias = r() < 0.12 ? 0.25 : 1; // some floors are dark
    for (let j = 0; j < cols; j++) {
      if (r() > lit * rowBias) continue;
      const c = colors ? colors[Math.floor(r() * colors.length)] : r() < warm ? C.warm : C.cool;
      ctx.globalAlpha = 0.45 + r() * 0.55;
      ctx.fillStyle = c;
      ctx.fillRect(x + j * cw + (cw - ww) / 2, y + i * rh + (rh - wh) / 2, ww, wh);
    }
  }
  ctx.globalAlpha = 1;
}

/** Generic tower with optional setback and roof style. Returns its roof point for lights. */
export function tower(ctx, x, base, w, h, opts = {}) {
  const { seed = 1, roof = "flat", lit = 0.4, color, setback = 0, warm = 0.7 } = opts;
  const top = base - h;
  ctx.fillStyle = color || facade(ctx, x, top, w, h);
  ctx.fillRect(x, top, w, h);
  if (setback) {
    const sw = w * (1 - setback);
    const sx = x + (w - sw) / 2;
    ctx.fillRect(sx, top - h * 0.08, sw, h * 0.08 + 1);
  }
  windows(ctx, x + 2, top + 4, w - 4, h - 8, { seed, lit, warm });
  ctx.fillStyle = color || "#101c3d";
  let roofX = x + w / 2;
  let roofY = top - (setback ? h * 0.08 : 0);
  if (roof === "antenna") {
    ctx.fillRect(roofX - 0.75, roofY - h * 0.12, 1.5, h * 0.12);
    roofY -= h * 0.12;
  } else if (roof === "slant") {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + w, top - w * 0.5);
    ctx.lineTo(x + w, top);
    ctx.closePath();
    ctx.fill();
    roofX = x + w;
    roofY = top - w * 0.5;
  } else if (roof === "pyramid") {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + w / 2, top - w * 0.55);
    ctx.lineTo(x + w, top);
    ctx.closePath();
    ctx.fill();
    roofY = top - w * 0.55;
  }
  // a thin lit edge where the facade catches city light
  ctx.fillStyle = "rgba(160,190,255,0.12)";
  ctx.fillRect(x, top, 1, h);
  return { x: roofX, y: roofY };
}

/** Two International Finance Centre: tall shaft, stepped top, claw-like crown. */
export function ifc2(ctx, x, base, w, h, seed = 7) {
  const top = base - h;
  ctx.fillStyle = facade(ctx, x, top, w, h, "#1c2c55", "#0c1533");
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x, top + h * 0.12);
  ctx.lineTo(x + w * 0.08, top + h * 0.08);
  ctx.lineTo(x + w * 0.08, top + h * 0.045);
  ctx.lineTo(x + w * 0.17, top + h * 0.03);
  ctx.lineTo(x + w * 0.83, top + h * 0.03);
  ctx.lineTo(x + w * 0.92, top + h * 0.045);
  ctx.lineTo(x + w * 0.92, top + h * 0.08);
  ctx.lineTo(x + w, top + h * 0.12);
  ctx.lineTo(x + w, base);
  ctx.closePath();
  ctx.fill();
  // crown fins
  const fins = [0.2, 0.36, 0.5, 0.64, 0.8];
  fins.forEach((f, i) => {
    const fh = h * (0.03 + (i === 2 ? 0.045 : i % 2 ? 0.025 : 0.035));
    ctx.fillStyle = "#1a2a52";
    ctx.fillRect(x + w * f - w * 0.035, top + h * 0.03 - fh, w * 0.07, fh);
    ctx.fillStyle = "rgba(225,240,255,0.85)";
    ctx.fillRect(x + w * f - 0.6, top + h * 0.03 - fh, 1.2, fh);
  });
  // vertical light lines (the ribs glow white at night)
  ctx.fillStyle = "rgba(220,236,255,0.55)";
  for (const f of [0.08, 0.92]) ctx.fillRect(x + w * f - 0.6, top + h * 0.1, 1.2, h * 0.9);
  ctx.fillStyle = "rgba(220,236,255,0.18)";
  for (let f = 0.2; f < 0.85; f += 0.12) ctx.fillRect(x + w * f, top + h * 0.12, 1, h * 0.88);
  windows(ctx, x + 3, top + h * 0.13, w - 6, h * 0.85, { seed, cols: 9, rows: 70, lit: 0.42, warm: 0.35 });
  return { x: x + w * 0.5, y: top + h * 0.03 - h * 0.075 };
}

/** Bank of China Tower: prism with the white X bracing and two masts. */
export function bankOfChina(ctx, x, base, w, h) {
  const p = (u, v) => [x + u * w, base - v * h];
  const outline = [p(0, 0), p(1, 0), p(1, 0.88), p(0.5, 1.0), p(0.5, 0.82), p(0, 0.62)];
  ctx.beginPath();
  outline.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  const g = ctx.createLinearGradient(x, base - h, x + w, base);
  g.addColorStop(0, "#22335e");
  g.addColorStop(0.5, "#122046");
  g.addColorStop(1, "#0b1431");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // glass reflection bands
  ctx.fillStyle = "rgba(120,160,255,0.08)";
  ctx.fillRect(x + w * 0.5, base - h, w * 0.5, h);
  // X bracing modules
  ctx.strokeStyle = "rgba(235,248,255,0.92)";
  ctx.lineWidth = Math.max(1, w * 0.018);
  ctx.shadowColor = "rgba(190,230,255,0.9)";
  ctx.shadowBlur = 6;
  const module = w * 0.95;
  for (let v0 = 0; v0 < h; v0 += module) {
    const y0 = base - v0;
    const y1 = base - v0 - module;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + w, y1);
    ctx.moveTo(x + w, y0);
    ctx.lineTo(x, y1);
    ctx.moveTo(x, y1);
    ctx.lineTo(x + w, y1);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x + w / 2, base);
  ctx.lineTo(x + w / 2, base - h);
  ctx.stroke();
  // sloped roof edges
  ctx.beginPath();
  ctx.moveTo(...p(0, 0.62));
  ctx.lineTo(...p(0.5, 0.82));
  ctx.moveTo(...p(0.5, 1.0));
  ctx.lineTo(...p(1, 0.88));
  ctx.stroke();
  ctx.restore();
  ctx.shadowBlur = 0;
  // masts
  ctx.fillStyle = "#c9d6ea";
  const [mx, my] = p(0.5, 1.0);
  ctx.fillRect(mx - 1.6, my - h * 0.13, 1.4, h * 0.13);
  ctx.fillRect(mx + 3, my - h * 0.1 + 4, 1.2, h * 0.1 - 4);
  return { x: mx - 1, y: my - h * 0.13 };
}

/** Central Plaza: tall shaft, pyramid crown and spire; light bands are drawn per frame. */
export function centralPlaza(ctx, x, base, w, h, seed = 11) {
  const top = base - h;
  ctx.fillStyle = facade(ctx, x, top, w, h, "#1d2747", "#0d1430");
  ctx.fillRect(x, top + h * 0.1, w, h * 0.9);
  ctx.beginPath();
  ctx.moveTo(x, top + h * 0.1);
  ctx.lineTo(x + w * 0.15, top + h * 0.06);
  ctx.lineTo(x + w * 0.5, top);
  ctx.lineTo(x + w * 0.85, top + h * 0.06);
  ctx.lineTo(x + w, top + h * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#cfd8e8";
  ctx.fillRect(x + w / 2 - 0.8, top - h * 0.16, 1.6, h * 0.16);
  windows(ctx, x + 3, top + h * 0.12, w - 6, h * 0.86, { seed, cols: 8, rows: 64, lit: 0.38, warm: 0.85 });
  return { x: x + w / 2, y: top - h * 0.16, bands: { x, y: top + h * 0.1, w, h: h * 0.9 } };
}

/** The Center: slim tower known for colour-changing horizontal light bands (drawn per frame). */
export function theCenter(ctx, x, base, w, h) {
  const top = base - h;
  ctx.fillStyle = facade(ctx, x, top, w, h, "#18213f", "#0b1229");
  ctx.fillRect(x, top + h * 0.06, w, h * 0.94);
  ctx.fillRect(x + w * 0.2, top + h * 0.02, w * 0.6, h * 0.05);
  ctx.fillStyle = "#c7d3e6";
  ctx.fillRect(x + w / 2 - 0.7, top - h * 0.1, 1.4, h * 0.12);
  return { x: x + w / 2, y: top - h * 0.1, bands: { x, y: top + h * 0.06, w, h: h * 0.94 } };
}

/** HSBC Main Building: three stepped bays with exposed "coat-hanger" trusses. */
export function hsbc(ctx, x, base, w, h, seed = 3) {
  const bays = [[0, 0.78], [0.34, 1.0], [0.67, 0.88]];
  for (const [u, hh] of bays) {
    const bx = x + u * w;
    const bw = w * 0.33;
    const top = base - h * hh;
    ctx.fillStyle = "#121d3c";
    ctx.fillRect(bx, top, bw, h * hh);
    windows(ctx, bx + 2, top + 3, bw - 4, h * hh - 6, { seed: seed + u * 10, cols: 6, rows: 26, lit: 0.6, warm: 0.15, size: 0.7 });
    ctx.strokeStyle = "rgba(205,220,240,0.75)";
    ctx.lineWidth = 1.4;
    for (let v = 0.18; v < hh; v += 0.22) {
      const y = base - h * v;
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.lineTo(bx + bw / 2, y - h * 0.05);
      ctx.lineTo(bx + bw, y);
      ctx.moveTo(bx, y);
      ctx.lineTo(bx + bw, y);
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#9fb0c9";
  ctx.fillRect(x + w * 0.5, base - h - h * 0.08, 1.2, h * 0.08);
  return { x: x + w * 0.5, y: base - h * 1.08 };
}

/** International Commerce Centre (Kowloon). */
export function icc(ctx, x, base, w, h, seed = 5) {
  const top = base - h;
  ctx.fillStyle = facade(ctx, x, top, w, h, "#1b2a52", "#0b1431");
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x + w * 0.04, top + h * 0.05);
  ctx.lineTo(x + w * 0.2, top);
  ctx.lineTo(x + w * 0.8, top);
  ctx.lineTo(x + w * 0.96, top + h * 0.05);
  ctx.lineTo(x + w, base);
  ctx.closePath();
  ctx.fill();
  windows(ctx, x + 3, top + h * 0.05, w - 6, h * 0.94, { seed, cols: 10, rows: 80, lit: 0.3, warm: 0.3 });
  return { x: x + w / 2, y: top, face: { x, y: top + h * 0.06, w, h: h * 0.9 } };
}

/** Star Ferry: green hull, white upper deck. */
export function starFerry(ctx, x, y, s, facing = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * s, s);
  ctx.fillStyle = "#1f6b45";
  ctx.beginPath();
  ctx.moveTo(-40, 0);
  ctx.lineTo(40, 0);
  ctx.lineTo(34, 9);
  ctx.lineTo(-34, 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e9efe9";
  ctx.fillRect(-30, -9, 60, 9);
  ctx.fillStyle = "#1f6b45";
  ctx.fillRect(-26, -14, 52, 5);
  ctx.fillStyle = C.warm;
  for (let i = -26; i < 26; i += 6) ctx.fillRect(i, -7, 3.2, 3.5);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-2, -20, 4, 6);
  ctx.restore();
  glow(ctx, x, y - 4 * s, 26 * s, "rgba(255,210,122,0.25)");
}

/** Red-sail junk (like the Aqua Luna). */
export function junk(ctx, x, y, s, t = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = "#3a1b10";
  ctx.beginPath();
  ctx.moveTo(-24, 0);
  ctx.quadraticCurveTo(0, 10, 28, -4);
  ctx.lineTo(24, 3);
  ctx.quadraticCurveTo(0, 8, -22, 4);
  ctx.closePath();
  ctx.fill();
  const sway = Math.sin(t * 0.8) * 1.2;
  for (const [mx, sh, sw] of [[-8, 38, 15], [8, 46, 18]]) {
    ctx.fillStyle = "#c0261f";
    ctx.beginPath();
    ctx.moveTo(mx, -2);
    ctx.lineTo(mx + sway, -sh);
    ctx.quadraticCurveTo(mx + sw * 0.9 + sway, -sh * 0.55, mx + sw, -4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,190,150,0.35)";
    ctx.lineWidth = 0.6;
    for (let k = 1; k < 5; k++) {
      const yy = -sh * (k / 5);
      ctx.beginPath();
      ctx.moveTo(mx + sway * (k / 5), yy);
      ctx.lineTo(mx + sw * (1 - k / 7), yy + 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Hong Kong tram ("ding ding"): double-deck, green with cream windows. */
export function tram(ctx, x, base, s, color = "#1e6b3a", lit = true) {
  ctx.save();
  ctx.translate(x, base);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.fillRect(-30, -46, 60, 42);
  ctx.fillStyle = "#e8e0c8";
  ctx.fillRect(-30, -47, 60, 3);
  ctx.fillStyle = lit ? "#ffe2a0" : "#1b2440";
  for (let i = -26; i < 26; i += 9) {
    ctx.fillRect(i, -40, 6.5, 9);
    ctx.fillRect(i, -22, 6.5, 9);
  }
  ctx.fillStyle = "#111";
  ctx.fillRect(-26, -4, 10, 4);
  ctx.fillRect(16, -4, 10, 4);
  ctx.strokeStyle = "#7e8aa0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -47);
  ctx.lineTo(10, -64);
  ctx.stroke();
  ctx.restore();
}

/** Red Hong Kong taxi seen from behind, with tail lights. */
export function taxi(ctx, x, base, s) {
  ctx.save();
  ctx.translate(x, base);
  ctx.scale(s, s);
  ctx.fillStyle = "#b3141c";
  ctx.fillRect(-14, -12, 28, 9);
  ctx.fillStyle = "#e9e6dc";
  ctx.fillRect(-10, -18, 20, 6);
  ctx.fillStyle = "#2a2f3a";
  ctx.fillRect(-8, -17, 16, 4);
  ctx.fillStyle = "#ff2a2a";
  ctx.fillRect(-14, -9, 4, 3);
  ctx.fillRect(10, -9, 4, 3);
  ctx.fillStyle = "#111";
  ctx.fillRect(-12, -3, 6, 3);
  ctx.fillRect(6, -3, 6, 3);
  ctx.restore();
  glow(ctx, x - 12 * s, base - 7.5 * s, 10 * s, "rgba(255,40,40,0.5)");
  glow(ctx, x + 12 * s, base - 7.5 * s, 10 * s, "rgba(255,40,40,0.5)");
}

/** Neon sign; vertical by default (Chinese text reads top to bottom). */
export function neonSign(ctx, x, y, text, color, { size = 22, vertical = true, on = 1, board = true } = {}) {
  const chars = [...text];
  const cell = size * 1.15;
  const wBox = vertical ? cell + 10 : chars.length * cell + 12;
  const hBox = vertical ? chars.length * cell + 12 : cell + 10;
  if (board) {
    ctx.fillStyle = "rgba(8,6,14,0.82)";
    ctx.fillRect(x, y, wBox, hBox);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35 + 0.65 * on;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14 * on;
    ctx.strokeRect(x + 2, y + 2, wBox - 4, hBox - 4);
  }
  ctx.font = `700 ${size}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = on > 0.5 ? "#fff" : color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18 * on;
  ctx.globalAlpha = 0.3 + 0.7 * on;
  chars.forEach((ch, i) => {
    const cx = vertical ? x + wBox / 2 : x + 6 + cell * i + cell / 2;
    const cy = vertical ? y + 6 + cell * i + cell / 2 : y + hBox / 2;
    ctx.fillText(ch, cx, cy);
  });
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  return { w: wBox, h: hBox };
}

/** Tong lau tenement facade with balconies and air conditioners. */
export function tongLau(ctx, x, base, w, h, seed = 1, tint = "#18162a") {
  const r = rng(seed);
  const top = base - h;
  ctx.fillStyle = tint;
  ctx.fillRect(x, top, w, h);
  const floors = Math.max(4, Math.floor(h / 26));
  const fh = h / floors;
  for (let f = 0; f < floors; f++) {
    const y = top + f * fh;
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(x, y + fh - 3, w, 3);
    const units = Math.max(2, Math.floor(w / 34));
    const uw = w / units;
    for (let u = 0; u < units; u++) {
      const ux = x + u * uw + 4;
      if (r() < 0.55) {
        ctx.fillStyle = r() < 0.6 ? "rgba(255,206,120,0.75)" : "rgba(170,230,255,0.6)";
        ctx.fillRect(ux, y + 6, uw - 8, fh - 12);
      } else {
        ctx.fillStyle = "#0d0c18";
        ctx.fillRect(ux, y + 6, uw - 8, fh - 12);
      }
      if (r() < 0.45) {
        ctx.fillStyle = "#c8c6c0";
        ctx.fillRect(ux + (uw - 8) * 0.6, y + fh - 12, 9, 6); // air conditioner
      }
    }
  }
}

/** Peak Tower: the bowl-shaped building at the top of the Peak Tram. */
export function peakTower(ctx, x, base, w) {
  ctx.fillStyle = "#070c1d";
  ctx.fillRect(x + w * 0.3, base - w * 0.22, w * 0.08, w * 0.22);
  ctx.fillRect(x + w * 0.62, base - w * 0.22, w * 0.08, w * 0.22);
  ctx.beginPath();
  ctx.moveTo(x, base - w * 0.42);
  ctx.quadraticCurveTo(x + w / 2, base - w * 0.28, x + w, base - w * 0.42);
  ctx.lineTo(x + w * 0.88, base - w * 0.2);
  ctx.lineTo(x + w * 0.12, base - w * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(240,210,122,0.85)";
  ctx.lineWidth = 2;
  ctx.shadowColor = C.gold;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(x, base - w * 0.42);
  ctx.quadraticCurveTo(x + w / 2, base - w * 0.28, x + w, base - w * 0.42);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/** Animated colour bands (The Center, Central Plaza). */
export function lightBands(ctx, b, t, { count = 12, palette = ["#00F0FF", "#FF3D8B", "#F0D27A", "#7CFF8A"], speed = 0.25, thickness = 0.32 } = {}) {
  const step = b.h / count;
  for (let i = 0; i < count; i++) {
    const phase = (t * speed + i * 0.08) % palette.length;
    const color = palette[Math.floor(phase)];
    const y = b.y + i * step + step * (1 - thickness) / 2;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillRect(b.x, y, b.w, Math.max(1, step * thickness));
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

/** Red aircraft-warning lights on rooftops, blinking. */
export function aviationLights(ctx, points, t) {
  const on = Math.sin(t * 2.2) > 0.2;
  if (!on) return;
  for (const p of points) glow(ctx, p.x, p.y, 7, "rgba(255,40,40,0.95)");
}

/** A blurred, upside-down copy of the skyline for the water (built once per size). */
export function mirrorLayer(source, dpr, w, waterY, waterH) {
  const m = layer(w, waterH, dpr);
  const ctx = m.ctx;
  ctx.save();
  if ("filter" in ctx) ctx.filter = "blur(1.6px)";
  ctx.translate(0, waterY * 1.0);
  ctx.scale(1, -1);
  ctx.drawImage(source, 0, 0, w * dpr, waterY * dpr, 0, 0, w, waterY);
  ctx.restore();
  // fade with depth
  const g = ctx.createLinearGradient(0, 0, 0, waterH);
  g.addColorStop(0, "rgba(5,10,26,0.25)");
  g.addColorStop(0.5, "rgba(5,10,26,0.7)");
  g.addColorStop(1, "rgba(3,6,15,0.95)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, waterH);
  return m.canvas;
}

/** Draw the mirror layer in thin strips that sway, so the water ripples. */
export function reflect(ctx, mirror, dpr, w, waterY, waterH, t, { strength = 0.75, strip = 2, amp = 3.5 } = {}) {
  ctx.save();
  for (let y = 0; y < waterH; y += strip) {
    const depth = y / waterH;
    const off = Math.sin(t * 1.5 + y * 0.11) * amp * (0.3 + depth * 1.6) + Math.sin(t * 0.6 + y * 0.037) * amp;
    ctx.globalAlpha = strength * (1 - depth * 0.6);
    ctx.drawImage(mirror, 0, y * dpr, w * dpr, strip * dpr, off, waterY + y, w, strip + 0.6);
  }
  ctx.restore();
}
