'use strict';
/* 픽셀 에디터 */

const ICONS = {
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  eraser: '<path d="M9 20h11"/><path d="M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z"/><path d="M9 11l5 5"/>',
  fill: '<path d="M4 12l7-7 7 7-7 7z"/><path d="M4 12h14"/><path d="M20 15s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z"/>',
  picker: '<path d="M14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L17 12l-5-5z"/><path d="M12 7l-7.5 7.5L4 20l5.5-.5L17 12"/>',
  shade: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',
  rect: '<rect x="4.5" y="5.5" width="15" height="13" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="7"/>',
  select: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M11 4h2M11 20h2M4 11v2M20 11v2"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  pan: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11.5V5a1.5 1.5 0 0 1 3 0v6.5M14 11.5V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.6 0-4-1.3-5.5-3.5L3.8 15a1.5 1.5 0 0 1 2.5-1.6L8 15"/>'
};
const TOOLS = [
  { id: 'pencil', name: '연필 (B) — Shift+클릭: 직선 이어 그리기, Alt: 스포이드', key: 'b' },
  { id: 'eraser', name: '지우개 (E)', key: 'e' },
  { id: 'fill', name: '페인트 통 (G) — Shift: 같은 색 전부 바꾸기', key: 'g' },
  { id: 'picker', name: '스포이드 (I)', key: 'i' },
  { id: 'shade', name: '밝게/어둡게 붓 (D) — 우클릭은 반대로', key: 'd' },
  null,
  { id: 'line', name: '직선 (L) — Shift: 45° 고정', key: 'l' },
  { id: 'rect', name: '사각형 (U) — Shift: 정사각형', key: 'u' },
  { id: 'ellipse', name: '원 (O) — Shift: 정원', key: 'o' },
  null,
  { id: 'select', name: '영역 선택 (M) — Ctrl+A 전체, Ctrl+C/X/V 복사/잘라내기/붙여넣기', key: 'm' },
  { id: 'move', name: '이동 (V) — 선택 영역(없으면 전체)을 드래그해서 옮기기, 방향키로 1칸씩', key: 'v' },
  { id: 'pan', name: '화면 이동 (H) — 스페이스바를 누른 채 드래그해도 됩니다', key: 'h' }
];
const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128];

class TexDoc {
  constructor({ key, name, imageData, orig, mcmeta, isNew }) {
    this.key = key; this.name = name;
    this.w = imageData.width; this.h = imageData.height;
    // 레이어: 아래(0)부터 위로 쌓임. this.data 는 '선택된 레이어'의 픽셀
    this.layers = [TexDoc.layer('레이어 1', new Uint8ClampedArray(imageData.data))];
    this.active = 0;
    this.layerSeq = 1;
    this.orig = orig || null; // {w,h,data}
    this.mcmeta = mcmeta || null;
    this.isNew = !!isNew; // 프로젝트에 아직 없는 텍스처(원본 그대로)
    this.undo = []; this.redo = [];
    this.dirty = false;
    this.sel = null; this.floating = null; this.view = null;
    this.frame = 0; this.frameMode = true; this.onion = false; this.mcmetaDirty = false;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.sync();
  }
  static layer(name, data, visible = true, opacity = 1) { return { name, data, visible, opacity }; }
  get data() { return this.layers[this.active].data; }
  set data(v) { this.layers[this.active].data = v; }
  get layer() { return this.layers[this.active]; }
  /* 보이는 레이어를 합친 결과 (저장·미리보기·스포이드에 쓰임). over: 선택 레이어 대신 쓸 픽셀 */
  compose(over) {
    const L = this.layers, n = this.w * this.h * 4;
    const vis = L.map((l, i) => (i === this.active && over) ? { ...l, data: over } : l).filter(l => l.visible && l.opacity > 0);
    if (vis.length === 1 && vis[0].opacity >= 1) return vis[0].data;
    const out = new Uint8ClampedArray(n);
    for (const l of vis) {
      const s = l.data, op = l.opacity;
      for (let i = 0; i < n; i += 4) {
        const sa = s[i + 3] / 255 * op;
        if (!sa) continue;
        const da = out[i + 3] / 255;
        if (sa >= 1 || !da) { out[i] = s[i]; out[i + 1] = s[i + 1]; out[i + 2] = s[i + 2]; out[i + 3] = sa * 255; continue; }
        const oa = sa + da * (1 - sa), k = da * (1 - sa);
        out[i] = (s[i] * sa + out[i] * k) / oa;
        out[i + 1] = (s[i + 1] * sa + out[i + 1] * k) / oa;
        out[i + 2] = (s[i + 2] * sa + out[i + 2] * k) / oa;
        out[i + 3] = oa * 255;
      }
    }
    return out;
  }
  sync() {
    if (this.canvas.width !== this.w || this.canvas.height !== this.h) { this.canvas.width = this.w; this.canvas.height = this.h; }
    this.comp = this.compose();
    this.ctx.putImageData(new ImageData(this.comp, this.w, this.h), 0, 0);
  }
  /* 레이어를 하나로 합친 픽셀 (숨긴 레이어는 빠짐) */
  flat() { return this.compose().slice(); }
  /* 레이어를 모두 버리고 한 장짜리 그림으로 */
  setSingle(w, h, data) { this.w = w; this.h = h; this.layers = [TexDoc.layer('레이어 1', data)]; this.active = 0; this.layerSeq = 1; }
  /* 모든 레이어에 같은 변환 적용 (크기 변경, 프레임 추가 등) */
  mapLayers(fn) { for (const l of this.layers) l.data = fn(l.data); }
  snapshot() { return { w: this.w, h: this.h, active: this.active, layers: this.layers.map(l => ({ ...l, data: l.data.slice() })) }; }
  pushUndo() { this.undo.push(this.snapshot()); if (this.undo.length > 150) this.undo.shift(); this.redo = []; }
  restore(s) { this.w = s.w; this.h = s.h; this.layers = s.layers.map(l => ({ ...l })); this.active = Math.min(s.active, this.layers.length - 1); this.sync(); }
  get frames() { return (this.h > this.w && this.h % this.w === 0) ? this.h / this.w : 1; }
}

const Editor = {
  docs: [], doc: null, tool: 'pencil',
  primary: [94, 186, 64, 255], secondary: [0, 0, 0, 0],
  brush: 1, mirrorX: false, mirrorY: false, grid: true, shapeFill: false, fillGlobal: false,
  shadeMode: 'lighten', shadeAmt: 12,
  recent: [], clip: null, drag: null, hover: null, spaceDown: false, showOrig: false, preview: null,
  hooks: { change: [], color: [], docs: [], status: [], layers: [] },
  on(ev, fn) { this.hooks[ev].push(fn); },
  emit(ev, ...a) { for (const f of this.hooks[ev]) f(...a); },

  init() {
    this.cv = $('#view');
    this.ctx = this.cv.getContext('2d');
    this.scratch = document.createElement('canvas');
    this.checker = this.makeChecker();
    this.buildToolbar();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe($('#main-pane')); ro.observe($('#orig-pane'));
    // 원본 나란히 보기 (왼쪽 창)
    this.ov = $('#orig-view');
    this.octx = this.ov.getContext('2d');
    this.ov.addEventListener('pointerdown', e => this.onOrigDown(e));
    this.ov.addEventListener('pointermove', e => this.onOrigMove(e));
    this.ov.addEventListener('pointerup', e => this.onOrigUp(e));
    this.ov.addEventListener('pointercancel', e => this.onOrigUp(e));
    this.ov.addEventListener('pointerleave', () => { this.origHover = null; this.render(); this.emit('status', null); });
    this.ov.addEventListener('contextmenu', e => e.preventDefault());
    this.ov.addEventListener('wheel', e => this.onWheel(e, this.ov), { passive: false });
    this.cv.addEventListener('pointerdown', e => this.onDown(e));
    this.cv.addEventListener('pointermove', e => this.onMove(e));
    this.cv.addEventListener('pointerup', e => this.onUp(e));
    this.cv.addEventListener('pointercancel', e => this.onUp(e));
    this.cv.addEventListener('pointerleave', () => { this.hover = null; this.render(); this.emit('status', null); });
    this.cv.addEventListener('contextmenu', e => e.preventDefault());
    this.cv.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    setInterval(() => { if (this.doc && (this.doc.sel || this.doc.floating)) { this.antOffset = ((this.antOffset || 0) + 1) % 8; this.render(); } }, 120);

    // 옵션 바인딩
    const bs = $('#brush-size');
    bs.oninput = () => { this.brush = +bs.value; $('#brush-size-val').textContent = bs.value; this.render(); };
    $('#shape-fill').onchange = e => { this.shapeFill = e.target.checked; };
    $('#fill-global').onchange = e => { this.fillGlobal = e.target.checked; };
    $('#shade-mode').onchange = e => { this.shadeMode = e.target.value; };
    $('#shade-amt').oninput = e => { this.shadeAmt = +e.target.value; };
    $('#mirror-x').onchange = e => { this.mirrorX = e.target.checked; this.render(); };
    $('#mirror-y').onchange = e => { this.mirrorY = e.target.checked; this.render(); };
    $('#show-grid').onchange = e => { this.grid = e.target.checked; this.render(); };
    $('#btn-undo').onclick = () => this.undo();
    $('#btn-redo').onclick = () => this.redo();
    $('#btn-zoom-in').onclick = () => this.zoomStep(1);
    $('#btn-zoom-out').onclick = () => this.zoomStep(-1);
    $('#btn-zoom-fit').onclick = () => this.fit();
    this.setTool('pencil');
    this.updateEmpty();
  },

  makeChecker() {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d');
    x.fillStyle = '#3a3f4a'; x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#2c3039'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    return c;
  },

  buildToolbar() {
    const tb = $('#toolbar');
    for (const t of TOOLS) {
      if (!t) { tb.append(el('div', 'toolbar-sep')); continue; }
      const b = el('button', 'tool', `<svg viewBox="0 0 24 24">${ICONS[t.id]}</svg><span class="key">${t.key.toUpperCase()}</span>`);
      b.title = t.name; b.dataset.tool = t.id;
      b.onclick = () => this.setTool(t.id);
      tb.append(b);
    }
  },

  setTool(id) {
    if (this.doc && this.doc.floating && id !== 'move') this.commitFloating();
    this.tool = id;
    $$('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
    const show = (sel, on) => $(sel).classList.toggle('hidden', !on);
    show('#opt-size', ['pencil', 'eraser', 'shade', 'line', 'rect', 'ellipse'].includes(id));
    show('#opt-fill', ['rect', 'ellipse'].includes(id));
    show('#opt-shade', id === 'shade');
    show('#opt-global', id === 'fill');
    this.updateCursor();
    this.render();
  },
  updateCursor() {
    const pan = this.tool === 'pan' || this.spaceDown || (this.drag && this.drag.type === 'pan');
    this.cv.style.cursor = pan ? (this.drag ? 'grabbing' : 'grab') : this.tool === 'move' ? 'move' : 'crosshair';
    if (this.ov) this.ov.style.cursor = (this.tool === 'pan' || this.spaceDown || (this.odrag && this.odrag.type === 'pan')) ? (this.odrag ? 'grabbing' : 'grab') : 'crosshair';
  },

  /* ------------------------------------------------ 원본 나란히 보기 */
  setCompare(on) { this.compare = !!on; this.updateSplit(); this.render(); },
  updateSplit() {
    const split = !!(this.compare && this.doc), wrap = $('#canvas-wrap');
    if (wrap.classList.contains('split') === split) return;
    wrap.classList.toggle('split', split);
    for (const d of this.docs) if (d.view) d.view.fitted = false; // 창 너비가 바뀌었으니 다시 맞추기
    this.resize();
  },
  /* 원본 이미지에서 현재 프레임에 해당하는 영역 (편집본과 크기가 달라도 비율로 맞춤) */
  origMap() {
    const d = this.doc, o = d.orig, fr = this.fr(), s = o.w / d.w;
    let y0 = Math.round(fr.y0 * s), h = Math.round(fr.h * s);
    if (y0 + h > o.h) { y0 = 0; h = Math.min(h, o.h); }
    return { s, y0, h };
  },
  origAt(e) {
    const d = this.doc, o = d && d.orig;
    if (!o) return null;
    const r = this.ov.getBoundingClientRect(), v = d.view, m = this.origMap();
    const lx = Math.floor((e.clientX - r.left - v.panX) / v.zoom), ly = Math.floor((e.clientY - r.top - v.panY) / v.zoom);
    const ox = Math.floor(lx * m.s), oy = m.y0 + Math.floor(ly * m.s);
    if (lx < 0 || ly < 0 || ox >= o.w || oy >= m.y0 + m.h || oy >= o.h) return null;
    const i = (oy * o.w + ox) * 4;
    return { x: lx, y: ly + this.fr().y0, ox, oy, c: [o.data[i], o.data[i + 1], o.data[i + 2], o.data[i + 3]] };
  },
  onOrigDown(e) {
    const d = this.doc; if (!d) return;
    try { this.ov.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터 */ }
    if (e.button === 1 || this.tool === 'pan' || this.spaceDown) {
      this.odrag = { type: 'pan', sx: e.clientX, sy: e.clientY, px: d.view.panX, py: d.view.panY };
      this.updateCursor();
      return;
    }
    const right = e.button === 2;
    this.odrag = { type: 'pick', right };
    const p = this.origAt(e);
    if (p) this.setColor(right ? 'secondary' : 'primary', p.c);
  },
  onOrigMove(e) {
    const d = this.doc; if (!d) return;
    const p = this.origAt(e), dr = this.odrag;
    this.origHover = p;
    this.emit('status', p ? { x: p.ox, y: p.oy, c: p.c, orig: true } : null);
    if (dr && dr.type === 'pan') { d.view.panX = dr.px + (e.clientX - dr.sx); d.view.panY = dr.py + (e.clientY - dr.sy); }
    else if (dr && dr.type === 'pick' && p) this.setColor(dr.right ? 'secondary' : 'primary', p.c);
    this.render();
  },
  onOrigUp(e) {
    if (!this.odrag) return;
    this.odrag = null;
    try { this.ov.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    this.updateCursor();
  },
  renderOrig() {
    if (!this.compare || !this.ov.width) return;
    const c = this.octx, d = this.doc;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.ow, this.oh);
    if (!d) return;
    const o = d.orig;
    if (!o) {
      c.fillStyle = '#7d8696'; c.font = '13px "Segoe UI", "Malgun Gothic"'; c.textAlign = 'center';
      c.fillText('이 텍스처는 비교할 원본이 없어요', this.ow / 2, this.oh / 2);
      c.textAlign = 'start';
      return;
    }
    if (!o.canvas) o.canvas = imageDataToCanvas(new ImageData(o.data, o.w, o.h));
    const { zoom: z, panX: px, panY: py } = d.view;
    const m = this.origMap(), FH = m.h / m.s, W = d.w * z, H = FH * z;
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(px + 4, py + 4, W, H);
    c.save();
    c.beginPath(); c.rect(px, py, W, H); c.clip();
    c.fillStyle = c.createPattern(this.checker, 'repeat');
    c.translate(px, py); c.fillRect(0, 0, W, H); c.translate(-px, -py);
    c.imageSmoothingEnabled = false;
    c.drawImage(o.canvas, 0, m.y0, o.w, m.h, px, py, W, H);
    c.restore();
    this.drawGrid(c, d.w, FH, z, px, py, this.ow, this.oh);
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1; c.strokeRect(px - .5, py - .5, W + 1, H + 1);
    // 오른쪽에서 가리키는 칸을 원본에도 표시
    if (this.hover) this.outlineCell(c, px + this.hover.x * z, py + (this.hover.y - this.fr().y0) * z, z);
  },
  outlineCell(c, x, y, z) {
    c.save(); c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeRect(x - .5, y - .5, z + 1, z + 1);
    c.strokeStyle = 'rgba(120,195,255,.95)'; c.strokeRect(x + .5, y + .5, z - 1, z - 1);
    c.restore();
  },
  drawGrid(c, w, FH, z, px, py, cw, ch) {
    if (!this.grid || z < 6) return;
    c.beginPath();
    const x0 = Math.max(0, Math.floor(-px / z)), x1 = Math.min(w, Math.ceil((cw - px) / z));
    const y0 = Math.max(0, Math.floor(-py / z)), y1 = Math.min(FH, Math.ceil((ch - py) / z));
    for (let x = x0; x <= x1; x++) { c.moveTo(px + x * z + .5, py + y0 * z); c.lineTo(px + x * z + .5, py + y1 * z); }
    for (let y = y0; y <= y1; y++) { c.moveTo(px + x0 * z, py + y * z + .5); c.lineTo(px + x1 * z, py + y * z + .5); }
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1; c.stroke();
    if (w > 16 || FH > 16) {
      c.beginPath();
      for (let x = 0; x <= w; x += 16) { c.moveTo(px + x * z + .5, py); c.lineTo(px + x * z + .5, py + FH * z); }
      for (let y = 0; y <= FH; y += 16) { c.moveTo(px, py + y * z + .5); c.lineTo(px + w * z, py + y * z + .5); }
      c.strokeStyle = 'rgba(255,255,255,.14)'; c.stroke();
    }
  },

  /* ------------------------------------------------ docs */
  addDoc(doc) {
    this.docs.push(doc);
    this.setDoc(doc);
  },
  findDoc(key) { return this.docs.find(d => d.key === key); },
  setDoc(doc) {
    if (this.doc && this.doc.floating) this.commitFloating();
    if (this.drag) this.drag = null;
    this.preview = null;
    this.doc = doc;
    this.origHover = null;
    if (doc && !doc.view) doc.view = { zoom: 1, panX: 0, panY: 0 };
    this.updateSplit();
    if (doc && !doc.view.fitted) this.fit();
    this.updateEmpty();
    this.render();
    this.emit('docs');
    this.emit('change', doc, 'switch');
  },
  closeDoc(doc) {
    const i = this.docs.indexOf(doc);
    if (i < 0) return;
    this.docs.splice(i, 1);
    if (this.doc === doc) this.setDoc(this.docs[Math.min(i, this.docs.length - 1)] || null);
    else this.emit('docs');
  },
  updateEmpty() { $('#editor-empty').classList.toggle('hidden', !!this.doc); },

  markChanged(kind = 'edit') {
    const d = this.doc;
    if (!d) return;
    d.dirty = true;
    d.sync();
    this.render();
    this.emit('change', d, kind);
  },

  /* ------------------------------------------------ view */
  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.max(1, Math.round(r.width * dpr));
    this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.cw = r.width; this.ch = r.height; this.dpr = dpr;
    const o = this.ov.getBoundingClientRect();
    this.ov.width = Math.max(1, Math.round(o.width * dpr));
    this.ov.height = Math.max(1, Math.round(o.height * dpr));
    this.ow = o.width; this.oh = o.height;
    if (this.doc && this.doc.view && !this.doc.view.fitted) this.fit();
    this.render();
  },
  /* 애니메이션 텍스처: 현재 프레임 영역 */
  fr() {
    const d = this.doc;
    if (d && d.frames > 1 && d.frameMode) {
      if (d.frame >= d.frames) d.frame = d.frames - 1;
      return { y0: d.frame * d.w, h: d.w };
    }
    return { y0: 0, h: d ? d.h : 0 };
  },
  setFrame(i) {
    const d = this.doc; if (!d || d.frames <= 1) return;
    this.commitFloating();
    d.frame = ((i % d.frames) + d.frames) % d.frames;
    d.sel = null;
    this.render();
    this.emit('change', d, 'frame');
  },
  setFrameMode(on) {
    const d = this.doc; if (!d) return;
    this.commitFloating();
    d.frameMode = on; d.sel = null;
    this.fit();
    this.emit('change', d, 'frame');
  },
  addFrame() {
    const d = this.doc; if (!d) return;
    if (d.frames === 1 && d.h !== d.w) { toast('정사각형 텍스처만 애니메이션 프레임을 추가할 수 있어요', true); return; }
    this.commitFloating();
    d.pushUndo();
    const f = d.frames > 1 ? d.frame : 0, fs = d.w * d.w * 4;
    d.mapLayers(src => {
      const out = new Uint8ClampedArray(src.length + fs);
      out.set(src.subarray(0, (f + 1) * fs), 0);
      out.set(src.subarray(f * fs, (f + 1) * fs), (f + 1) * fs);
      out.set(src.subarray((f + 1) * fs), (f + 2) * fs);
      return out;
    });
    const wasAnim = d.frames > 1;
    d.h += d.w; d.frame = f + 1; d.frameMode = true; d.sel = null;
    if (!d.mcmeta) d.mcmeta = { animation: { frametime: 2 } };
    if (!d.mcmeta.animation) d.mcmeta.animation = { frametime: 2 };
    if (Array.isArray(d.mcmeta.animation.frames)) { delete d.mcmeta.animation.frames; toast('프레임 순서 목록이 초기화되었습니다 (순서대로 재생)'); }
    d.mcmetaDirty = true;
    this.markChanged('frames');
    if (!wasAnim) { this.fit(); toast('애니메이션 텍스처가 되었어요! 저장하면 .mcmeta 파일이 함께 만들어집니다'); }
  },
  deleteFrame() {
    const d = this.doc; if (!d || d.frames <= 1) return;
    this.commitFloating();
    d.pushUndo();
    const f = d.frame, fs = d.w * d.w * 4;
    d.mapLayers(src => {
      const out = new Uint8ClampedArray(src.length - fs);
      out.set(src.subarray(0, f * fs), 0);
      out.set(src.subarray((f + 1) * fs), f * fs);
      return out;
    });
    d.h -= d.w; d.frame = Math.max(0, f - 1); d.sel = null;
    if (d.mcmeta && d.mcmeta.animation && Array.isArray(d.mcmeta.animation.frames)) { delete d.mcmeta.animation.frames; d.mcmetaDirty = true; }
    this.markChanged('frames');
    if (d.frames === 1) this.fit();
  },

  fit() {
    const d = this.doc;
    if (!d || !this.cw) return;
    const FH = this.fr().h;
    const target = Math.min(this.cw / d.w, this.ch / FH) * 0.86;
    let z = ZOOMS[0];
    for (const x of ZOOMS) if (x <= target) z = x;
    d.view.zoom = z;
    d.view.panX = Math.round((this.cw - d.w * z) / 2);
    d.view.panY = Math.round((this.ch - FH * z) / 2);
    d.view.fitted = true;
    this.render();
  },
  zoomAt(z, sx, sy) {
    const v = this.doc.view;
    const ix = (sx - v.panX) / v.zoom, iy = (sy - v.panY) / v.zoom;
    v.zoom = z;
    v.panX = Math.round(sx - ix * z);
    v.panY = Math.round(sy - iy * z);
    this.render();
  },
  zoomStep(dir, sx, sy) {
    if (!this.doc) return;
    const z = this.doc.view.zoom;
    let i = ZOOMS.findIndex(x => x >= z - 1e-6);
    if (i < 0) i = ZOOMS.length;
    const exact = i < ZOOMS.length && Math.abs(ZOOMS[i] - z) < 1e-6;
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, exact ? i + dir : (dir > 0 ? i : i - 1)));
    this.zoomAt(ZOOMS[ni], sx != null ? sx : this.cw / 2, sy != null ? sy : this.ch / 2);
  },
  onWheel(e, canvas = this.cv) {
    e.preventDefault();
    if (!this.doc) return;
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || !e.shiftKey) this.zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    else { this.doc.view.panX -= e.deltaY; this.render(); }
  },
  toPixel(e) {
    const r = this.cv.getBoundingClientRect();
    const v = this.doc.view;
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { x: Math.floor((sx - v.panX) / v.zoom), y: Math.floor((sy - v.panY) / v.zoom) + this.fr().y0, sx, sy };
  },

  /* ------------------------------------------------ render */
  render() { this.renderMain(); this.renderOrig(); },
  renderMain() {
    const c = this.ctx, d = this.doc;
    if (!this.cv.width) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.cw, this.ch);
    $('#zoom-val').textContent = d ? Math.round(d.view.zoom * 100) + '%' : '–';
    if (!d) return;
    const { zoom: z, panX: px, panY: py } = d.view;
    const fr = this.fr(), oy = fr.y0, FH = fr.h;
    const W = d.w * z, H = FH * z;
    const sy = (y) => py + (y - oy) * z; // 이미지 y → 화면 y
    // 그림자 + 체커
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(px + 4, py + 4, W, H);
    c.save();
    c.beginPath(); c.rect(px, py, W, H); c.clip();
    c.fillStyle = c.createPattern(this.checker, 'repeat');
    c.translate(px, py); c.fillRect(0, 0, W, H); c.translate(-px, -py);
    c.imageSmoothingEnabled = false;
    if (this.showOrig && d.orig) {
      const o = this.toScratch(d.orig.data, d.orig.w, d.orig.h);
      if (o.width === d.w && o.height === d.h) c.drawImage(o, 0, oy, d.w, FH, px, py, W, H);
      else c.drawImage(o, px, py, W, H);
    } else {
      // 그리는 중인 도형 / 옮기는 중인 선택 영역은 선택 레이어 자리에 끼워서 합친다
      let src = d.canvas;
      if (this.preview || d.floating) {
        let act = this.preview || d.data;
        if (d.floating) { act = act.slice(); this.stampFloating(act, d.floating); }
        src = this.toScratch(d.compose(act), d.w, d.h);
      }
      c.drawImage(src, 0, oy, d.w, FH, px, py, W, H);
      if (d.onion && d.frameMode && d.frames > 1) {
        const pf = (d.frame - 1 + d.frames) % d.frames;
        c.globalAlpha = .3;
        c.drawImage(d.canvas, 0, pf * d.w, d.w, d.w, px, py, W, H);
        c.globalAlpha = 1;
      }
    }
    c.restore();
    // 격자
    this.drawGrid(c, d.w, FH, z, px, py, this.cw, this.ch);
    // 왼쪽 원본에서 가리키는 칸을 편집본에도 표시
    if (this.compare && this.origHover) this.outlineCell(c, px + this.origHover.x * z, sy(this.origHover.y), z);
    // 애니메이션 프레임 구분선 (전체 보기일 때)
    if (d.frames > 1 && !d.frameMode) {
      c.save(); c.setLineDash([6, 4]); c.strokeStyle = 'rgba(74,168,255,.85)'; c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 1; i < d.frames; i++) { const y = py + i * d.w * z; c.moveTo(px - 10, y); c.lineTo(px + W + 10, y); }
      c.stroke(); c.restore();
      if (d.w * z >= 14) {
        c.fillStyle = 'rgba(74,168,255,.95)'; c.font = '11px Segoe UI';
        for (let i = 0; i < d.frames; i++) { const y = py + i * d.w * z; if (y > -20 && y < this.ch) c.fillText('#' + (i + 1), px + W + 8, y + 14); }
      }
    }
    // 대칭선
    c.save(); c.setLineDash([4, 4]); c.strokeStyle = 'rgba(255,170,60,.85)';
    if (this.mirrorX) { c.beginPath(); c.moveTo(px + W / 2, py - 8); c.lineTo(px + W / 2, py + H + 8); c.stroke(); }
    if (this.mirrorY) { c.beginPath(); c.moveTo(px - 8, py + H / 2); c.lineTo(px + W + 8, py + H / 2); c.stroke(); }
    c.restore();
    // 테두리
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1; c.strokeRect(px - .5, py - .5, W + 1, H + 1);
    // 선택 영역
    const s = (d.floating) ? { x: d.floating.x, y: d.floating.y, w: d.floating.w, h: d.floating.h } : (this.drag && this.drag.type === 'select' ? this.drag.rect : d.sel);
    if (s && s.w > 0 && s.h > 0) {
      const rx = px + s.x * z + .5, ry = sy(s.y) + .5, rw = s.w * z - 1, rh = s.h * z - 1;
      c.save(); c.lineWidth = 1;
      c.strokeStyle = '#000'; c.setLineDash([]); c.strokeRect(rx, ry, rw, rh);
      c.strokeStyle = '#fff'; c.setLineDash([4, 4]); c.lineDashOffset = -(this.antOffset || 0); c.strokeRect(rx, ry, rw, rh);
      c.restore();
    }
    // 붓 미리보기
    if (this.hover && !this.drag && ['pencil', 'eraser', 'shade'].includes(this.tool) && !this.spaceDown) {
      const o = Math.floor((this.brush - 1) / 2);
      const lx = this.hover.x - o, ly = this.hover.y - oy - o;
      const cells = [[lx, ly]];
      if (this.mirrorX) cells.push([d.w - lx - this.brush, ly]);
      if (this.mirrorY) cells.push([lx, FH - ly - this.brush]);
      if (this.mirrorX && this.mirrorY) cells.push([d.w - lx - this.brush, FH - ly - this.brush]);
      for (const [hx, hy] of cells) {
        const x = px + hx * z, y = py + hy * z, sz = this.brush * z;
        if (this.tool === 'pencil' && z >= 2) { c.fillStyle = cssColor(this.primary); c.globalAlpha = .55; c.fillRect(x, y, sz, sz); c.globalAlpha = 1; }
        c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeRect(x - .5, y - .5, sz + 1, sz + 1);
        c.strokeStyle = 'rgba(255,255,255,.9)'; c.strokeRect(x + .5, y + .5, sz - 1, sz - 1);
      }
    }
  },
  toScratch(data, w, h) {
    const s = this.scratch;
    if (s.width !== w || s.height !== h) { s.width = w; s.height = h; }
    s.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
    return s;
  },

  /* ------------------------------------------------ pixel ops */
  inSel(x, y) {
    const s = this.doc.sel, fr = this.fr();
    if (y < fr.y0 || y >= fr.y0 + fr.h) return false;
    return !s || (x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h);
  },
  getPx(buf, x, y) { const d = this.doc; const i = (y * d.w + x) * 4; return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; },
  setPx(buf, x, y, c) {
    const d = this.doc;
    if (x < 0 || y < 0 || x >= d.w || y >= d.h || !this.inSel(x, y)) return;
    const i = (y * d.w + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
  },
  shadePx(buf, x, y, mode, touched) {
    const d = this.doc;
    if (x < 0 || y < 0 || x >= d.w || y >= d.h || !this.inSel(x, y)) return;
    const k = y * d.w + x;
    if (touched.has(k)) return;
    touched.add(k);
    const i = k * 4;
    if (!buf[i + 3]) return;
    const a = this.shadeAmt / 100;
    for (let j = 0; j < 3; j++) buf[i + j] = mode === 'lighten' ? buf[i + j] + (255 - buf[i + j]) * a : buf[i + j] * (1 - a);
  },
  brushAt(x, y, fn) {
    const d = this.doc, b = this.brush, o = Math.floor((b - 1) / 2);
    const fr = this.fr(), my = (cy) => 2 * fr.y0 + fr.h - 1 - cy;
    for (let yy = 0; yy < b; yy++) for (let xx = 0; xx < b; xx++) {
      const cx = x - o + xx, cy = y - o + yy;
      fn(cx, cy);
      if (this.mirrorX) fn(d.w - 1 - cx, cy);
      if (this.mirrorY) fn(cx, my(cy));
      if (this.mirrorX && this.mirrorY) fn(d.w - 1 - cx, my(cy));
    }
  },
  line(x0, y0, x1, y1, fn) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      fn(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  },
  strokeTo(x, y) {
    const dr = this.drag, buf = this.doc.data;
    const plot = (px, py) => this.brushAt(px, py, (cx, cy) => {
      if (dr.mode === 'shade') this.shadePx(buf, cx, cy, dr.shade, dr.touched);
      else this.setPx(buf, cx, cy, dr.color);
    });
    this.line(dr.last.x, dr.last.y, x, y, plot);
    dr.last = { x, y };
    this.markChanged('stroke');
  },
  floodFill(x, y, color, global) {
    const d = this.doc, buf = d.data, w = d.w, h = d.h;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const t = this.getPx(buf, x, y);
    const same = (i) => buf[i] === t[0] && buf[i + 1] === t[1] && buf[i + 2] === t[2] && buf[i + 3] === t[3];
    if (t[0] === color[0] && t[1] === color[1] && t[2] === color[2] && t[3] === color[3]) return false;
    if (global) {
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (same((yy * w + xx) * 4)) this.setPx(buf, xx, yy, color);
      return true;
    }
    if (!this.inSel(x, y)) return false;
    const seen = new Uint8Array(w * h);
    const stack = [x, y];
    while (stack.length) {
      const yy = stack.pop(), xx = stack.pop();
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = yy * w + xx;
      if (seen[k] || !this.inSel(xx, yy) || !same(k * 4)) continue;
      seen[k] = 1;
      this.setPx(buf, xx, yy, color);
      stack.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1);
    }
    return true;
  },
  shapePixels(a, b, shift) {
    const t = this.tool;
    let { x: x0, y: y0 } = a, { x: x1, y: y1 } = b;
    const pts = [];
    if (t === 'line') {
      if (shift) {
        const dx = x1 - x0, dy = y1 - y0, ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.max(Math.abs(dx), Math.abs(dy));
        x1 = x0 + Math.round(Math.cos(ang) * len); y1 = y0 + Math.round(Math.sin(ang) * len);
      }
      this.line(x0, y0, x1, y1, (x, y) => pts.push([x, y]));
      return { pts, brush: true };
    }
    if (shift) {
      const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s;
    }
    const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
    if (t === 'rect') {
      for (let y = T; y <= B; y++) for (let x = L; x <= R; x++) {
        if (this.shapeFill || x === L || x === R || y === T || y === B) pts.push([x, y]);
      }
      return { pts, brush: !this.shapeFill };
    }
    // ellipse
    const cx = (L + R) / 2, cy = (T + B) / 2, rx = (R - L) / 2 + .5, ry = (B - T) / 2 + .5;
    const inside = (x, y) => ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry) <= 1;
    for (let y = T; y <= B; y++) for (let x = L; x <= R; x++) {
      if (!inside(x, y)) continue;
      if (this.shapeFill || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push([x, y]);
    }
    return { pts, brush: !this.shapeFill };
  },
  drawShapeInto(buf, a, b, shift, color) {
    const { pts, brush } = this.shapePixels(a, b, shift);
    const saved = this.doc.data;
    this.doc.data = buf; // setPx는 doc 크기 기준이라 버퍼만 교체
    for (const [x, y] of pts) {
      if (brush) this.brushAt(x, y, (cx, cy) => this.setPx(buf, cx, cy, color));
      else this.setPx(buf, x, y, color);
    }
    this.doc.data = saved;
  },

  /* ------------------------------------------------ selection / floating */
  normRect(a, b) {
    const d = this.doc, fr = this.fr();
    let x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(fr.y0, Math.min(a.y, b.y));
    let x1 = Math.min(d.w - 1, Math.max(a.x, b.x)), y1 = Math.min(fr.y0 + fr.h - 1, Math.max(a.y, b.y));
    if (x1 < x0 || y1 < y0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  },
  region() { const d = this.doc, fr = this.fr(); return d.sel || { x: 0, y: fr.y0, w: d.w, h: fr.h }; },
  extract(r) {
    const d = this.doc, out = new Uint8ClampedArray(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) out.set(d.data.subarray(((r.y + y) * d.w + r.x) * 4, ((r.y + y) * d.w + r.x + r.w) * 4), y * r.w * 4);
    return out;
  },
  liftSelection() {
    const d = this.doc;
    if (d.floating) return;
    const r = this.region();
    d.pushUndo();
    const data = this.extract(r);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) d.data.fill(0, (y * d.w + x) * 4, (y * d.w + x) * 4 + 4);
    d.floating = { x: r.x, y: r.y, w: r.w, h: r.h, data };
    d.sel = null;
    d.sync();
  },
  commitFloating() {
    const d = this.doc;
    if (!d || !d.floating) return;
    const f = d.floating;
    this.stampFloating(d.data, f);
    const r =this.normRect({ x: f.x, y: f.y }, { x: f.x + f.w - 1, y: f.y + f.h - 1 });
    d.floating = null;
    d.sel = r;
    this.markChanged('move');
  },
  stampFloating(buf, f) {
    const d = this.doc;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const tx = f.x + x, ty = f.y + y;
      if (tx < 0 || ty < 0 || tx >= d.w || ty >= d.h) continue;
      const si = (y * f.w + x) * 4;
      if (!f.data[si + 3]) continue;
      const di = (ty * d.w + tx) * 4;
      buf[di] = f.data[si]; buf[di + 1] = f.data[si + 1]; buf[di + 2] = f.data[si + 2]; buf[di + 3] = f.data[si + 3];
    }
  },
  selectAll() { if (!this.doc) return; this.commitFloating(); this.doc.sel = null; this.doc.sel = this.region(); this.render(); this.emit('status', this.hover); },
  deselect() { if (!this.doc) return; this.commitFloating(); this.doc.sel = null; this.render(); this.emit('status', this.hover); },
  deleteSel() {
    const d = this.doc; if (!d) return;
    if (d.floating) { d.floating = null; this.markChanged('delete'); return; }
    const r = this.region();
    d.pushUndo();
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) d.data.fill(0, (y * d.w + x) * 4, (y * d.w + x) * 4 + 4);
    this.markChanged('delete');
  },
  async copy(cut) {
    const d = this.doc; if (!d) return;
    this.commitFloating();
    const r = this.region();
    this.clip = { w: r.w, h: r.h, data: this.extract(r) };
    try {
      const cv = imageDataToCanvas(new ImageData(this.clip.data.slice(), r.w, r.h));
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch { /* 시스템 클립보드 사용 불가 - 내부 클립보드만 사용 */ }
    if (cut) this.deleteSel();
    toast(cut ? '잘라냈습니다' : `복사했습니다 (${r.w}×${r.h})`);
  },
  async paste() {
    const d = this.doc; if (!d) return;
    let clip = null;
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) { const b = await it.getType(type); const id = await bytesToImageData(new Uint8Array(await b.arrayBuffer())); clip = { w: id.width, h: id.height, data: new Uint8ClampedArray(id.data) }; break; }
      }
    } catch { /* 무시 */ }
    if (!clip) clip = this.clip;
    if (!clip) { toast('붙여넣을 이미지가 없습니다'); return; }
    this.commitFloating();
    d.pushUndo();
    const x = d.sel ? d.sel.x : 0, y = d.sel ? d.sel.y : 0;
    d.floating = { x, y, w: clip.w, h: clip.h, data: clip.data.slice() };
    d.sel = null;
    this.setTool('move');
    this.markChanged('paste');
  },
  nudge(dx, dy) {
    const d = this.doc; if (!d) return;
    if (!d.floating) this.liftSelection();
    d.floating.x += dx; d.floating.y += dy;
    this.markChanged('move');
  },

  /* ------------------------------------------------ undo */
  undo() {
    const d = this.doc; if (!d || this.drag) return;
    if (d.floating) { d.floating = null; }
    if (!d.undo.length) return;
    d.redo.push(d.snapshot());
    d.restore(d.undo.pop());
    if (d.sel && (d.sel.x + d.sel.w > d.w || d.sel.y + d.sel.h > d.h)) d.sel = null;
    this.markChanged('undo');
  },
  redo() {
    const d = this.doc; if (!d || this.drag || !d.redo.length) return;
    this.commitFloating();
    d.undo.push(d.snapshot());
    d.restore(d.redo.pop());
    this.markChanged('redo');
  },

  /* ------------------------------------------------ colors */
  setColor(which, c) {
    this[which] = c.slice();
    this.emit('color');
  },
  swapColors() { [this.primary, this.secondary] = [this.secondary, this.primary]; this.emit('color'); },
  addRecent(c) {
    const h = rgbaToHex(c);
    this.recent = [c.slice(), ...this.recent.filter(x => rgbaToHex(x) !== h)].slice(0, 20);
    this.emit('color');
  },

  /* ------------------------------------------------ pointer */
  onDown(e) {
    const d = this.doc;
    if (!d) return;
    try { this.cv.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터 */ }
    const p = this.toPixel(e);
    const right = e.button === 2;
    if (e.button === 1 || this.tool === 'pan' || this.spaceDown) {
      this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, px: d.view.panX, py: d.view.panY };
      this.updateCursor();
      return;
    }
    const tool = (e.altKey && ['pencil', 'fill', 'line', 'rect', 'ellipse'].includes(this.tool)) ? 'picker' : this.tool;
    const color = right ? this.secondary : this.primary;
    if (tool === 'picker') {
      if (p.x >= 0 && p.y >= 0 && p.x < d.w && p.y < d.h) this.setColor(right ? 'secondary' : 'primary', this.getPx(d.comp, p.x, p.y));
      this.drag = { type: 'pick', right };
      return;
    }
    if (d.floating && tool !== 'move') this.commitFloating();
    if (tool === 'pencil' || tool === 'eraser' || tool === 'shade') {
      d.pushUndo();
      const mode = tool === 'shade' ? 'shade' : 'paint';
      const shade = right ? (this.shadeMode === 'lighten' ? 'darken' : 'lighten') : this.shadeMode;
      const col = tool === 'eraser' ? [0, 0, 0, 0] : color;
      const start = (e.shiftKey && this.lastEnd && tool !== 'shade') ? this.lastEnd : p;
      this.drag = { type: 'stroke', mode, shade, color: col, last: start, touched: new Set() };
      if (tool === 'pencil') this.addRecent(col);
      this.strokeTo(p.x, p.y);
      return;
    }
    if (tool === 'fill') {
      d.pushUndo();
      if (this.floodFill(p.x, p.y, color, this.fillGlobal || e.shiftKey)) { this.addRecent(color); this.markChanged('fill'); }
      else d.undo.pop();
      return;
    }
    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      this.drag = { type: 'shape', a: p, color };
      this.preview = d.data.slice();
      this.drawShapeInto(this.preview, p, p, e.shiftKey, color);
      this.render();
      return;
    }
    if (tool === 'select') {
      this.drag = { type: 'select', a: p, rect: this.normRect(p, p) };
      this.render();
      return;
    }
    if (tool === 'move') {
      if (!d.floating) {
        if (d.sel && !this.inSel(p.x, p.y)) { d.sel = null; }
        this.liftSelection();
      }
      this.drag = { type: 'move', a: p, fx: d.floating.x, fy: d.floating.y };
      this.render();
    }
  },
  onMove(e) {
    const d = this.doc;
    if (!d) return;
    const p = this.toPixel(e), fr = this.fr();
    const inside = p.x >= 0 && p.y >= fr.y0 && p.x < d.w && p.y < fr.y0 + fr.h;
    this.hover = inside ? p : null;
    this.emit('status', this.hover);
    const dr = this.drag;
    if (!dr) { this.render(); return; }
    if (dr.type === 'pan') {
      d.view.panX = dr.px + (e.clientX - dr.sx);
      d.view.panY = dr.py + (e.clientY - dr.sy);
      this.render();
    } else if (dr.type === 'stroke') {
      if (p.x !== dr.last.x || p.y !== dr.last.y) this.strokeTo(p.x, p.y);
    } else if (dr.type === 'pick') {
      if (inside) this.setColor(dr.right ? 'secondary' : 'primary', this.getPx(d.comp, p.x, p.y));
    } else if (dr.type === 'shape') {
      this.preview = d.data.slice();
      this.drawShapeInto(this.preview, dr.a, p, e.shiftKey, dr.color);
      this.render();
    } else if (dr.type === 'select') {
      dr.rect = this.normRect(dr.a, p);
      this.render();
      this.emit('status', this.hover);
    } else if (dr.type === 'move') {
      d.floating.x = dr.fx + (p.x - dr.a.x);
      d.floating.y = dr.fy + (p.y - dr.a.y);
      this.render();
    }
  },
  onUp(e) {
    const d = this.doc, dr = this.drag;
    if (!d || !dr) return;
    this.drag = null;
    try { this.cv.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (dr.type === 'stroke') { this.lastEnd = dr.last; this.emit('change', d, 'strokeEnd'); }
    else if (dr.type === 'shape') {
      d.pushUndo();
      d.data = this.preview;
      this.preview = null;
      this.addRecent(dr.color);
      this.markChanged('shape');
      this.emit('change', d, 'strokeEnd');
    } else if (dr.type === 'select') {
      const r = dr.rect;
      d.sel = (r && (r.w > 1 || r.h > 1)) ? r : null;
      this.render();
    } else if (dr.type === 'move') {
      this.markChanged('move');
    }
    this.updateCursor();
    this.emit('status', this.hover);
  },

  /* ------------------------------------------------ transforms */
  forRegion(fn) {
    const d = this.doc; if (!d) return;
    this.commitFloating();
    d.pushUndo();
    const r = this.region();
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * d.w + x) * 4;
      fn(d.data, i);
    }
    this.markChanged('adjust');
  },
  flip(horizontal) {
    const d = this.doc; if (!d) return;
    this.commitFloating();
    d.pushUndo();
    const r = this.region(), src = this.extract(r);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const sx = horizontal ? r.w - 1 - x : x, sy = horizontal ? y : r.h - 1 - y;
      const si = (sy * r.w + sx) * 4, di = ((r.y + y) * d.w + r.x + x) * 4;
      d.data[di] = src[si]; d.data[di + 1] = src[si + 1]; d.data[di + 2] = src[si + 2]; d.data[di + 3] = src[si + 3];
    }
    this.markChanged('adjust');
  },
  rotate() {
    const d = this.doc; if (!d) return;
    this.commitFloating();
    const r = this.region();
    const whole = r.w === d.w && r.h === d.h;
    if (!whole && r.w !== r.h) { toast('선택 영역이 정사각형일 때만 회전할 수 있어요', true); return; }
    d.pushUndo();
    const src = this.extract(r);
    if (whole && d.w !== d.h) {
      // 그림 크기가 바뀌므로 모든 레이어를 함께 돌린다
      const nw = d.h, nh = d.w;
      d.mapLayers(s => {
        const out = new Uint8ClampedArray(nw * nh * 4);
        for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
          const nx = d.h - 1 - y, ny = x;
          out.set(s.subarray((y * d.w + x) * 4, (y * d.w + x) * 4 + 4), (ny * nw + nx) * 4);
        }
        return out;
      });
      d.w = nw; d.h = nh; d.sel = null;
    } else {
      const n = r.w;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const nx = n - 1 - y, ny = x;
        d.data.set(src.subarray((y * n + x) * 4, (y * n + x) * 4 + 4), ((r.y + ny) * d.w + r.x + nx) * 4);
      }
    }
    this.markChanged('adjust');
    if (whole) this.fit();
  },
  resizeDoc(nw, nh, mode) {
    const d = this.doc; if (!d) return;
    this.commitFloating();
    d.pushUndo();
    d.mapLayers(src => {
      const out = new Uint8ClampedArray(nw * nh * 4);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        let sx, sy;
        if (mode === 'scale') { sx = Math.floor(x * d.w / nw); sy = Math.floor(y * d.h / nh); }
        else { sx = x; sy = y; if (sx >= d.w || sy >= d.h) continue; }
        const si = (sy * d.w + sx) * 4;
        out.set(src.subarray(si, si + 4), (y * nw + x) * 4);
      }
      return out;
    });
    d.w = nw; d.h = nh; d.sel = null;
    this.markChanged('resize');
    this.fit();
  },
  replaceImage(id) {
    const d = this.doc; if (!d) return;
    this.commitFloating();
    d.pushUndo();
    const data = new Uint8ClampedArray(id.data);
    // 크기가 같으면 선택한 레이어에만, 다르면 한 장짜리 그림으로 바꾼다
    if (id.width === d.w && id.height === d.h) d.data = data;
    else d.setSingle(id.width, id.height, data);
    d.sel = null;
    this.markChanged('import');
    this.emit('layers');
    this.fit();
  },

  /* ------------------------------------------------ layers */
  layerOp(fn, kind = 'layers') {
    const d = this.doc; if (!d) return;
    this.commitFloating();
    d.pushUndo();
    if (fn(d) === false) { d.undo.pop(); return; }
    d.active = Math.max(0, Math.min(d.active, d.layers.length - 1));
    this.markChanged(kind);
    this.emit('layers');
  },
  selectLayer(i) {
    const d = this.doc; if (!d || i === d.active || !d.layers[i]) return;
    this.commitFloating();
    d.active = i;
    this.render();
    this.emit('layers');
  },
  addLayer() {
    this.layerOp(d => {
      d.layers.splice(d.active + 1, 0, TexDoc.layer('레이어 ' + (++d.layerSeq), new Uint8ClampedArray(d.w * d.h * 4)));
      d.active++;
    });
  },
  duplicateLayer() {
    this.layerOp(d => {
      const l = d.layer;
      d.layers.splice(d.active + 1, 0, { ...l, name: l.name + ' 복사', data: l.data.slice() });
      d.active++;
    });
  },
  deleteLayer() {
    this.layerOp(d => {
      if (d.layers.length <= 1) { toast('레이어가 하나뿐이라 지울 수 없어요', true); return false; }
      d.layers.splice(d.active, 1);
      d.active = Math.max(0, d.active - 1);
    });
  },
  moveLayer(dir) {
    this.layerOp(d => {
      const j = d.active + dir;
      if (j < 0 || j >= d.layers.length) return false;
      [d.layers[d.active], d.layers[j]] = [d.layers[j], d.layers[d.active]];
      d.active = j;
    });
  },
  /* 선택 레이어를 바로 아래 레이어와 합치기 */
  mergeDown() {
    this.layerOp(d => {
      if (d.active === 0) { toast('맨 아래 레이어라 합칠 레이어가 없어요', true); return false; }
      const top = d.layer, below = d.layers[d.active - 1];
      // 아래 레이어의 보이기·투명도 설정은 그대로 두고, 픽셀만 위 레이어를 덮어 합친다
      const pair = { w: d.w, h: d.h, active: -1, layers: [{ ...below, visible: true, opacity: 1 }, top] };
      below.data = TexDoc.prototype.compose.call(pair).slice();
      d.layers.splice(d.active, 1);
      d.active--;
    });
  },
  flattenLayers() {
    this.layerOp(d => {
      if (d.layers.length <= 1) return false;
      d.setSingle(d.w, d.h, d.flat());
    });
  },
  setLayerProp(i, prop, v, live) {
    const d = this.doc; if (!d || !d.layers[i]) return;
    if (!live) { this.commitFloating(); d.pushUndo(); }
    d.layers[i][prop] = v;
    this.markChanged('layers');
    if (!live) this.emit('layers');
  },

  /* ------------------------------------------------ keyboard */
  handleKey(e) {
    const d = this.doc;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z' && !e.shiftKey) { this.undo(); return true; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { this.redo(); return true; }
      if (k === 'a') { this.selectAll(); return true; }
      if (k === 'd') { this.deselect(); return true; }
      if (k === 'c') { this.copy(false); return true; }
      if (k === 'x') { this.copy(true); return true; }
      if (k === 'v') { this.paste(); return true; }
      return false;
    }
    if (e.key === ' ') { if (!this.spaceDown) { this.spaceDown = true; this.updateCursor(); this.render(); } return true; }
    if (e.key === 'Escape') { this.deselect(); return true; }
    if (e.key === 'Enter') { this.commitFloating(); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSel(); return true; }
    if (k === 'x') { this.swapColors(); return true; }
    if (k === '[') { this.setBrush(this.brush - 1); return true; }
    if (k === ']') { this.setBrush(this.brush + 1); return true; }
    if (k === '+' || k === '=') { this.zoomStep(1); return true; }
    if (k === '-') { this.zoomStep(-1); return true; }
    if (k === '0') { this.fit(); return true; }
    if (d && (k === ',' || k === '.') && d.frames > 1) { this.setFrame(d.frame + (k === ',' ? -1 : 1)); return true; }
    if (d && e.key.startsWith('Arrow') && (this.tool === 'move' || this.tool === 'select')) {
      const s = e.shiftKey ? 8 : 1;
      const dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0;
      const dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
      this.nudge(dx, dy);
      return true;
    }
    const t = TOOLS.find(x => x && x.key === k);
    if (t) { this.setTool(t.id); return true; }
    return false;
  },
  handleKeyUp(e) {
    if (e.key === ' ') { this.spaceDown = false; this.updateCursor(); this.render(); }
  },
  setBrush(n) {
    n = Math.max(1, Math.min(16, n));
    this.brush = n; $('#brush-size').value = n; $('#brush-size-val').textContent = n; this.render();
  }
};
