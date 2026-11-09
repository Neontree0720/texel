'use strict';
/* 오른쪽 패널 탭(편집 / 팔레트 / 고정) + 저장 팔레트 + 텍스처 고정 */

/* 그림에 쓰인 색을 많이 쓰인 순으로 뽑아 색상환 순서로 정렬 */
function colorsOfData(data, max = 128) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const k = (data[i] << 24 | data[i + 1] << 16 | data[i + 2] << 8 | data[i + 3]) >>> 0;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const cols = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255]);
  cols.sort((a, b) => { const ha = rgbToHsv(a[0], a[1], a[2]), hb = rgbToHsv(b[0], b[1], b[2]); return (Math.round(ha[0] / 30) - Math.round(hb[0] / 30)) || (ha[2] - hb[2]); });
  return { colors: cols, total: counts.size };
}
async function askName(title, value, okLabel = '저장') {
  const body = el('div', '', `<input id="ask-name" maxlength="40" spellcheck="false" style="width:100%">`);
  const r = await modal({
    title, body, buttons: [{ label: '취소', value: null }, { label: okLabel, primary: true, value: () => $('#ask-name').value.trim() }],
    onOpen: (b) => { const i = $('#ask-name', b); i.value = value || ''; setTimeout(() => i.select(), 40); }
  });
  return r || null;
}
const prettyName = (key) => key.split('/').pop().replace(/\.png$/, '');

/* ------------------------------------------------ 탭 */
const RightTabs = {
  init() {
    $$('#rp-tabs [data-rp]').forEach(b => b.onclick = () => this.show(b.dataset.rp));
  },
  show(name) {
    $$('#rp-tabs [data-rp]').forEach(b => b.classList.toggle('active', b.dataset.rp === name));
    $$('#tool-panel .rp-page').forEach(p => p.classList.toggle('hidden', p.id !== 'rp-' + name));
    this.current = name;
    if (name === 'pins') Pins.render();
  }
};

/* ------------------------------------------------ 저장 팔레트 (앱 설정에 저장 → 모든 프로젝트 공용) */
const SavedPalettes = {
  list: [],
  init() {
    RightTabs.init();
    this.box = $('#saved-palettes');
    this.saveSoon = debounce(() => api.setSetting('palettes', this.list).catch(errToast), 300);
    $('#pal-from-doc').onclick = () => this.fromDoc().catch(errToast);
    $('#pal-new').onclick = () => this.create().catch(errToast);
    // 색 칸 클릭: 주 색 / 우클릭: 보조 색 / Ctrl+클릭: 빼기
    this.box.addEventListener('mousedown', e => {
      const sw = e.target.closest('.pc'); if (!sw) return;
      const p = this.byId(sw.closest('.spal').dataset.id); if (!p) return;
      if (e.ctrlKey || e.metaKey) { p.colors = p.colors.filter(h => h !== sw.dataset.c); this.changed(); return; }
      Editor.setColor(e.button === 2 ? 'secondary' : 'primary', hexToRgba(sw.dataset.c));
    });
    this.box.addEventListener('contextmenu', e => e.preventDefault());
    this.box.addEventListener('click', e => {
      const b = e.target.closest('[data-pa]'); if (!b) return;
      const p = this.byId(b.closest('.spal').dataset.id); if (!p) return;
      ({ add: () => this.addColor(p), rename: () => this.rename(p), del: () => this.remove(p), up: () => this.move(p, -1) })[b.dataset.pa]().catch?.(errToast);
    });
    api.getConfig().then(c => { this.list = (c.settings && Array.isArray(c.settings.palettes)) ? c.settings.palettes : []; this.render(); }).catch(() => this.render());
  },
  byId(id) { return this.list.find(p => p.id === id); },
  changed() { this.saveSoon(); this.render(); },
  async add(name, colors) {
    const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, colors };
    this.list.unshift(p);
    this.changed();
    RightTabs.show('palettes');
    return p;
  },
  async saveFrom(data, defName) {
    const { colors, total } = colorsOfData(data);
    if (!colors.length) { toast('투명한 그림이라 저장할 색이 없어요', true); return; }
    const name = await askName('팔레트로 저장', defName);
    if (!name) return;
    await this.add(name, colors.map(c => rgbaToHex(c)));
    toast(`"${name}" 팔레트를 저장했어요 (${colors.length}색${total > colors.length ? `, 많이 쓰인 ${colors.length}색만` : ''})`);
  },
  async fromDoc() {
    const d = Editor.doc;
    if (!d) { toast('먼저 텍스처를 열어주세요'); return; }
    Editor.commitFloating();
    await this.saveFrom(d.comp || d.data, prettyName(d.key));
  },
  async create() {
    const name = await askName('빈 팔레트 만들기', '내 팔레트', '만들기');
    if (!name) return;
    const p = await this.add(name, []);
    toast(`"${p.name}"을(를) 만들었어요. ＋ 버튼으로 지금 주 색을 넣을 수 있어요`);
  },
  async addColor(p) {
    const h = rgbaToHex(Editor.primary);
    if (p.colors.includes(h)) { toast('이미 들어 있는 색이에요'); return; }
    p.colors.push(h);
    this.changed();
  },
  async rename(p) {
    const n = await askName('팔레트 이름 바꾸기', p.name, '바꾸기');
    if (n) { p.name = n; this.changed(); }
  },
  async remove(p) {
    if (!await confirmBox('팔레트 삭제', `"${p.name}" 팔레트를 삭제할까요?`, '삭제', true)) return;
    this.list = this.list.filter(x => x !== p);
    this.changed();
  },
  async move(p, dir) {
    const i = this.list.indexOf(p), j = i + dir;
    if (j < 0 || j >= this.list.length) return;
    [this.list[i], this.list[j]] = [this.list[j], this.list[i]];
    this.changed();
  },
  render() {
    $('#palette-count').textContent = this.list.length || '';
    if (!this.list.length) {
      this.box.innerHTML = '<div class="rp-empty">아직 저장한 팔레트가 없어요.<br>마음에 드는 텍스처를 열고 <b>이 텍스처 색 저장</b>을 눌러 보세요.</div>';
      return;
    }
    this.box.innerHTML = this.list.map((p, i) => `
      <div class="spal" data-id="${esc(p.id)}">
        <div class="spal-head">
          <b title="${esc(p.name)}">${esc(p.name)}</b><span class="dim">${p.colors.length}색</span>
          <span class="spal-btns">
            <button class="mini" data-pa="add" title="지금 주 색을 이 팔레트에 넣기">＋</button>
            ${i ? '<button class="mini" data-pa="up" title="위로 올리기">▲</button>' : ''}
            <button class="mini" data-pa="rename" title="이름 바꾸기">✎</button>
            <button class="mini danger" data-pa="del" title="팔레트 삭제">✕</button>
          </span>
        </div>
        <div class="palette">${p.colors.map(h => `<div class="pc" data-c="${h}" title="#${h}" style="--c:${cssColor(hexToRgba(h))}"></div>`).join('')}</div>
      </div>`).join('');
  }
};

/* ------------------------------------------------ 텍스처 고정 (프로젝트마다 .texel/pins.json 에 저장) */
const PIN_FILE = '.texel/pins.json';
const PIN_BOX = 230;
const Pins = {
  pins: [], cache: new Map(), frame: new Map(),
  init() {
    this.box = $('#pin-list');
    $('#pin-current').onclick = () => { if (Editor.doc) this.pin(Editor.doc.key); else toast('먼저 텍스처를 열어주세요'); };
    // 텍스처 목록에서 우클릭 → 고정/해제
    $('#tex-grid').addEventListener('contextmenu', e => {
      const t = e.target.closest('.tile'); if (!t) return;
      e.preventDefault();
      this.toggle(t.dataset.key);
    });
    this.redrawSoon = debounce((key) => this.drawCard(key), 120);
    Editor.on('change', (d, kind) => { if (d && this.has(d.key) && kind !== 'switch') this.redrawSoon(d.key); });
    Editor.on('docs', () => { if (this.pins.length) this.render(); });
    this.render();
  },
  has(key) { return this.pins.some(p => p.key === key); },
  async reset() {
    this.pins = []; this.cache.clear(); this.frame.clear();
    try {
      const b = App.project && await api.readFile(PIN_FILE);
      const j = b ? JSON.parse(bytesToText(b)) : [];
      if (Array.isArray(j)) this.pins = j.filter(p => p && typeof p.key === 'string').map(p => ({ key: p.key, open: p.open !== false }));
    } catch { /* 깨진 파일은 무시 */ }
    this.render();
  },
  save() { if (App.project) api.writeFile(PIN_FILE, JSON.stringify(this.pins, null, 1)).catch(errToast); },
  pin(key) {
    if (!this.has(key)) { this.pins.unshift({ key, open: true }); this.save(); toast(`"${prettyName(key)}"을(를) 고정했어요`); }
    RightTabs.show('pins');
    this.render();
    this.markTiles();
  },
  unpin(key) {
    this.pins = this.pins.filter(p => p.key !== key);
    this.cache.delete(key);
    this.save();
    this.render();
    this.markTiles();
  },
  toggle(key) { if (this.has(key)) { this.unpin(key); toast(`"${prettyName(key)}" 고정을 풀었어요`); } else this.pin(key); },
  markTiles() { $$('#tex-grid .tile').forEach(t => t.classList.toggle('pinned', this.has(t.dataset.key))); },

  /* 그림 가져오기: 편집 중이면 편집 화면 그대로, 아니면 파일에서 */
  async source(key) {
    const d = Editor.findDoc(key);
    if (d) return { canvas: d.canvas, data: d.comp || d.data, w: d.w, h: d.h, live: true };
    const c = this.cache.get(key), stamp = Textures.isModified(key) ? Textures.stamp : 0;
    if (c && c.stamp === stamp) return c;
    if (!Textures.isModified(key) && !App.jarSet.has(key)) return null;
    const bytes = await Textures.readSource(key);
    if (!bytes) return null;
    const id = await bytesToImageData(bytes);
    const s = { canvas: imageDataToCanvas(id), data: id.data, w: id.width, h: id.height, stamp };
    this.cache.set(key, s);
    return s;
  },
  render() {
    $('#pin-count').textContent = this.pins.length || '';
    if (!this.box) return;
    if (!this.pins.length) {
      this.box.innerHTML = '<div class="rp-empty">고정한 텍스처가 없어요.<br>참고하고 싶은 텍스처를 고정해 두면 다른 텍스처를 그리는 동안 여기서 계속 볼 수 있어요.</div>';
      return;
    }
    this.box.replaceChildren(...this.pins.map(p => {
      const card = el('div', 'pin-card' + (p.open ? ' open' : ''));
      card.dataset.key = p.key;
      const editing = Editor.doc && Editor.doc.key === p.key;
      card.innerHTML = `
        <div class="pin-head" title="${esc(p.key)}">
          <span class="pin-caret">${p.open ? '▾' : '▸'}</span>
          <img class="pin-thumb" draggable="false">
          <b>${esc(prettyName(p.key))}</b>${editing ? '<span class="pin-tag">편집 중</span>' : ''}
          <span class="spal-btns">
            <button class="mini" data-pn="open" title="이 텍스처 편집하기">✎</button>
            <button class="mini" data-pn="pal" title="이 텍스처의 색을 팔레트로 저장">🎨</button>
            <button class="mini danger" data-pn="unpin" title="고정 풀기">✕</button>
          </span>
        </div>
        <div class="pin-body">
          <canvas class="pin-view"></canvas>
          <div class="pin-frames hidden"><button class="mini" data-pn="prev">◀</button><span></span><button class="mini" data-pn="next">▶</button></div>
        </div>`;
      card.querySelector('.pin-head').onclick = (e) => {
        const b = e.target.closest('[data-pn]');
        if (b) { this.action(p, b.dataset.pn).catch(errToast); return; }
        p.open = !p.open; this.save(); this.render();
      };
      card.querySelector('.pin-frames').onclick = (e) => { const b = e.target.closest('[data-pn]'); if (b) this.action(p, b.dataset.pn).catch(errToast); };
      const cv = card.querySelector('.pin-view');
      cv.addEventListener('pointerdown', e => this.pick(p.key, cv, e));
      cv.addEventListener('pointermove', e => { if (e.buttons & 3) this.pick(p.key, cv, e); });
      cv.addEventListener('contextmenu', e => e.preventDefault());
      return card;
    }));
    for (const p of this.pins) this.drawCard(p.key);
  },
  async action(p, a) {
    if (a === 'open') { if (Textures.isModified(p.key) || App.jarSet.has(p.key)) await Textures.open(p.key); else toast('이 버전에는 없는 텍스처예요', true); }
    else if (a === 'unpin') this.unpin(p.key);
    else if (a === 'pal') { const s = await this.source(p.key); if (s) await SavedPalettes.saveFrom(s.data, prettyName(p.key)); }
    else if (a === 'prev' || a === 'next') { this.frame.set(p.key, (this.frame.get(p.key) || 0) + (a === 'next' ? 1 : -1)); this.drawCard(p.key); }
  },
  async drawCard(key) {
    const card = this.box && this.box.querySelector(`.pin-card[data-key="${CSS.escape(key)}"]`);
    if (!card) return;
    let s;
    try { s = await this.source(key); } catch { s = null; }
    const thumb = card.querySelector('.pin-thumb'), cv = card.querySelector('.pin-view');
    if (!s) {
      thumb.removeAttribute('src');
      card.querySelector('.pin-body').innerHTML = '<div class="dim small">이 버전에는 없는 텍스처예요</div>';
      return;
    }
    // 애니메이션 텍스처는 한 프레임씩
    const frames = (s.h > s.w && s.h % s.w === 0) ? s.h / s.w : 1;
    let f = this.frame.get(key) || 0; f = ((f % frames) + frames) % frames; this.frame.set(key, f);
    const fh = frames > 1 ? s.w : s.h, y0 = f * fh;
    const fb = card.querySelector('.pin-frames');
    fb.classList.toggle('hidden', frames <= 1);
    fb.querySelector('span').textContent = `${f + 1} / ${frames}`;
    // 작은 미리보기
    const t = document.createElement('canvas'); t.width = t.height = 24;
    const tx = t.getContext('2d'); tx.imageSmoothingEnabled = false;
    const k = Math.min(24 / s.w, 24 / fh);
    tx.drawImage(s.canvas, 0, y0, s.w, fh, (24 - s.w * k) / 2, (24 - fh * k) / 2, s.w * k, fh * k);
    thumb.src = t.toDataURL();
    if (!card.classList.contains('open')) return;
    // 크게 펼친 그림 (정수 배율로 또렷하게)
    let z = Math.min(PIN_BOX / s.w, PIN_BOX / fh);
    if (z >= 1) z = Math.floor(z);
    const W = Math.max(1, Math.round(s.w * z)), H = Math.max(1, Math.round(fh * z));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const x = cv.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.clearRect(0, 0, W, H);
    x.drawImage(s.canvas, 0, y0, s.w, fh, 0, 0, W, H);
    cv.dataset.z = z; cv.dataset.y0 = y0;
  },
  async pick(key, cv, e) {
    const s = await this.source(key); if (!s) return;
    const r = cv.getBoundingClientRect(), z = +cv.dataset.z * (r.width / cv.width);
    const x = Math.floor((e.clientX - r.left) / z), y = Math.floor((e.clientY - r.top) / z) + (+cv.dataset.y0 || 0);
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
    const i = (y * s.w + x) * 4;
    Editor.setColor(e.button === 2 || (e.buttons & 2) ? 'secondary' : 'primary', [s.data[i], s.data[i + 1], s.data[i + 2], s.data[i + 3]]);
  }
};
