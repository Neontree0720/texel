'use strict';
/* HSV 색상 선택기 + 팔레트 */
const ColorPicker = {
  h: 100, s: .6, v: .7, a: 255,
  init() {
    this.sv = $('#sv-canvas'); this.hue = $('#hue-canvas'); this.alpha = $('#alpha-canvas');
    this.drawHue();
    const drag = (cv, fn) => {
      cv.addEventListener('pointerdown', e => {
        cv.setPointerCapture(e.pointerId);
        const mv = ev => { const r = cv.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))); };
        mv(e);
        const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); };
        cv.addEventListener('pointermove', mv);
        cv.addEventListener('pointerup', up);
      });
    };
    drag(this.sv, (x, y) => { this.s = x; this.v = 1 - y; if (this.a === 0) this.a = 255; this.apply(); });
    drag(this.hue, (x) => { this.h = x * 359.9; if (this.a === 0) this.a = 255; this.apply(); });
    drag(this.alpha, (x) => { this.a = Math.round(x * 255); this.apply(); });
    $('#hex-input').addEventListener('change', e => {
      const c = hexToRgba(e.target.value);
      if (c) Editor.setColor('primary', c); else this.sync();
    });
    $('#sw-secondary').onclick = () => Editor.swapColors();
    $('#sw-primary').onclick = () => $('#hex-input').select();
    Editor.on('color', () => this.sync());
    this.sync();
  },
  apply() {
    const [r, g, b] = hsvToRgb(this.h, this.s, this.v);
    Editor.primary = [r, g, b, this.a];
    this.syncing = true;
    Editor.emit('color');
    this.syncing = false;
  },
  sync() {
    const c = Editor.primary;
    if (!this.syncing) {
      const [h, s, v] = rgbToHsv(c[0], c[1], c[2]);
      if (s > 0 && v > 0) this.h = h;
      if (v > 0) this.s = s;
      this.v = v; this.a = c[3];
    }
    $('#sw-primary').style.setProperty('--c', cssColor(c));
    $('#sw-secondary').style.setProperty('--c', cssColor(Editor.secondary));
    if (document.activeElement !== $('#hex-input')) $('#hex-input').value = rgbaToHex(c);
    this.drawSV(); this.drawAlpha();
    Palette.renderRecent();
  },
  drawHue() {
    const x = this.hue.getContext('2d'), w = this.hue.width, h = this.hue.height;
    const g = x.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    this.hueImg = x.getImageData(0, 0, w, h);
  },
  drawSV() {
    const x = this.sv.getContext('2d'), w = this.sv.width, h = this.sv.height;
    x.fillStyle = `hsl(${this.h},100%,50%)`; x.fillRect(0, 0, w, h);
    let g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const cx = this.s * w, cy = (1 - this.v) * h;
    x.beginPath(); x.arc(cx, cy, 6, 0, 7); x.strokeStyle = '#000'; x.lineWidth = 3; x.stroke();
    x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke();
    // hue marker
    const hx = this.hue.getContext('2d');
    hx.putImageData(this.hueImg, 0, 0);
    const mx = this.h / 360 * this.hue.width;
    hx.fillStyle = '#fff'; hx.fillRect(mx - 2, 0, 4, this.hue.height);
    hx.strokeStyle = '#000'; hx.strokeRect(mx - 2.5, .5, 5, this.hue.height - 1);
  },
  drawAlpha() {
    const x = this.alpha.getContext('2d'), w = this.alpha.width, h = this.alpha.height;
    for (let i = 0; i < w; i += 7) for (let j = 0; j < h; j += 7) { x.fillStyle = ((i + j) / 7) % 2 ? '#999' : '#ddd'; x.fillRect(i, j, 7, 7); }
    const c = Editor.primary;
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0)`); g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},1)`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const mx = this.a / 255 * w;
    x.fillStyle = '#fff'; x.fillRect(mx - 2, 0, 4, h);
    x.strokeStyle = '#000'; x.strokeRect(mx - 2.5, .5, 5, h - 1);
  }
};

const Palette = {
  init() {
    const bind = (box) => {
      box.addEventListener('mousedown', e => {
        const t = e.target.closest('.pc'); if (!t) return;
        const c = hexToRgba(t.dataset.c);
        Editor.setColor(e.button === 2 ? 'secondary' : 'primary', c);
      });
      box.addEventListener('contextmenu', e => e.preventDefault());
    };
    bind($('#pal-doc')); bind($('#pal-recent'));
    this.renderDocSoon = debounce(() => this.renderDoc(), 250);
  },
  swatch(c) { const h = rgbaToHex(c); return `<div class="pc" data-c="${h}" title="#${h}" style="--c:${cssColor(c)}"></div>`; },
  renderRecent() { $('#pal-recent').innerHTML = Editor.recent.map(c => this.swatch(c)).join(''); },
  renderDoc() {
    const d = Editor.doc;
    if (!d) { $('#pal-doc').innerHTML = ''; $('#pal-count').textContent = ''; return; }
    const counts = new Map();
    const data = d.comp || d.data;
    const step = data.length > 4 * 512 * 512 ? 16 : 4;
    for (let i = 0; i < data.length; i += step) {
      if (!data[i + 3]) continue;
      const k = (data[i] << 24 | data[i + 1] << 16 | data[i + 2] << 8 | data[i + 3]) >>> 0;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let cols = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k]) => [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255]);
    cols.sort((a, b) => { const ha = rgbToHsv(a[0], a[1], a[2]), hb = rgbToHsv(b[0], b[1], b[2]); return (Math.round(ha[0] / 30) - Math.round(hb[0] / 30)) || (ha[2] - hb[2]); });
    $('#pal-doc').innerHTML = cols.map(c => this.swatch(c)).join('');
    $('#pal-count').textContent = counts.size > 60 ? `(${counts.size}색 중 60)` : `(${counts.size}색)`;
  }
};

/* 미리보기 (실제 크기, 타일, 애니메이션) */
const Preview = {
  frame: 0, timer: null, lastTick: 0,
  init() {
    this.cv = $('#preview');
    $('#prev-tile').onchange = () => this.draw();
    const loop = (t) => {
      requestAnimationFrame(loop);
      const d = Editor.doc;
      if (!d || d.frames <= 1) return;
      const ft = (d.mcmeta && d.mcmeta.animation && d.mcmeta.animation.frametime) || 2;
      if (t - this.lastTick >= ft * 50) { this.lastTick = t; this.frame++; this.draw(); }
    };
    requestAnimationFrame(loop);
  },
  frameOrder(d) {
    const a = d.mcmeta && d.mcmeta.animation;
    if (a && Array.isArray(a.frames) && a.frames.length) return a.frames.map(f => typeof f === 'number' ? f : f.index);
    return [...Array(d.frames).keys()];
  },
  draw() {
    const c = this.cv.getContext('2d'), d = Editor.doc;
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    if (!d) { $('#anim-info').textContent = ''; return; }
    const tile = $('#prev-tile').checked;
    let fw = d.w, fh = d.h, sy = 0;
    if (d.frames > 1) {
      const order = this.frameOrder(d);
      const fi = order[this.frame % order.length] % d.frames;
      fh = d.w; sy = fi * d.w;
      $('#anim-info').textContent = `▶ ${fi + 1}/${d.frames}`;
    } else $('#anim-info').textContent = '';
    const W = this.cv.width, H = this.cv.height;
    c.imageSmoothingEnabled = false;
    const n = tile ? 3 : 1;
    const sc = Math.max(1, Math.floor(Math.min(W / (fw * n), H / (fh * n)))) || 1;
    const scale = Math.min(W / (fw * n), H / (fh * n)) < 1 ? Math.min(W / (fw * n), H / (fh * n)) : sc;
    const tw = fw * scale, th = fh * scale;
    const ox = (W - tw * n) / 2, oy = (H - th * n) / 2;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c.drawImage(d.canvas, 0, sy, fw, fh, ox + i * tw, oy + j * th, tw, th);
  }
};
