'use strict';
/* 진짜 마인크래프트 글꼴로 글자 그리기
 * - 버전의 글꼴 정의(font/default.json)를 그대로 읽음: bitmap(ascii.png 등), space, reference, unihex(unifont.zip), legacy_unicode
 * - 리소스팩(프로젝트)에 있는 글꼴 파일이 있으면 그걸 우선 사용 (글꼴 정의는 게임처럼 위에 쌓임)
 * - 글자 폭, 그림자, 굵게, 기울임, 밑줄, 취소선을 게임 방식대로 계산
 * - §k(흔들림): 원래 글자와 폭이 같은 글자들 중에서 무작위로 고름 → 영어·한글·기호가 섞여서 나옴 */

const McFont = {
  ready: false, key: null, loading: null, failed: null,
  glyphs: new Map(), byWidth: new Map(), hexCache: new Map(), pages: new Map(), tintCache: new Map(), glyphCanvas: new Map(),
  live: new Set(),
  OPTIONS: { uniform: false, jp: false }, // 게임 기본 설정

  /* ------------------------------------------------ 불러오기 */
  currentKey() {
    if (!App.version) return null;
    const pf = App.project ? [...App.project.files].filter(f => /^assets\/[^/]+\/(font|textures\/font)\//.test(f)).sort().join(',') : '';
    return [App.version.id, App.project ? App.project.dir : '', pf, pf ? Textures.stamp : 0].join('|');
  },
  ensure() {
    const k = this.currentKey();
    if (!k) return Promise.resolve(false);
    if (this.key === k && (this.ready || this.loading)) return this.loading || Promise.resolve(this.ready);
    this.key = k; this.ready = false; this.failed = null;
    this.loading = this.load().then(() => { this.ready = true; return true; })
      .catch(e => { console.warn('글꼴 불러오기 실패', e); this.failed = e; return false; })
      .finally(() => { if (this.key === k) this.loading = null; });
    return this.loading;
  },
  async readRes(rel, vanillaOnly) {
    if (!vanillaOnly && App.project && App.project.files.has(rel)) return { bytes: await api.readFile(rel), src: 'proj:' + Textures.stamp };
    const vid = App.version.id;
    try { const b = await api.readAsset(vid, rel.replace(/^assets\//, '')); if (b) return { bytes: b, src: 'asset:' + vid }; } catch { /* 에셋 목록 없음 */ }
    if (App.jarSet.has(rel)) return { bytes: await api.readJar(vid, rel), src: 'jar:' + vid };
    return null;
  },
  resPath(id, folder, ext = '') {
    const [ns, p] = id.includes(':') ? id.split(':') : ['minecraft', id];
    return `assets/${ns}/${folder}/${p}${ext}`;
  },
  async loadDef(id) {
    const rel = this.resPath(id, 'font', '.json');
    const out = [];
    // 게임처럼: 리소스팩 정의가 먼저, 그 아래에 기본 정의가 쌓임
    for (const vanillaOnly of [false, true]) {
      if (!vanillaOnly && !(App.project && App.project.files.has(rel))) continue;
      const r = await this.readRes(rel, vanillaOnly);
      if (!r || !r.bytes) continue;
      try { out.push(...(JSON.parse(bytesToText(r.bytes)).providers || [])); } catch { /* 잘못된 JSON은 무시 */ }
    }
    return out;
  },
  async expand(list, out, depth = 0) {
    for (const p of list) {
      if (p.filter && Object.entries(p.filter).some(([k, v]) => !!this.OPTIONS[k] !== !!v)) continue;
      if (p.type === 'reference') { if (depth < 8) await this.expand(await this.loadDef(p.id), out, depth + 1); }
      else out.push(p);
    }
    return out;
  },
  async load() {
    this.glyphs = new Map(); this.byWidth = new Map(); this.pages = new Map(); this.tintCache.clear(); this.glyphCanvas.clear();
    let providers = await this.expand(await this.loadDef('minecraft:default'), []);
    if (!providers.length) providers = this.legacyProviders(); // 1.12 이하: 글꼴 정의 파일이 없음
    for (const p of providers) {
      try {
        if (p.type === 'bitmap') await this.addBitmap(p);
        else if (p.type === 'space') for (const [ch, adv] of Object.entries(p.advances || {})) this.put(ch.codePointAt(0), { k: 's', adv });
        else if (p.type === 'unihex') await this.addUnihex(p);
        else if (p.type === 'legacy_unicode') await this.addLegacy(p);
      } catch (e) { console.warn('글꼴 제공자 건너뜀', p, e); }
    }
    if (!this.glyphs.size) throw new Error('글꼴 글자를 찾지 못했습니다');
    // §k용: 폭(올림)별 글자 목록
    for (const [cp, g] of this.glyphs) {
      const w = Math.ceil(g.adv);
      let a = this.byWidth.get(w);
      if (!a) this.byWidth.set(w, a = []);
      a.push(cp);
    }
  },
  put(cp, g) { if (cp && !this.glyphs.has(cp)) this.glyphs.set(cp, g); },
  legacyProviders() {
    const rows = [];
    for (let r = 0; r < 16; r++) { let s = ''; for (let c = 0; c < 16; c++) { const cp = r * 16 + c; s += cp >= 33 && cp <= 126 ? String.fromCharCode(cp) : '\u0000'; } rows.push(s); }
    return [
      { type: 'space', advances: { ' ': 4 } },
      { type: 'bitmap', file: 'minecraft:font/ascii.png', ascent: 7, chars: rows },
      { type: 'legacy_unicode', sizes: 'minecraft:glyph_sizes.bin', template: 'minecraft:font/unicode_page_%s.png', legacy112: true }
    ];
  },
  async image(rel) {
    const r = await this.readRes(rel);
    if (!r || !r.bytes) return null;
    return bytesToImageData(r.bytes);
  },
  async addBitmap(p) {
    const id = await this.image(this.resPath(p.file, 'textures'));
    if (!id) return;
    const rows = (p.chars || []).map(s => Array.from(s));
    if (!rows.length || !rows[0].length) return;
    const cols = rows[0].length, cw = Math.floor(id.width / cols), ch = Math.floor(id.height / rows.length);
    const height = p.height != null ? p.height : 8, scale = height / ch, ascent = p.ascent;
    const sheet = imageDataToCanvas(id), d = id.data, W = id.width;
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      const cp = rows[r][c].codePointAt(0);
      if (!cp || this.glyphs.has(cp)) continue;
      // 게임과 같이: 오른쪽부터 훑어 처음 보이는 칸까지가 글자 폭
      let w = 0;
      for (let x = cw - 1; x >= 0 && !w; x--) for (let y = 0; y < ch; y++) if (d[((r * ch + y) * W + c * cw + x) * 4 + 3]) { w = x + 1; break; }
      this.glyphs.set(cp, { k: 'b', sheet, sx: c * cw, sy: r * ch, w, h: ch, scale, ascent, adv: Math.floor(0.5 + w * scale) + 1, off: 1 });
    }
  },
  async addUnihex(p) {
    const rel = this.resPath(p.hex_file, '');
    const fixed = rel.replace(/^assets\/([^/]+)\/\//, 'assets/$1/');
    const r = await this.readRes(fixed);
    if (!r || !r.bytes) return;
    const ck = r.src + '|' + fixed;
    let map = this.hexCache.get(ck);
    if (!map) {
      map = this.parseHex(await api.zipHexText(r.bytes));
      this.hexCache.clear(); this.hexCache.set(ck, map);
    }
    const ov = (p.size_overrides || []).map(o => ({ from: o.from.codePointAt(0), to: o.to.codePointAt(0), left: o.left, right: o.right }));
    for (const [cp, g0] of map) {
      if (this.glyphs.has(cp)) continue;
      let { left, right } = g0;
      for (const o of ov) if (cp >= o.from && cp <= o.to) { left = o.left; right = o.right; break; }
      this.glyphs.set(cp, { k: 'h', hex: g0.hex, bw: g0.bw, left, right, adv: Math.floor((right - left + 1) / 2) + 1, off: .5 });
    }
  },
  parseHex(text) {
    const map = new Map(), m = new Uint8Array(8);
    const hv = (c) => c <= 57 ? c - 48 : (c | 32) - 87;
    for (const line of text.split('\n')) {
      const i = line.indexOf(':');
      if (i < 1) continue;
      const cp = parseInt(line.slice(0, i), 16);
      const hex = line.slice(i + 1).trim();
      const n = hex.length / 16; // 한 줄의 16진 글자 수 (2/4/6/8)
      if (!(n >= 1 && n <= 8) || n % 1) continue;
      m.fill(0);
      for (let k = 0; k < hex.length; k++) m[k % n] |= hv(hex.charCodeAt(k));
      let left = -1, right = -2;
      for (let c = 0; c < n; c++) if (m[c]) { left = c * 4 + (m[c] & 8 ? 0 : m[c] & 4 ? 1 : m[c] & 2 ? 2 : 3); break; }
      for (let c = n - 1; c >= 0; c--) if (m[c]) { right = c * 4 + (m[c] & 1 ? 3 : m[c] & 2 ? 2 : m[c] & 4 ? 1 : 0); break; }
      if (left < 0) { left = 0; right = -1; }
      map.set(cp, { hex, bw: n * 4, left, right });
    }
    return map;
  },
  async addLegacy(p) {
    const sizesRel = p.legacy112 ? 'assets/minecraft/font/glyph_sizes.bin' : this.resPath(p.sizes, '');
    const r = await this.readRes(sizesRel.replace(/^assets\/([^/]+)\/\//, 'assets/$1/'));
    if (!r || !r.bytes) return;
    const sizes = r.bytes;
    this.legacyTemplate = p.template;
    for (let cp = 0; cp < Math.min(sizes.length, 65536); cp++) {
      const s = sizes[cp];
      if (!s || this.glyphs.has(cp)) continue;
      const left = s >> 4, right = s & 15;
      if (right < left) continue;
      this.glyphs.set(cp, { k: 'l', page: cp >> 8, cell: cp & 255, left, right, adv: Math.floor((right - left + 1) / 2) + 1, off: .5 });
    }
  },
  pageCanvas(page) {
    if (this.pages.has(page)) return this.pages.get(page);
    this.pages.set(page, null);
    const name = this.legacyTemplate.replace('%s', page.toString(16).padStart(2, '0'));
    this.image(this.resPath(name, 'textures')).then(id => { if (id) { this.pages.set(page, imageDataToCanvas(id)); this.glyphCanvas.clear(); this.redrawAll(); } });
    return null;
  },

  /* ------------------------------------------------ 글자 그림 */
  glyph(cp) { return this.glyphs.get(cp) || { k: 'm', adv: 6, off: 1 }; },
  randomGlyph(g) {
    const a = this.byWidth.get(Math.ceil(g.adv));
    return a && a.length ? this.glyph(a[Math.floor(Math.random() * a.length)]) : g;
  },
  /* 글자 하나의 원본 그림(흰색) + 화면에 그릴 크기(단위) */
  glyphImage(g) {
    let c = this.glyphCanvas.get(g);
    if (c) return c;
    if (g.k === 'b') {
      if (!g.w) return null;
      c = document.createElement('canvas'); c.width = g.w; c.height = g.h;
      c.getContext('2d').drawImage(g.sheet, g.sx, g.sy, g.w, g.h, 0, 0, g.w, g.h);
      c.u = { w: g.w * g.scale, h: g.h * g.scale, top: 7 - g.ascent };
    } else if (g.k === 'h') {
      const w = g.right - g.left + 1;
      if (w <= 0) return null;
      c = document.createElement('canvas'); c.width = w; c.height = 16;
      const x = c.getContext('2d'), id = x.createImageData(w, 16), n = g.bw / 4;
      for (let row = 0; row < 16; row++) for (let col = g.left; col <= g.right; col++) {
        const nib = parseInt(g.hex[row * n + (col >> 2)], 16);
        if (nib & (8 >> (col & 3))) id.data.set([255, 255, 255, 255], (row * w + col - g.left) * 4);
      }
      x.putImageData(id, 0, 0);
      c.u = { w: w / 2, h: 8, top: 0 };
    } else if (g.k === 'l') {
      const pg = this.pageCanvas(g.page);
      if (!pg) return null;
      const cs = pg.width / 16, w = (g.right - g.left + 1) * cs / 16;
      c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = cs;
      c.getContext('2d').drawImage(pg, (g.cell & 15) * cs + g.left * cs / 16, (g.cell >> 4) * cs, w, cs, 0, 0, w, cs);
      c.u = { w: (g.right - g.left + 1) / 2, h: 8, top: 0 };
    } else if (g.k === 'm') {
      c = document.createElement('canvas'); c.width = 5; c.height = 8;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 5, 8); x.clearRect(1, 1, 3, 6);
      c.u = { w: 5, h: 8, top: 0 };
    } else return null;
    if (this.glyphCanvas.size > 6000) this.glyphCanvas.clear();
    this.glyphCanvas.set(g, c);
    return c;
  },
  /* 글꼴 그림 색 × 글자색 (게임과 같은 곱하기) */
  tinted(src, color) {
    let m = this.tintCache.get(src);
    if (!m) { if (this.tintCache.size > 6000) this.tintCache.clear(); this.tintCache.set(src, m = new Map()); }
    let c = m.get(color);
    if (c) return c;
    c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0);
    m.set(color, c);
    return c;
  },

  /* ------------------------------------------------ 줄 배치 */
  layout(text, base) {
    const lines = [[]];
    let x = 0, maxW = 0, obf = false;
    for (const run of mcRuns(text, base)) {
      for (const ch of run.t) {
        if (ch === '\n') { maxW = Math.max(maxW, x); x = 0; lines.push([]); continue; }
        const cp = ch.codePointAt(0), g = this.glyph(cp);
        const adv = g.adv + (run.b ? g.off : 0);
        lines[lines.length - 1].push({ x, cp, g, run, adv });
        if (run.k && cp !== 32) obf = true;
        x += adv;
      }
    }
    maxW = Math.max(maxW, x);
    return { lines, w: maxW, obf };
  },
  render(text, opts = {}) {
    const c = document.createElement('canvas');
    c.className = 'mc-canvas';
    this.draw(c, text, opts);
    return c;
  },
  draw(c, text, opts) {
    const S = opts.scale || 2, base = opts.base || '#FFFFFF', shadow = opts.shadow !== false;
    const L = this.layout(text, base);
    const W = Math.max(1, Math.ceil((L.w + 2) * S)), H = Math.max(1, Math.ceil((L.lines.length * 9 + 1) * S));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; c.style.width = W + 'px'; c.style.height = H + 'px'; }
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, W, H);
    x.imageSmoothingEnabled = false;
    const items = [];
    L.lines.forEach((line, li) => {
      for (const it of line) {
        let g = it.g;
        if (it.run.k && it.cp !== 32) g = this.randomGlyph(it.g);
        items.push({ ...it, g, y: li * 9 });
      }
    });
    const pass = (isShadow) => {
      for (const it of items) {
        const r = it.run, color = isShadow ? mcShadow(r.c || base) : (r.c || base);
        const off = isShadow ? it.g.off : 0;
        const img = this.glyphImage(it.g);
        const gx = it.x + off, gy = it.y + off;
        if (img) {
          const t = this.tinted(img, color), u = img.u;
          const drawAt = (dx) => {
            if (r.i) {
              // 기울임: 줄 위쪽은 오른쪽으로 1칸, 아래쪽은 왼쪽으로
              const top = (gy + u.top) * S;
              x.setTransform(1, 0, -0.25, 1, S + 0.25 * (gy * S), 0);
              x.drawImage(t, (gx + dx) * S, top, u.w * S, u.h * S);
              x.setTransform(1, 0, 0, 1, 0, 0);
            } else x.drawImage(t, Math.round((gx + dx) * S), Math.round((gy + u.top) * S), Math.round(u.w * S), Math.round(u.h * S));
          };
          drawAt(0);
          if (r.b) drawAt(it.g.off);
        }
        x.fillStyle = color;
        if (r.s) x.fillRect(Math.round(gx * S), Math.round((gy + 3.5) * S), Math.round(it.adv * S), S);
        if (r.u) x.fillRect(Math.round((gx - 1) * S), Math.round((gy + 8) * S), Math.round((it.adv + 1) * S), S);
      }
    };
    if (shadow) pass(true);
    pass(false);
    if (L.obf) this.live.add({ c, text, opts }); // 흔들림 글자는 계속 다시 그림
  },
  redrawAll() {
    for (const e of [...this.live]) {
      if (!e.c.isConnected) { this.live.delete(e); continue; }
      this.live.delete(e);
      this.draw(e.c, e.text, e.opts);
    }
  }
};
setInterval(() => { if (McFont.live.size) McFont.redrawAll(); }, 50);
