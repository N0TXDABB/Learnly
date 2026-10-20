// Runs the animated Hong Kong scene behind the page.
// Scenes draw on one full-window canvas. Static layers are cached per size;
// only lights, water, traffic and rain are redrawn each frame (about 30 fps).

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.factories = new Map();
    this.current = null;
    this.previous = null;
    this.fadeStart = 0;
    this.fadeMs = 900;
    this.data = {};
    this.running = false;
    this.lastFrame = 0;
    this.started = performance.now();
    this.zoom = 1;
    this._resize = () => this.resize();
    window.addEventListener("resize", this._resize);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
      else this.start();
    });
    reduceMotion.addEventListener?.("change", () => this.start());
    this.resize();
  }

  register(name, factory) {
    this.factories.set(name, factory);
  }

  get name() {
    return this.current ? this.current.key : null;
  }

  set(name, variant) {
    const key = variant ? `${name}:${variant}` : name;
    if (this.current && this.current.key === key) return;
    const factory = this.factories.get(name);
    if (!factory) return;
    const scene = factory(variant);
    scene.key = key;
    scene.resize?.(this.w, this.h, this.dpr);
    scene.onData?.(this.data);
    this.previous = this.current;
    this.current = scene;
    this.fadeStart = performance.now();
    this.start();
    this.renderOnce();
  }

  setData(patch) {
    Object.assign(this.data, patch);
    this.current?.onData?.(this.data);
    if (!this.running) this.renderOnce();
  }

  pulse(kind, payload) {
    this.current?.event?.(kind, payload);
  }

  setZoom(z) {
    this.zoom = z;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.current?.resize?.(w, h, dpr);
    this.previous?.resize?.(w, h, dpr);
    this.renderOnce();
  }

  start() {
    if (reduceMotion.matches || document.hidden) {
      this.stop();
      this.renderOnce();
      return;
    }
    if (this.running) return;
    this.running = true;
    const tick = (now) => {
      if (!this.running) return;
      if (now - this.lastFrame >= 32) {
        const dt = Math.min(0.1, (now - (this.lastFrame || now)) / 1000);
        this.lastFrame = now;
        this.draw(now, dt);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  renderOnce() {
    this.draw(performance.now(), 0);
  }

  draw(now, dt) {
    const { ctx, dpr } = this;
    if (!this.current) return;
    const t = (now - this.started) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    const fade = reduceMotion.matches ? 1 : Math.min(1, (now - this.fadeStart) / this.fadeMs);
    ctx.save();
    if (this.zoom !== 1) {
      ctx.translate(this.w / 2, this.h / 2);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-this.w / 2, -this.h / 2);
    }
    if (this.previous && fade < 1) {
      this.previous.draw(ctx, this.w, this.h, t, dt, this.data);
      ctx.globalAlpha = fade;
      this.current.draw(ctx, this.w, this.h, t, dt, this.data);
      ctx.globalAlpha = 1;
    } else {
      this.previous = null;
      this.current.draw(ctx, this.w, this.h, t, dt, this.data);
    }
    ctx.restore();
  }
}

export const motionReduced = () => reduceMotion.matches;
