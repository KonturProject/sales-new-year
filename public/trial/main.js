// Пробная площадь: сама крутит двухминутный показ. Нужна, чтобы проверить ТВ и офисные ноутбуки. Это не код игры.
import { W, H, K, P, GROUPS, TO_SHOP, TO_TREE, TO_HOME, SHOP, TREE, LAMPS, WINDOWS, CHIMNEYS, TOYS, TIMES, ATTIC_ITEMS, CELLAR_ITEMS, YARD } from './layout.js';

const D = { bg: 0, prints: 5, pool: 6, tint: 90000, halo: 90010, snow: 90020, fx: 90030 };
const TOY = 70;
const QUERY = new URLSearchParams(location.search), LOW = QUERY.get('quality') === 'low';
const rnd = (a, b) => a + Math.random() * (b - a);
const wait = (scene, ms) => new Promise((r) => scene.time.delayedCall(ms, r));
const tween = (scene, cfg) => new Promise((r) => scene.tweens.add({ ...cfg, onComplete: () => { cfg.onComplete?.(); r(); } }));
const hex = (c) => Phaser.Display.Color.HexStringToColor(c).color;

class Mascot {
  constructor(scene, g) {
    this.scene = scene; this.g = g;
    const p = P(...g.home);
    const useSheet = scene.textures.exists(g.sheet);
    this.sheet = useSheet;
    this.shadow = scene.add.image(p.x, p.y, 'shadow').setDepth(D.pool).setAlpha(0.34).setScale(0.92, 0.6);
    this.sprite = scene.add.sprite(p.x, p.y, useSheet ? g.sheet : g.still, useSheet ? 4 : undefined).setOrigin(0.5, useSheet ? 0.975 : 1);
    const tex = this.sprite.frame;
    this.base = useSheet ? 248 / tex.height : 204 / tex.height;
    this.sprite.setScale(this.base);
    this.x = p.x; this.y = p.y; this.lift = 0; this.phase = rnd(0, 6); this.busy = false; this.run = 0; this.step = 0;
    this.sync();
  }
  sync() {
    this.sprite.setPosition(this.x, this.y - this.lift).setDepth(this.depthOverride ?? this.y);
    this.shadow.setPosition(this.x, this.y - 3).setScale(0.92 * (1 - Math.min(0.5, this.lift / 900)), 0.6 * (1 - Math.min(0.5, this.lift / 900)));
  }
  pose(i) { if (this.sheet) this.sprite.setFrame(i); }
  face(dir) { this.sprite.setFlipX(dir < 0); }
  idle() { this.pose(4); this.sprite.setFlipX(false).setRotation(0).setScale(this.base); }
  /** Бег по точкам мира; длина шага задаёт кадр, чтобы ноги не «скользили». */
  async go(points, speed = 430) {
    for (const t of points) {
      const dx = t.x - this.x, dy = t.y - this.y, dist = Math.hypot(dx, dy);
      if (dist < 4) continue;
      if (Math.abs(dx) > 6) this.face(dx);
      const from = { x: this.x, y: this.y }, o = { t: 0 };
      await tween(this.scene, {
        targets: o, t: 1, duration: (dist / speed) * 1000, ease: 'Linear',
        onUpdate: () => {
          const nx = from.x + dx * o.t, ny = from.y + dy * o.t;
          this.run += Math.hypot(nx - this.x, ny - this.y);
          this.x = nx; this.y = ny;
          const f = Math.floor(this.run / 44) % 4;
          this.pose(f);
          this.lift = (f % 2 === 1 ? 9 : 0) + (this.sheet ? 0 : Math.abs(Math.sin(this.run / 34)) * 16);
          if (!this.sheet) this.sprite.setRotation(Math.sin(this.run / 34) * 0.06);
          const s = Math.floor(this.run / 46);
          if (s !== this.step) { this.step = s; this.scene.footprint(this.x + (s % 2 ? 8 : -8), this.y - 2, dx, dy); }
          if (this.box) this.box.setPosition(this.x + (dx < 0 ? -34 : 34), this.y - this.lift - 62).setDepth(this.y + 1);
          this.sync();
        },
      });
    }
    this.lift = 0; this.sync();
  }
}

class Square extends Phaser.Scene {
  constructor() { super('square'); }

  preload() {
    this.load.on('loaderror', (f) => console.warn('нет картинки', f.key));
    const A = 'assets/';
    this.load.image('plaza', A + 'plaza.jpg');
    this.load.image('tree', A + 'tree.png');
    TOYS.forEach((_, i) => this.load.image('toy' + i, `${A}toy-${String(i + 1).padStart(2, '0')}.png`));
    for (let i = 1; i <= 10; i++) this.load.image('decor' + i, `${A}decor-${String(i).padStart(2, '0')}.png`);
    for (const g of GROUPS) {
      this.load.spritesheet(g.sheet, `${A}${g.sheet}.png`, { frameWidth: 384, frameHeight: 512 });
    }
  }

  create() {
    if (!this.textures.exists('flake')) this.makeTextures();
    for (const g of GROUPS) g.coins = g.start ??= g.coins;
    this.placed = undefined; this.lit = undefined; this.playing = false;
    this.add.image(0, 0, 'plaza').setOrigin(0).setDisplaySize(W, H).setDepth(D.bg);
    this.addTree();
    this.addLights();
    this.tint = this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 1).setDepth(D.tint).setBlendMode('MULTIPLY');
    this.mascots = Object.fromEntries(GROUPS.map((g) => [g.id, new Mascot(this, g)]));
    this.addPlates();
    this.addSnow();
    this.addSmoke();

    this.cam = this.cameras.main.setRoundPixels(false);
    this.view = { x: W / 2, y: H / 2, z: 1, tx: W / 2, ty: H / 2, tz: 1, follow: null, stiff: 2.1 };
    this.onResize(); this.scale.on('resize', () => this.onResize());
    this.view.z = this.view.tz = this.fit;

    this.queue = []; this.hung = []; this.filled = new Set();
    this.setTime('вечер', true);
    this.lifeTimer = this.time.addEvent({ delay: 2600, loop: true, callback: () => this.life() });
    buildHud(this);
    window.__sq = this;
    if (!QUERY.has('manual')) this.show();
  }

  /* ---------- текстуры, которые рисует код ---------- */
  makeTextures() {
    const radial = (key, size, stops) => {
      const t = this.textures.createCanvas(key, size, size), c = t.getContext();
      const r = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (const [o, col] of stops) r.addColorStop(o, col);
      c.fillStyle = r; c.fillRect(0, 0, size, size); t.refresh();
    };
    radial('flake', 32, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.95)'], [1, 'rgba(255,255,255,0)']]);
    radial('halo', 256, [[0, 'rgba(255,214,130,1)'], [0.25, 'rgba(255,190,90,.55)'], [1, 'rgba(255,170,60,0)']]);
    radial('smoke', 96, [[0, 'rgba(226,226,250,.75)'], [0.6, 'rgba(216,214,245,.4)'], [1, 'rgba(210,210,245,0)']]);
    radial('shadow', 160, [[0, 'rgba(38,30,92,.95)'], [0.6, 'rgba(38,30,92,.55)'], [1, 'rgba(38,30,92,0)']]);
    const canvas = (key, w, h, draw) => { const t = this.textures.createCanvas(key, w, h); draw(t.getContext()); t.refresh(); };
    canvas('mound', 640, 240, (c) => {
      const g = c.createRadialGradient(320, 100, 20, 320, 120, 320); g.addColorStop(0, '#f1eeff'); g.addColorStop(0.62, '#d9d4fb'); g.addColorStop(0.86, 'rgba(196,188,246,.9)'); g.addColorStop(1, 'rgba(190,182,242,0)');
      c.setTransform(1, 0, 0, 0.375, 0, 0); c.fillStyle = g; c.beginPath(); c.arc(320, 320, 318, 0, 7); c.fill();
    });
    canvas('print', 18, 12, (c) => { c.fillStyle = '#6f68b4'; c.beginPath(); c.ellipse(9, 6, 8, 5, 0, 0, 7); c.fill(); });
    canvas('spark', 40, 40, (c) => {
      c.fillStyle = '#fff6cf'; c.translate(20, 20); c.beginPath();
      for (let i = 0; i < 8; i++) { const r = i % 2 ? 4 : 19, a = (i * Math.PI) / 4; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.closePath(); c.fill();
    });
    canvas('bow', 64, 40, (c) => {
      c.fillStyle = '#fff'; c.strokeStyle = '#3b2415'; c.lineWidth = 3; c.lineJoin = 'round';
      const tri = (s) => { c.beginPath(); c.moveTo(32, 18); c.quadraticCurveTo(32 + s * 14, -2, 32 + s * 28, 6); c.quadraticCurveTo(32 + s * 30, 20, 32 + s * 26, 32); c.quadraticCurveTo(32 + s * 14, 32, 32, 20); c.fill(); c.stroke(); };
      tri(-1); tri(1); c.beginPath(); c.arc(32, 19, 7, 0, 7); c.fill(); c.stroke();
    });
    canvas('bulb', 26, 32, (c) => { c.fillStyle = '#fff'; c.strokeStyle = '#33200f'; c.lineWidth = 2; c.beginPath(); c.ellipse(13, 18, 9, 12, 0, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#4a3320'; c.fillRect(8, 1, 10, 7); });
    canvas('coin', 48, 48, (c) => {
      c.fillStyle = '#f5c451'; c.strokeStyle = '#7d4f14'; c.lineWidth = 3; c.beginPath(); c.arc(24, 24, 20, 0, 7); c.fill(); c.stroke();
      c.strokeStyle = '#c98f2a'; c.beginPath(); c.arc(24, 24, 14, 0, 7); c.stroke();
      c.fillStyle = '#fff1bd'; c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 4 : 10, a = -Math.PI / 2 + (i * Math.PI) / 5; c.lineTo(24 + Math.cos(a) * r, 24 + Math.sin(a) * r); } c.closePath(); c.fill();
    });
    if (!this.textures.exists('gift')) canvas('gift', 96, 96, (c) => {
      c.lineWidth = 4; c.strokeStyle = '#3b2415'; c.lineJoin = 'round';
      c.fillStyle = '#e6b64e'; c.fillRect(12, 34, 72, 54); c.strokeRect(12, 34, 72, 54);
      c.fillStyle = '#f2ca6b'; c.fillRect(7, 24, 82, 18); c.strokeRect(7, 24, 82, 18);
      c.fillStyle = '#c8473b'; c.fillRect(41, 24, 14, 64); c.strokeRect(41, 24, 14, 64);
      c.beginPath(); c.ellipse(34, 15, 14, 9, 0.4, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.ellipse(62, 15, 14, 9, -0.4, 0, 7); c.fill(); c.stroke();
    });
  }

  /* ---------- ёлка и места для игрушек ---------- */
  addTree() {
    const base = P(TREE.cx, TREE.baseY);
    this.treeShadow = this.add.image(base.x, base.y - 60, 'shadow').setScale(6.6, 1.9).setAlpha(0.5).setDepth(D.pool - 1);
    this.add.image(base.x, base.y - 72, 'mound').setDepth(D.pool - 2).setScale(1.06, 0.92);
    const src = this.textures.get('tree').getSourceImage();
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(src, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const solid = (x, y) => px[(y * c.width + x) * 4 + 3] > 200;
    let top = 0, bottom = c.height - 1;
    const rowHas = (y) => { for (let x = 0; x < c.width; x += 2) if (solid(x, y)) return true; return false; };
    while (!rowHas(top)) top++; while (!rowHas(bottom)) bottom--;
    const scale = (TREE.height * K) / (bottom - top);
    this.tree = this.add.image(base.x, base.y, 'tree').setOrigin(0.5, bottom / c.height).setScale(scale).setDepth(TREE.footY * K);
    this.treeScale = scale;
    const toWorld = (x, y) => ({ x: base.x + (x - c.width / 2) * scale, y: base.y + (y - bottom) * scale });
    this.treeTop = toWorld(c.width / 2, top);
    // ряды мест: снизу вверх, 5 ярусов по 2 ряда, по контуру самой картинки
    this.slots = []; this.garlandRows = [];
    const bodyTop = top + (bottom - top) * 0.1, bodyBottom = top + (bottom - top) * 0.755, rows = 12;
    for (let r = 0; r < rows; r++) {
      const y = Math.round(bodyBottom - ((bodyBottom - bodyTop) * (r + 0.35)) / rows);
      let L = 0, R = c.width - 1; while (L < R && !solid(L, y)) L++; while (R > L && !solid(R, y)) R--;
      const width = (R - L) * scale, n = Math.max(1, Math.round((width * 0.9) / 66));
      for (let i = 0; i < n; i++) {
        const fx = L + (R - L) * (0.08 + 0.84 * (n === 1 ? 0.5 : (i + (r % 2 ? 0.28 : 0) * 0.9) / (n - 1 + (r % 2 ? 0.3 : 0))));
        const u = (fx - c.width / 2) / Math.max(1, (R - L) / 2);
        const w = toWorld(Math.min(R - 12, Math.max(L + 12, fx)), y - Math.abs(u) ** 2 * 26 + (((i * 37) % 11) - 5));
        this.slots.push({ ...w, tier: Math.floor((r * 5) / 12), row: r });
      }
      const tier = Math.floor((r * 5) / 12); if (!this.garlandRows.some((g) => g.tier === tier)) this.garlandRows.push({ tier, a: toWorld(L + 14, y + 4), b: toWorld(R - 14, y + 4) });
    }
    this.slots.forEach((s, i) => { s.i = i; });
    this.tierSize = [0, 1, 2, 3, 4].map((t) => this.slots.filter((s) => s.tier === t).length);
  }

  /* ---------- свет, снег, дым ---------- */
  addLights() {
    this.halos = [];
    for (const [x, y] of LAMPS) { const p = P(x, y); this.halos.push(this.add.image(p.x, p.y, 'halo').setScale(1.15).setBlendMode('ADD').setDepth(D.halo).setData('k', 0.5)); }
    for (const [x, y] of WINDOWS) { const p = P(x, y); this.halos.push(this.add.image(p.x, p.y, 'halo').setScale(0.62).setBlendMode('ADD').setDepth(D.halo).setData('k', 0.34)); }
    this.flickerTimer = this.time.addEvent({ delay: 700, loop: true, callback: () => {
      const h = Phaser.Utils.Array.GetRandom(this.halos);
      this.tweens.add({ targets: h, alpha: h.getData('k') * this.haloK * rnd(0.75, 1.15), duration: 600 });
    } });
  }
  addSnow() {
    this.flakes = [];
    for (let i = 0; i < (LOW ? 140 : 420); i++) {
      const near = i % 9 === 0;
      const f = this.add.image(rnd(-60, W + 60), rnd(-40, H), 'flake').setDepth(D.snow).setScale(near ? rnd(0.42, 0.7) : rnd(0.16, 0.36)).setAlpha(near ? 0.75 : rnd(0.55, 0.95));
      f.v = near ? rnd(90, 130) : rnd(36, 80); f.w = rnd(0.5, 1.3); f.p = rnd(0, 6.28); f.sw = rnd(10, 34);
      this.flakes.push(f);
    }
  }
  addSmoke() {
    this.smokeTimer = this.time.addEvent({ delay: 620, loop: true, callback: () => {
      const [x, y] = Phaser.Utils.Array.GetRandom(CHIMNEYS), p = P(x, y);
      const s = this.add.image(p.x + rnd(-4, 4), p.y - 26, 'smoke').setDepth(p.y + 20).setScale(0.28).setAlpha(0);
      this.tweens.add({ targets: s, alpha: { from: 0.6, to: 0 }, scale: 1.05, y: p.y - 170, x: p.x + rnd(16, 54), duration: 4200, ease: 'Sine.out', onComplete: () => s.destroy() });
    } });
  }
  footprint(x, y, dx, dy) {
    const f = this.add.image(x, y, 'print').setDepth(D.prints).setAlpha(0.42).setRotation(Math.atan2(dy * 0.5, dx));
    this.tweens.add({ targets: f, alpha: 0, delay: 9000, duration: 5000, onComplete: () => f.destroy() });
  }
  puff(x, y, n = 10, spread = 60, up = 40, key = 'flake', scale = [0.35, 0.8], depth = D.fx) {
    for (let i = 0; i < n; i++) {
      const s = this.add.image(x, y, key).setDepth(depth).setScale(rnd(...scale)).setRotation(rnd(0, 6));
      const a = rnd(-Math.PI, 0);
      this.tweens.add({ targets: s, x: x + Math.cos(a) * spread * rnd(0.4, 1), y: { value: y + Math.sin(a) * up * rnd(0.4, 1.2) + 26, ease: 'Sine.in' }, alpha: 0, scale: 0.05, duration: rnd(500, 950), onComplete: () => s.destroy() });
    }
  }
  addPlates() {
    for (const g of GROUPS) {
      const p = P(...g.home), m = this.mascots[g.id];
      const box = this.add.container(p.x + (g.id === 'СР1' ? -34 : 0), p.y + 30).setDepth(D.tint + 2);
      const label = this.add.text(-24, 0, `${g.id} · ${g.name}`, { fontFamily: 'Nunito, Trebuchet MS', fontSize: '25px', fontStyle: '900', color: '#fff3dc', resolution: 2 }).setOrigin(0.5);
      const w = label.width + 112, gr = this.add.graphics();
      gr.fillStyle(0x24140b, 0.35).fillRoundedRect(-w / 2 + 2, -18, w, 42, 12);
      gr.fillStyle(0x4a2c1c, 1).fillRoundedRect(-w / 2, -21, w, 42, 12).lineStyle(3, 0xe9c27a, 1).strokeRoundedRect(-w / 2, -21, w, 42, 12);
      gr.fillStyle(hex(g.color), 1).fillRoundedRect(-w / 2 + 7, -13, 8, 26, 4);
      label.setX(-w / 2 + 24 + label.width / 2);
      const coin = this.add.image(w / 2 - 62, 0, 'coin').setScale(0.62);
      m.coins = this.add.text(w / 2 - 42, 0, g.coins, { fontFamily: 'Nunito, Trebuchet MS', fontSize: '25px', fontStyle: '900', color: '#ffe2a0', resolution: 2 }).setOrigin(0, 0.5);
      box.add([gr, label, coin, m.coins]); box.y += 4; m.plate = box;
    }
  }

  /* ---------- сутки ---------- */
  setTime(name, instant = false) {
    const t = TIMES[name]; this.timeName = name; this.haloK = t.halo;
    const from = Phaser.Display.Color.IntegerToColor(this.tint.fillColor), to = Phaser.Display.Color.IntegerToColor(t.color), o = { t: instant ? 1 : 0 };
    const apply = () => {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, 100, o.t * 100);
      this.tint.setFillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
    };
    if (instant) apply(); else this.tweens.add({ targets: o, t: 1, duration: 2600, onUpdate: apply });
    for (const h of this.halos) this.tweens.add({ targets: h, alpha: h.getData('k') * t.halo, duration: instant ? 1 : 2600 });
    document.querySelectorAll('#timeButtons button').forEach((b) => b.classList.toggle('on', b.dataset.t === name));
  }

  /* ---------- камера ---------- */
  onResize() {
    const { width, height } = this.scale; this.fit = width / height < 1.5 ? width / W : Math.max(width / W, height / H); // узкое окно: вся площадь целиком
    if (!this.view.follow && this.view.tz < this.fit * 1.02) this.view.tz = this.fit;
  }
  look(x, y, zoom, stiff = 2.1) { Object.assign(this.view, { tx: x, ty: y, tz: this.fit * zoom, follow: null, stiff }); }
  followMascot(m, zoom = 2, stiff = 3) { Object.assign(this.view, { follow: m, tz: this.fit * zoom, stiff }); }
  wide() { this.look(W / 2, H / 2, 1, 1.5); }

  update(_, dt) {
    const s = Math.min(dt, 50) / 1000, v = this.view, t = this.time.now / 1000;
    if (v.follow) { v.tx = v.follow.x; v.ty = v.follow.y - 110 - v.follow.lift * 0.85; }
    const k = 1 - Math.exp(-s * v.stiff);
    v.x += (v.tx - v.x) * k; v.y += (v.ty - v.y) * k; v.z *= Math.exp(Math.log(v.tz / v.z) * k);
    const hw = this.scale.width / 2 / v.z, hh = this.scale.height / 2 / v.z;
    const cx = hw * 2 >= W ? W / 2 : Phaser.Math.Clamp(v.x, hw, W - hw), cy = hh * 2 >= H ? H / 2 + (hh - H / 2) * 0.35 : Phaser.Math.Clamp(v.y, hh, H - hh);
    this.cam.setZoom(v.z).centerOn(cx, cy);
    for (const f of this.flakes) {
      f.y += f.v * s; f.x += Math.sin(t * f.w + f.p) * f.sw * s - 10 * s;
      if (f.y > H + 20) { f.y = -20; f.x = rnd(-40, W + 60); }
    }
  }

  /* ---------- живой фон: кто-то один дышит, подпрыгивает, смотрит по сторонам ---------- */
  life() {
    const free = Object.values(this.mascots).filter((m) => !m.busy); if (!free.length) return;
    const m = Phaser.Utils.Array.GetRandom(free), b = m.base, kind = Phaser.Math.Between(0, 3);
    if (kind <= 1) this.tweens.add({ targets: m.sprite, scaleY: b * 1.035, scaleX: b * 0.985, duration: 700, yoyo: true, ease: 'Sine.inOut' });
    else if (kind === 2) { m.pose(7); this.tweens.add({ targets: m, lift: 34, duration: 230, yoyo: true, repeat: 1, ease: 'Quad.out', onUpdate: () => m.sync(), onComplete: () => { if (!m.busy) m.idle(); } }); }
    else if (!m.sheet) this.tweens.add({ targets: m.sprite, rotation: 0.05, duration: 360, yoyo: true, repeat: 1, ease: 'Sine.inOut', onComplete: () => m.sprite.setRotation(0) });
    else this.tweens.add({ targets: m.sprite, scaleY: b * 1.035, duration: 620, yoyo: true, ease: 'Sine.inOut' });
  }

  /* ---------- покупка: домик → лавка → ёлка → домой ---------- */
  enqueue(id) { this.queue.push(id); if (!this.playing) this.drain(); }
  async drain() {
    this.playing = true;
    while (this.queue.length) await this.purchase(this.queue.shift());
    this.playing = false; this.wide();
  }
  nextSlot() {
    for (let t = 0; t < 5; t++) {
      const free = this.slots.filter((s) => s.tier === t && !this.filled.has(s.i));
      if (free.length) return Phaser.Utils.Array.GetRandom(free);
    }
    return null;
  }
  async purchase(id) {
    const m = this.mascots[id], g = m.g, slot = this.nextSlot(); if (!slot) return;
    const toy = Phaser.Math.Between(0, TOYS.length - 1);
    const [name, price] = TOYS[toy];
    m.busy = true; this.filled.add(slot.i);
    // 1. домик: камера подъезжает, маскот радуется решению
    this.look(m.x, m.y - 130, 2.05, 2.6);
    await wait(this, 900);
    m.idle(); m.pose(7);
    await tween(this, { targets: m, lift: 46, duration: 200, yoyo: true, ease: 'Quad.out', onUpdate: () => m.sync() });
    // 2. бегом в лавку
    this.followMascot(m, 1.95);
    await m.go(TO_SHOP[id].map((p) => P(...p)), 470);
    m.pose(7); m.face(1);
    // 3. прилавок: монетки летят, коробка прилетает
    const c = P(...SHOP.counter); this.look(c.x, c.y + 10, 2.35, 2.6);
    await wait(this, 350);
    for (let i = 0; i < Math.min(6, price); i++) {
      const coin = this.add.image(m.x, m.y - 110, 'coin').setScale(0.75).setDepth(D.fx);
      this.tweens.add({ targets: coin, x: c.x, y: { value: c.y - 10, ease: 'Back.in' }, scale: 0.4, duration: 520, delay: i * 110, onComplete: () => { coin.destroy(); } });
    }
    this.spend(g, price);
    await wait(this, 560 + price * 60);
    this.puff(c.x, c.y - 20, 9, 70, 70, 'spark', [0.4, 0.9]);
    m.box = this.add.image(c.x, c.y, 'gift').setScale(0.2).setDepth(D.fx);
    await tween(this, { targets: m.box, x: m.x + 30, y: m.y - 72, scale: 0.62, duration: 480, ease: 'Back.out' });
    m.pose(5); m.box.setVisible(!m.sheet); await wait(this, 420);
    toast(`<b style="--c:${g.color}">${g.id} · ${g.name}</b> несёт на ёлку: «${name}»`);
    // 4. к ёлке
    m.box.setVisible(true).setScale(0.62); this.followMascot(m, 1.85);
    const stand = { x: Phaser.Math.Clamp(slot.x, P(700, 0).x, P(990, 0).x), y: TREE.standY * K };
    await m.go([...TO_TREE.map((p) => P(...p)), { x: stand.x - 30, y: stand.y }, stand], 440);
    m.pose(5); m.face(1); m.box.setVisible(!m.sheet);
    // 5. коробка раскрывается
    this.look(stand.x, (stand.y + slot.y) / 2 - 40, Phaser.Math.Clamp(1350 / (stand.y - slot.y + 330), 1.2, 2.2), 2.2);
    await wait(this, 420); m.idle(); m.box.setVisible(true).setPosition(m.x + 4, m.y - 74);
    this.puff(m.box.x, m.box.y, 12, 90, 80, 'spark', [0.4, 0.9]);
    const t = this.add.image(m.box.x, m.box.y, 'toy' + toy).setOrigin(0.5, 0.06).setDepth(D.fx);
    const toyScale = TOY / t.height; t.setScale(toyScale * 0.3);
    this.tweens.add({ targets: m.box, scale: 0.1, alpha: 0, duration: 240, onComplete: () => { m.box.destroy(); m.box = null; } });
    await tween(this, { targets: t, y: m.y - 200, x: m.x, scale: toyScale * 1.5, duration: 420, ease: 'Back.out' });
    await wait(this, 260);
    // 6. прыжок и игрушка на ветке
    m.sprite.setScale(m.base * 1.08, m.base * 0.86); await wait(this, 130); m.sprite.setScale(m.base);
    this.puff(m.x, m.y, 12, 90, 30);
    m.pose(6); m.depthOverride = D.tint - 10; m.face(slot.x >= m.x ? 1 : -1);
    const sx = m.x, reach = 168, peak = Math.max(60, stand.y - slot.y - reach), o = { t: 0 };
    const dur = 380 + peak * 0.75;
    const hold = () => t.setPosition(m.x + (slot.x >= sx ? 20 : -20), m.y - m.lift - reach - 10).setScale(toyScale);
    await tween(this, { targets: o, t: 1, duration: dur, ease: 'Cubic.out', onUpdate: () => { m.lift = peak * o.t; m.x = sx + (slot.x - sx) * 0.86 * o.t; m.sync(); hold(); } });
    // контакт
    t.setDepth(this.tree.depth + 1 + slot.i * 0.01).setPosition(slot.x, slot.y);
    this.hang(t, g, slot, toyScale); this.look(slot.x, slot.y + 60, 2.5, 3.4);
    await wait(this, 260);
    const back = m.x, o2 = { t: 0 };
    await tween(this, { targets: o2, t: 1, duration: 300 + peak * 0.45, ease: 'Quad.in', onUpdate: () => { m.lift = peak * (1 - o2.t); m.x = back + (stand.x - back) * o2.t; m.sync(); } });
    m.depthOverride = null; m.lift = 0; m.sync();
    this.puff(m.x, m.y, 16, 110, 40); this.cam.shake(120, 0.0018);
    m.sprite.setScale(m.base * 1.1, m.base * 0.84); this.tweens.add({ targets: m.sprite, scaleX: m.base, scaleY: m.base, duration: 260, ease: 'Back.out' });
    // 7. радость, общий план, домой
    m.pose(7); await tween(this, { targets: m, lift: 42, duration: 190, yoyo: true, repeat: 1, ease: 'Quad.out', onUpdate: () => m.sync() });
    await wait(this, 500); this.wide(); this.checkTiers();
    await wait(this, 500);
    const home = [...TO_HOME[id].map((p) => P(...p)), P(...g.home)];
    m.go(home, 400).then(() => { m.idle(); m.busy = false; });
    await wait(this, 1400);
  }
  hang(t, g, slot, scale) {
    t.setScale(scale).setRotation(0.5);
    const bow = this.add.image(slot.x, slot.y + 4, 'bow').setTint(hex(g.color)).setScale(0.46).setDepth(t.depth + 0.005);
    this.tweens.add({ targets: t, rotation: { from: 0.5, to: 0 }, duration: 1900, ease: 'Elastic.out' });
    this.tweens.add({ targets: bow, scale: { from: 0.1, to: 0.46 }, duration: 360, ease: 'Back.out' });
    this.puff(slot.x, slot.y, 14, 90, 20); this.puff(slot.x, slot.y + 30, 9, 80, 80, 'spark', [0.3, 0.8]);
    this.tweens.add({ targets: this.tree, rotation: { from: 0.006, to: 0 }, duration: 900, ease: 'Elastic.out' });
    this.hung.push({ t, bow, slot, g });
    hud(this);
  }
  spend(g, price) {
    const m = this.mascots[g.id], o = { v: g.coins }; g.coins = Math.max(0, g.coins - price);
    this.tweens.add({ targets: o, v: g.coins, duration: 900, onUpdate: () => m.coins.setText(Math.round(o.v)) });
  }
  checkTiers() {
    const done = [0, 1, 2, 3, 4].filter((i) => this.slots.filter((s) => s.tier === i && this.filled.has(s.i)).length === this.tierSize[i]);
    for (const d of done) if (!this.lit?.has(d)) this.lightTier(d);
  }

  /* ---------- домик: чердак (6+) и подвал (20+) ---------- */
  async decorate(id, kind) {
    if (this.playing) return;
    this.playing = true;
    const m = this.mascots[id], g = m.g, y = YARD[id], list = kind === 'attic' ? ATTIC_ITEMS : CELLAR_ITEMS, spots = kind === 'attic' ? y.wall : y.yard;
    this.placed ??= {}; const key = id + kind, n = this.placed[key] ?? 0;
    if (n >= spots.length) { toast('В макете у этого домика больше нет места'); this.playing = false; return; }
    const [name, code] = kind === 'attic' ? list[n % list.length] : list[(n + GROUPS.indexOf(g)) % list.length];
    this.placed[key] = n + 1; m.busy = true;
    this.look(m.x, m.y - 190, 2.1, 2.4);
    toast(`<b style="--c:${g.color}">${g.id} · ${g.name}</b>: ${kind === 'attic' ? 'чердак, счета 6+' : 'подвал, счета 20+'}`);
    await wait(this, 1200);
    const spot = P(...spots[n]), target = kind === 'attic' ? 66 : 150;
    if (kind === 'attic') {
      const from = P(...y.attic); m.pose(7);
      this.puff(from.x, from.y, 18, 80, 40);
      const box = this.add.image(from.x, from.y, 'gift').setScale(0.2).setDepth(D.fx);
      this.tweens.add({ targets: box, x: m.x, rotation: 6.28, duration: 720 });
      await tween(this, { targets: box, y: m.y - 120, scale: 0.7, duration: 720, ease: 'Bounce.out' });
      await wait(this, 220); this.puff(box.x, box.y, 12, 90, 80, 'spark', [0.4, 0.9]); box.destroy();
      const it = this.add.image(m.x, m.y - 130, 'decor' + code).setDepth(D.fx), k = target / it.height; it.setScale(k * 0.3);
      await tween(this, { targets: it, y: m.y - 260, scale: k * 1.7, duration: 420, ease: 'Back.out' }); await wait(this, 350);
      await tween(this, { targets: it, x: spot.x, y: spot.y, scale: k, duration: 620, ease: 'Cubic.inOut' });
      it.setDepth(spot.y - 60); this.puff(spot.x, spot.y, 8, 60, 50, 'spark', [0.3, 0.7]);
    } else {
      const side = spot.x > m.x ? -1 : 1, back = { x: m.x, y: m.y };
      await m.go([{ x: spot.x + side * 70, y: spot.y }], 330); m.idle(); m.face(-side);
      for (let i = 0; i < 3; i++) { this.puff(spot.x, spot.y - 6, 10, 80, 34); m.sprite.setScale(m.base * 1.06, m.base * 0.9); await wait(this, 130); m.sprite.setScale(m.base); await wait(this, 200); }
      const it = this.add.image(spot.x, spot.y, 'decor' + code).setOrigin(0.5, 0.97).setDepth(spot.y), k = target / it.height; it.setScale(k, 0);
      this.puff(spot.x, spot.y, 26, 150, 80);
      this.add.image(spot.x, spot.y - 4, 'shadow').setScale(0.95, 0.4).setAlpha(0.35).setDepth(D.pool);
      await tween(this, { targets: it, scaleY: k * 1.2, duration: 260, ease: 'Back.out' });
      await tween(this, { targets: it, scaleY: k, duration: 320, ease: 'Bounce.out' });
      m.pose(7); await tween(this, { targets: m, lift: 40, duration: 190, yoyo: true, repeat: 1, ease: 'Quad.out', onUpdate: () => m.sync() });
      await m.go([back], 330);
    }
    toast(`«${name}» украшает домик`); m.pose(7);
    await tween(this, { targets: m, lift: 40, duration: 190, yoyo: true, ease: 'Quad.out', onUpdate: () => m.sync() });
    await wait(this, 700); m.idle(); m.busy = false; this.wide();
    await wait(this, 900); this.playing = false; if (this.queue.length) this.drain();
  }

  /* ---------- автопоказ: около двух минут, по кругу ---------- */
  async show() {
    const idle = async () => { while (this.playing) await wait(this, 300); };
    const step = async (fn, pause = 1500) => { await idle(); fn(); await wait(this, 400); await idle(); await wait(this, pause); };
    await wait(this, 3500);
    this.setTime('закат');
    await step(() => this.enqueue('СР1'));
    await step(() => this.enqueue('СР9'));
    this.setTime('вечер');
    await step(() => this.decorate('СР5', 'attic'));
    await step(() => this.decorate('СР2', 'cellar'));
    await step(() => this.fillMany(40), 5500);
    await step(() => this.lightTier(0), 2500);
    await step(() => this.enqueue('СР6'));
    this.setTime('ночь');
    await step(() => { this.lightTier(1); this.lightTier(2); }, 3000);
    await step(() => this.grinch(), 2500);
    await step(() => { this.enqueue('СР3'); this.enqueue('СР5'); });
    await wait(this, 4000);
    this.scene.restart();
  }

  /* ---------- быстрые показы ---------- */
  fillMany(n = 26) {
    const order = GROUPS.map((g) => g);
    for (let i = 0; i < n; i++) {
      const slot = this.nextSlot(); if (!slot) break;
      this.filled.add(slot.i);
      const toy = Phaser.Math.Between(0, 14), g = order[i % 6];
      this.time.delayedCall(i * 90, () => {
        const t = this.add.image(slot.x, slot.y, 'toy' + toy).setOrigin(0.5, 0.06).setDepth(this.tree.depth + 1 + slot.i * 0.01);
        this.hang(t, g, slot, TOY / t.height);
      });
    }
    this.time.delayedCall(n * 90 + 400, () => this.checkTiers());
  }
  lightTier(tier) {
    this.lit ??= new Set(); if (this.lit.has(tier)) return; this.lit.add(tier);
    const row = this.garlandRows.find((r) => r.tier === tier); if (!row) return;
    const colors = [0xffd35c, 0xff6a5a, 0x6ecbff, 0x8fe07a, 0xd79bff], n = Math.max(4, Math.round((row.b.x - row.a.x) / 54));
    const sag = 46, pt = (u) => ({ x: row.a.x + (row.b.x - row.a.x) * u, y: row.a.y + Math.sin(u * Math.PI) * sag });
    const wire = this.add.graphics().setDepth(this.tree.depth + 0.5).lineStyle(4, 0x1f3b22, 1);
    wire.beginPath(); for (let i = 0; i <= 40; i++) { const p = pt(i / 40); i ? wire.lineTo(p.x, p.y) : wire.moveTo(p.x, p.y); } wire.strokePath();
    for (let i = 0; i <= n; i++) {
      const p = pt(i / n), col = colors[i % colors.length];
      const b = this.add.image(p.x, p.y + 12, 'bulb').setDepth(this.tree.depth + 0.6).setTint(col).setScale(0);
      const h = this.add.image(p.x, p.y + 12, 'halo').setBlendMode('ADD').setTint(col).setDepth(D.halo).setScale(0.34).setAlpha(0);
      this.tweens.add({ targets: b, scale: 1, delay: i * 70, duration: 240, ease: 'Back.out' });
      this.tweens.add({ targets: h, alpha: 0.75, delay: i * 70, duration: 240, onComplete: () => this.tweens.add({ targets: h, alpha: 0.35, duration: 1500, yoyo: true, repeat: -1, delay: (i % 3) * 500 }) });
    }
  }
  async grinch() {
    if (this.playing || !this.hung.length) { toast('Сначала повесь хотя бы одну игрушку'); return; }
    this.playing = true;
    const m = this.mascots['СР3'], loot = Phaser.Utils.Array.GetRandom(this.hung.filter((h) => h.slot.tier < 2)) ?? this.hung[0];
    m.busy = true; toast('Подозрительная тишина…');
    this.look(m.x, m.y - 110, 1.9, 2.4); await wait(this, 1100);
    this.followMascot(m, 1.8);
    const stand = { x: Phaser.Math.Clamp(loot.slot.x, P(700, 0).x, P(990, 0).x), y: TREE.standY * K };
    await m.go([...TO_HOME['СР3'].slice().reverse().map((p) => P(...p)), stand], 250);
    await wait(this, 350);
    const peak = Math.max(60, stand.y - loot.slot.y - 150), o = { t: 0 }, sx = m.x; m.depthOverride = D.tint - 10; m.pose(6);
    await tween(this, { targets: o, t: 1, duration: 420, ease: 'Cubic.out', onUpdate: () => { m.lift = peak * o.t; m.x = sx + (loot.slot.x - sx) * 0.8 * o.t; m.sync(); } });
    loot.t.setDepth(D.tint - 9); loot.bow.setVisible(false); this.puff(loot.slot.x, loot.slot.y, 12, 90, 30);
    await tween(this, { targets: o, t: 0, duration: 360, ease: 'Quad.in', onUpdate: () => { m.lift = peak * o.t; m.x = sx + (loot.slot.x - sx) * 0.8 * o.t; m.sync(); loot.t.setPosition(m.x, m.y - m.lift - 170); } });
    m.depthOverride = null; toast('Гринч стащил игрушку! Вернёт её первая же платёжка');
    await Promise.all([m.go([...TO_HOME['СР3'].map((p) => P(...p)), P(...m.g.home)], 520), tween(this, { targets: loot.t, scale: 0.1, alpha: 0, duration: 700 })]);
    m.idle(); await wait(this, 900);
    toast('Платёжка! Лев возвращает игрушку'); const hero = this.mascots['СР1']; hero.busy = true;
    this.followMascot(hero, 1.5); await hero.go([P(430, 345), P(700, 318), P(960, 322), P(1085, 345)], 620);
    for (let i = 0; i < 4; i++) { const s = this.add.image(hero.x, hero.y - 90, 'flake').setScale(1).setDepth(D.fx); this.tweens.add({ targets: s, x: m.x + rnd(-20, 20), y: m.y - rnd(60, 120), duration: 300, delay: i * 190, onComplete: () => { this.puff(s.x, s.y, 8, 60, 40); s.destroy(); } }); }
    await wait(this, 1100);
    loot.t.setAlpha(1).setPosition(loot.slot.x, loot.slot.y).setDepth(this.tree.depth + 1 + loot.slot.i * 0.01); loot.bow.setVisible(true);
    this.look(loot.slot.x, loot.slot.y, 1.8, 2.6);
    this.tweens.add({ targets: loot.t, scale: TOY / loot.t.height, duration: 400, ease: 'Back.out' });
    this.tweens.add({ targets: loot.t, rotation: { from: 0.5, to: 0 }, duration: 1900, ease: 'Elastic.out' });
    this.puff(loot.slot.x, loot.slot.y + 30, 12, 90, 90, 'spark', [0.3, 0.8]);
    await wait(this, 1500); this.wide();
    hero.go([P(960, 322), P(700, 318), P(430, 345), P(...hero.g.home)], 420).then(() => { hero.idle(); hero.busy = false; });
    m.busy = false; this.playing = false; if (this.queue.length) this.drain();
  }
}

/* ---------- HUD в DOM ---------- */
const $ = (s) => document.querySelector(s);
let toastTimer;
if (!QUERY.has('manual')) document.getElementById('panel').classList.add('hidden');
function toast(html) { const t = $('#toast'); t.hidden = true; void t.offsetWidth; t.innerHTML = html; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3600); }
function hud(sq) {
  $('#tiers').innerHTML = [0, 1, 2, 3, 4].map((t) => {
    const n = sq.hung.filter((h) => h.slot.tier === t).length; return `<div class="tier"><i style="width:${(100 * n) / Math.max(1, sq.tierSize[t])}%"></i></div>`;
  }).join('');
}
function buildHud(sq) {
  $('#buyButtons').innerHTML = GROUPS.map((g) => `<button data-g="${g.id}" style="--c:${g.color}">${g.id} · ${g.name}</button>`).join('');
  $('#timeButtons').innerHTML = Object.keys(TIMES).map((t) => `<button data-t="${t}">${t}</button>`).join('');
  $('#panel').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.g) sq.enqueue(b.dataset.g);
    if (b.dataset.t) sq.setTime(b.dataset.t);
    if (b.dataset.act === 'many') sq.fillMany();
    if (b.dataset.act === 'garland') sq.lightTier(sq.lit?.size ?? 0);
    if (b.dataset.act === 'attic' || b.dataset.act === 'cellar') { if (!sq.playing) sq.turn = ((sq.turn ?? -1) + 1) % 6; sq.decorate(GROUPS[sq.turn].id, b.dataset.act); }
    if (b.dataset.act === 'grinch') sq.grinch();
    if (b.dataset.act === 'reset') location.reload();
    if (b.dataset.act === 'hide') { $('#panel').classList.add('hidden'); toast('Панель вернётся по клавише H'); }
  };
  addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'h' || e.key.toLowerCase() === 'р') $('#panel').classList.toggle('hidden'); });
  document.querySelectorAll('#timeButtons button').forEach((b) => b.classList.toggle('on', b.dataset.t === sq.timeName));
  hud(sq);
}

/* ---------- счётчик кадров: ?stats=1 ---------- */
if (QUERY.has('stats')) {
  const box = document.createElement('div'); box.className = 'stats'; document.body.append(box);
  let times = [], last = performance.now();
  const tick = (now) => { times.push(now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  let all = [];
  setInterval(() => {
    if (!times.length || document.hidden) { times = []; return; }
    const sorted = [...times].sort((a, b) => b - a), worst = sorted[Math.floor(sorted.length * 0.02)] ?? sorted[0];
    const avg = (1000 * times.length) / times.reduce((a, b) => a + b, 0);
    all.push(avg); times = [];
    const r = window.__sq?.game.renderer, gl = r?.gl, ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).replace(/ANGLE \(|Direct3D.*$/g, '').slice(0, 46) : '';
    box.textContent = `${Math.round(avg)} к/с · худшие ${Math.round(1000 / worst)} · минимум ${Math.round(Math.min(...all))} · ${gl ? 'WebGL' : 'Canvas'} · ${innerWidth}×${innerHeight}×${devicePixelRatio} · ${gpu}`;
  }, 10000);
  box.textContent = 'Считаю кадры, 10 секунд…';
}

const dpr = LOW ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
const game = new Phaser.Game({
  type: QUERY.get('renderer') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO, parent: 'game', backgroundColor: '#141a3a', scene: Square, banner: false, audio: { noAudio: true },
  scale: { mode: Phaser.Scale.NONE, width: innerWidth * dpr, height: innerHeight * dpr, zoom: 1 / dpr },
  render: { antialias: true, powerPreference: 'low-power' }, fps: { target: 60 },
});
addEventListener('resize', () => game.scale.resize(innerWidth * dpr, innerHeight * dpr));
