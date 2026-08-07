/**
 * The instrumentation panel.
 *
 * The number that matters is not FPS on its own — a browser will happily report
 * 60 while the simulation eats 14 ms of a 16.7 ms budget and one hiccup drops
 * you off a cliff. So the HUD splits the frame into the three parts this demo
 * controls (simulation step, renderer sync, everything Cesium does) and draws
 * the last few seconds of frame times, because the shape of that trace says more
 * than any average.
 */

const HISTORY = 180;
const TEXT_INTERVAL_MS = 100;

export class Hud {
  constructor(root) {
    this.root = root;
    this.frames = new Float32Array(HISTORY);
    this.write = 0;
    this.filled = 0;

    this.frameMs = 0;
    this.simMs = 0;
    this.syncMs = 0;
    this.fps = 0;

    this.lastTextAt = 0;
    this.lastRateAt = performance.now();
    this.lastSpawned = 0;
    this.lastDespawned = 0;
    this.spawnRate = 0;
    this.despawnRate = 0;

    this.drawCommands = null;
    this.tilesStreaming = false;

    root.innerHTML = TEMPLATE;
    this.canvas = root.querySelector('[data-spark]');
    this.ctx = this.canvas.getContext('2d');
    this.fields = Object.fromEntries(
      [...root.querySelectorAll('[data-field]')].map((el) => [el.dataset.field, el]),
    );
    this.#resizeCanvas();
    new ResizeObserver(() => this.#resizeCanvas()).observe(this.canvas);
  }

  /** One frame's timings. Called from the render loop, so it stays allocation-free. */
  sample({ frameMs, simMs, syncMs }) {
    this.frames[this.write] = frameMs;
    this.write = (this.write + 1) % HISTORY;
    if (this.filled < HISTORY) this.filled++;

    // Exponential smoothing: the raw per-frame number is unreadable, a plain
    // mean hides the spikes. The sparkline below carries the detail.
    const weight = 0.12;
    this.frameMs += (frameMs - this.frameMs) * weight;
    this.simMs += (simMs - this.simMs) * weight;
    this.syncMs += (syncMs - this.syncMs) * weight;
    this.fps = this.frameMs > 0 ? 1000 / this.frameMs : 0;
  }

  /** Median frame rate over the recorded window — what the auto-ramp watches. */
  medianFps() {
    if (this.filled === 0) return 0;
    const sorted = Array.from(this.frames.subarray(0, this.filled)).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median > 0 ? 1000 / median : 0;
  }

  render(sim, renderer, state) {
    const now = performance.now();
    if (now - this.lastTextAt < TEXT_INTERVAL_MS) return;
    this.lastTextAt = now;

    const elapsed = (now - this.lastRateAt) / 1000;
    if (elapsed >= 0.5) {
      this.spawnRate = (sim.spawned - this.lastSpawned) / elapsed;
      this.despawnRate = (sim.despawned - this.lastDespawned) / elapsed;
      this.lastRateAt = now;
      this.lastSpawned = sim.spawned;
      this.lastDespawned = sim.despawned;
    }

    const live = sim.liveCount;
    const set = (key, value) => {
      const el = this.fields[key];
      if (el) el.textContent = value;
    };

    set('fps', this.fps.toFixed(0));
    set('frame', `${this.frameMs.toFixed(1)} ms`);
    set('sim', `${this.simMs.toFixed(2)} ms`);
    set('sync', `${this.syncMs.toFixed(2)} ms`);
    set('rest', `${Math.max(0, this.frameMs - this.simMs - this.syncMs).toFixed(2)} ms`);
    set('live', live.toLocaleString());
    set('pool', renderer.poolSize.toLocaleString());
    set('churn', `+${this.spawnRate.toFixed(0)} / −${this.despawnRate.toFixed(0)} per s`);
    set('mode', renderer.name === 'primitives' ? 'PointPrimitiveCollection' : 'Entity + PointGraphics');
    set('draws', this.drawCommands === null ? '—' : this.drawCommands.toLocaleString());
    set('tiles', state.terrain ? (this.tilesStreaming ? 'streaming' : 'idle') : 'off');
    set('perPoint', live > 0 ? `${((this.simMs + this.syncMs) * 1000 / live).toFixed(2)} µs` : '—');

    const heap = performance.memory?.usedJSHeapSize;
    set('heap', heap ? `${(heap / 1048576).toFixed(0)} MB` : 'n/a');

    const fpsEl = this.fields.fps;
    if (fpsEl) {
      fpsEl.dataset.grade = this.fps >= 50 ? 'good' : this.fps >= 25 ? 'fair' : 'poor';
    }

    this.#drawSparkline();
  }

  #resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssSize = { width: rect.width, height: rect.height };
  }

  #drawSparkline() {
    const ctx = this.ctx;
    const size = this.cssSize;
    if (!size || size.width === 0) return;
    const { width, height } = size;

    ctx.clearRect(0, 0, width, height);

    // Scale to the worst frame in the window, floored at 33 ms so a smooth run
    // does not get amplified into a mountain range of noise.
    let worst = 33;
    for (let i = 0; i < this.filled; i++) worst = Math.max(worst, this.frames[i]);
    const scale = height / worst;

    // 60 fps and 30 fps reference lines.
    ctx.strokeStyle = 'rgba(148, 178, 214, 0.28)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    for (const budget of [16.7, 33.3]) {
      const y = height - budget * scale;
      if (y < 1) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (this.filled === 0) return;

    const step = width / HISTORY;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < this.filled; i++) {
      // Oldest sample first: the ring buffer's write cursor is "now".
      const value = this.frames[(this.write - this.filled + i + HISTORY * 2) % HISTORY];
      ctx.lineTo(i * step, height - Math.min(value, worst) * scale);
    }
    ctx.lineTo((this.filled - 1) * step, height);
    ctx.closePath();
    ctx.fillStyle = 'rgba(51, 177, 255, 0.20)';
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < this.filled; i++) {
      const value = this.frames[(this.write - this.filled + i + HISTORY * 2) % HISTORY];
      const y = height - Math.min(value, worst) * scale;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * step, y);
    }
    ctx.strokeStyle = '#33b1ff';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

const TEMPLATE = `
  <div class="hud-headline">
    <div class="hud-fps"><span data-field="fps" data-grade="good">0</span><small>fps</small></div>
    <canvas data-spark aria-label="Frame time over the last 180 frames"></canvas>
  </div>
  <dl class="hud-grid">
    <div><dt>frame</dt><dd data-field="frame">—</dd></div>
    <div><dt>sim step</dt><dd data-field="sim">—</dd></div>
    <div><dt>renderer sync</dt><dd data-field="sync">—</dd></div>
    <div><dt>cesium + gpu</dt><dd data-field="rest">—</dd></div>
    <div><dt>live movers</dt><dd data-field="live">—</dd></div>
    <div><dt>slot pool</dt><dd data-field="pool">—</dd></div>
    <div><dt>churn</dt><dd data-field="churn">—</dd></div>
    <div><dt>cpu per mover</dt><dd data-field="perPoint">—</dd></div>
    <div><dt>draw commands</dt><dd data-field="draws">—</dd></div>
    <div><dt>terrain</dt><dd data-field="tiles">—</dd></div>
    <div><dt>js heap</dt><dd data-field="heap">—</dd></div>
    <div class="wide"><dt>rendering via</dt><dd data-field="mode">—</dd></div>
  </dl>
`;
