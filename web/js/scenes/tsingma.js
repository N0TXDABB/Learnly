// Tsing Ma Bridge at night: the suspension bridge that links the city to the airport.
// Here it stands for the link between the website and the AI on your computer:
// traffic flows while the local model is working, and the lights dim when it is offline.

import { glow, layer, mirrorLayer, reflect, ridge, rng, sky, stars } from "./common.js";

export function tsingma(variant = "night") {
  let w = 0, h = 0, dpr = 1, deckY = 0, waterY = 0;
  let base = null;
  let mirror = null;
  let towers = [];
  let cars = [];
  let train = null;
  let lastSpawn = 0;
  let connected = true;
  let activity = 0.3;

  function cableY(x) {
    // main cable: anchorages at the edges, up to the tower tops, sagging between
    const [t1, t2] = towers;
    const topY = t1.top;
    if (x <= t1.x) return lerpY(x, -w * 0.05, deckY - 6, t1.x, topY, 1.15);
    if (x >= t2.x) return lerpY(x, t2.x, topY, w * 1.05, deckY - 6, 0.85);
    const u = (x - t1.x) / (t2.x - t1.x);
    const sag = (deckY - 14) - topY;
    return topY + sag * (1 - Math.pow(2 * u - 1, 2));
  }

  function lerpY(x, x0, y0, x1, y1, curve) {
    const u = (x - x0) / (x1 - x0);
    return y0 + (y1 - y0) * Math.pow(u, curve);
  }

  function build() {
    waterY = Math.round(h * 0.74);
    deckY = Math.round(h * 0.6);
    base = layer(w, h, dpr);
    const ctx = base.ctx;
    sky(ctx, w, waterY + 2, variant === "dawn"
      ? [[0, "#07112b"], [0.5, "#1d2b5c"], [0.8, "#6a4f7a"], [1, "#c98b6b"]]
      : [[0, "#02050f"], [0.55, "#0a1534"], [0.85, "#1a2550"], [1, "#2a2c58"]]);
    stars(ctx, w, waterY, Math.round(w / 5), 12, 0.55);
    ridge(ctx, w, waterY, { seed: 14, height: h * 0.2, peaks: [{ at: 0.08, width: 0.1, height: 0.6 }, { at: 0.9, width: 0.14, height: 0.5 }], color: "#0a1330" });
    ridge(ctx, w, waterY, { seed: 27, height: h * 0.1, peaks: [{ at: 0.5, width: 0.3, height: 0.2 }], color: "#0d1838", rough: 0.4 });
    // distant Tsing Yi container port lights
    const r = rng(3);
    for (let i = 0; i < w / 6; i++) {
      ctx.fillStyle = r() < 0.5 ? "rgba(255,210,122,0.8)" : "rgba(190,230,255,0.7)";
      ctx.fillRect(r() * w, waterY - 2 - r() * h * 0.03, 1.5, 1.5);
    }
    const towerH = h * 0.42;
    towers = [
      { x: w * 0.24, top: deckY - towerH },
      { x: w * 0.76, top: deckY - towerH },
    ];
    // towers: portal frames with four cross-beams
    const tw = Math.max(16, w * 0.022);
    for (const t of towers) {
      ctx.fillStyle = "#1b2647";
      ctx.fillRect(t.x - tw, t.top, tw * 0.55, waterY - t.top);
      ctx.fillRect(t.x + tw * 0.45, t.top, tw * 0.55, waterY - t.top);
      for (const f of [0, 0.3, 0.62, 0.9]) {
        ctx.fillRect(t.x - tw, t.top + (deckY - t.top) * f, tw * 2, tw * 0.45);
      }
      // floodlit legs: brighter towards the deck
      for (const lx of [t.x - tw, t.x + tw * 0.45]) {
        const g = ctx.createLinearGradient(0, t.top, 0, deckY);
        g.addColorStop(0, "rgba(240,210,122,0.05)");
        g.addColorStop(1, "rgba(240,210,122,0.32)");
        ctx.fillStyle = g;
        ctx.fillRect(lx, t.top, tw * 0.55, deckY - t.top);
        ctx.fillStyle = "rgba(220,235,255,0.55)";
        ctx.fillRect(lx, t.top, 1.2, waterY - t.top);
      }
    }
    // hangers
    ctx.strokeStyle = "rgba(170,190,230,0.35)";
    ctx.lineWidth = 1;
    for (let x = w * 0.02; x < w * 0.98; x += Math.max(9, w / 140)) {
      if (Math.abs(x - towers[0].x) < tw * 1.2 || Math.abs(x - towers[1].x) < tw * 1.2) continue;
      ctx.beginPath();
      ctx.moveTo(x, cableY(x));
      ctx.lineTo(x, deckY);
      ctx.stroke();
    }
    // main cables
    ctx.strokeStyle = "#8ea3c8";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let x = -w * 0.05; x <= w * 1.05; x += 4) {
      const y = cableY(x);
      if (x === -w * 0.05) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // deck: road above, rail below, truss between
    ctx.fillStyle = "#121b38";
    ctx.fillRect(0, deckY, w, h * 0.035);
    ctx.strokeStyle = "rgba(140,160,200,0.35)";
    ctx.lineWidth = 1;
    const dh = h * 0.035;
    for (let x = 0; x < w; x += dh) {
      ctx.beginPath();
      ctx.moveTo(x, deckY);
      ctx.lineTo(x + dh, deckY + dh);
      ctx.moveTo(x + dh, deckY);
      ctx.lineTo(x, deckY + dh);
      ctx.stroke();
    }
    ctx.fillStyle = "#1c2850";
    ctx.fillRect(0, deckY - 3, w, 3);
    // street lamps along the road deck
    for (let x = 6; x < w; x += Math.max(18, w / 80)) {
      ctx.fillStyle = "rgba(255,214,140,0.9)";
      ctx.fillRect(x, deckY - 9, 1.6, 1.6);
      ctx.fillStyle = "rgba(120,140,180,0.5)";
      ctx.fillRect(x + 0.4, deckY - 8, 0.8, 6);
    }
    // piers of the approach viaduct
    ctx.fillStyle = "#0f1734";
    for (const x of [w * 0.06, w * 0.94]) ctx.fillRect(x - 5, deckY + dh, 10, waterY - deckY - dh);
    mirror = mirrorLayer(base.canvas, dpr, w, waterY, h - waterY);
  }

  function spawnCar(dir) {
    cars.push({
      x: dir > 0 ? -20 : w + 20,
      dir,
      speed: (110 + Math.random() * 90) * (w / 1440 + 0.4),
      lane: dir > 0 ? -7 : -4,
    });
  }

  return {
    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      cars = [];
      build();
      for (let i = 0; i < 14; i++) {  // start with traffic already on the bridge
        spawnCar(i % 2 ? 1 : -1);
        cars[cars.length - 1].x = Math.random() * w;
      }
    },
    onData(data) {
      connected = data.aiOk !== false;
      if (typeof data.activity === "number") activity = data.activity;
    },
    event(kind) {
      if (kind === "tokens" || kind === "ai") {
        activity = Math.min(1, activity + 0.15);
        spawnCar(Math.random() < 0.5 ? 1 : -1);
      }
      if (kind === "train") train = { x: -w * 0.3 };
    },
    draw(ctx, _w, _h, t, dt) {
      if (!base) return;
      ctx.drawImage(base.canvas, 0, 0, w, h);
      // cable lights: a string of gold lamps (dim red when the AI is offline)
      const lampColor = connected ? "rgba(255,214,120," : "rgba(255,80,90,";
      for (let x = w * 0.01; x < w * 0.99; x += Math.max(14, w / 70)) {
        const y = cableY(x);
        const a = connected ? 0.75 + 0.25 * Math.sin(t * 2 + x * 0.05) : 0.35;
        ctx.fillStyle = lampColor + a + ")";
        ctx.fillRect(x - 1.4, y - 1.4, 2.8, 2.8);
        glow(ctx, x, y, connected ? 9 : 5, lampColor + (connected ? "0.45)" : "0.2)"));
      }
      for (const tw of towers) glow(ctx, tw.x, tw.top - 3, 10, Math.sin(t * 2.4) > 0 ? "rgba(255,40,40,0.95)" : "rgba(255,40,40,0.15)");
      // traffic
      activity = Math.max(connected ? 0.12 : 0.03, activity - dt * 0.03);
      if (t - lastSpawn > (1.4 - activity * 1.2) && Math.random() < 0.7) {
        spawnCar(Math.random() < 0.5 ? 1 : -1);
        lastSpawn = t;
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      cars = cars.filter((c) => c.x > -40 && c.x < w + 40);
      for (const c of cars) {
        c.x += c.dir * c.speed * dt;
        const y = deckY + c.lane;
        if (c.dir > 0) {
          ctx.fillStyle = "rgba(255,250,235,0.95)";
          ctx.fillRect(c.x, y, 3, 1.6);
          const g = ctx.createLinearGradient(c.x + 3, 0, c.x + 40, 0);
          g.addColorStop(0, "rgba(255,245,220,0.45)");
          g.addColorStop(1, "rgba(255,245,220,0)");
          ctx.fillStyle = g;
          ctx.fillRect(c.x + 3, y - 1, 37, 3.5);
        } else {
          ctx.fillStyle = "rgba(255,50,50,0.95)";
          ctx.fillRect(c.x, y, 3, 1.6);
          const g = ctx.createLinearGradient(c.x, 0, c.x + 26, 0);
          g.addColorStop(0, "rgba(255,40,40,0.4)");
          g.addColorStop(1, "rgba(255,40,40,0)");
          ctx.fillStyle = g;
          ctx.fillRect(c.x, y - 1, 26, 3.5);
        }
      }
      // Airport Express on the lower deck now and then
      if (!train && connected && Math.random() < dt * 0.04) train = { x: -w * 0.3 };
      if (train) {
        train.x += dt * w * 0.32;
        const ty = deckY + h * 0.035 * 0.55;
        const g = ctx.createLinearGradient(train.x, 0, train.x + w * 0.22, 0);
        g.addColorStop(0, "rgba(0,240,255,0)");
        g.addColorStop(0.8, "rgba(0,240,255,0.55)");
        g.addColorStop(1, "rgba(220,255,255,0.95)");
        ctx.fillStyle = g;
        ctx.fillRect(train.x, ty, w * 0.22, 3);
        if (train.x > w * 1.1) train = null;
      }
      ctx.restore();
      // sea
      const wg = ctx.createLinearGradient(0, waterY, 0, h);
      wg.addColorStop(0, "#0b1533");
      wg.addColorStop(1, "#02050d");
      ctx.fillStyle = wg;
      ctx.fillRect(0, waterY, w, h - waterY);
      reflect(ctx, mirror, dpr, w, waterY, h - waterY, t, { strength: 0.7, amp: 2.5 });
    },
  };
}
