'use strict';
/* 텍스처 브라우저 + 문서(탭) 관리 */
const CAT_LABELS = {
  block: '블록', blocks: '블록', item: '아이템', items: '아이템', entity: '엔티티(몹)', gui: 'GUI · 인터페이스',
  environment: '환경 (하늘·날씨)', particle: '파티클', painting: '그림', mob_effect: '상태 효과 아이콘', font: '글꼴 (글자 모양)',
  misc: '기타', colormap: '색상맵 (잔디·잎 색)', models: '갑옷 모델', map: '지도', effect: '효과', trims: '갑옷 장식',
  armor: '갑옷', entity_armor: '갑옷', painting_variants: '그림'
};
const CAT_ORDER = ['block', 'blocks', 'item', 'items', 'gui', 'entity', 'font', 'environment', 'particle', 'mob_effect', 'painting', 'misc'];

const Textures = {
  list: [], byKey: new Map(), stamp: Date.now(), mcmetaKeys: new Set(),
  init() {
    this.grid = $('#tex-grid');
    $('#tex-search').addEventListener('input', debounce(() => this.render(), 120));
    $('#tex-cat').onchange = () => this.render();
    $('#tex-modified').onchange = () => this.render();
    this.grid.addEventListener('click', e => {
      const t = e.target.closest('.tile');
      if (t) this.open(t.dataset.key).catch(errToast);
    });
    this.grid.addEventListener('load', e => {
      const img = e.target;
      if (img.tagName === 'IMG') img.classList.toggle('strip', img.naturalHeight > img.naturalWidth && img.naturalHeight % img.naturalWidth === 0);
    }, true);

    Editor.on('docs', () => { this.renderTabs(); this.markActive(); });
    const thumbSoon = debounce((d) => this.liveThumb(d), 300);
    Editor.on('change', (d, kind) => {
      Palette.renderDocSoon();
      Preview.draw();
      if (d && kind !== 'switch') { thumbSoon(d); App.updateDirty(); this.renderTabs(); }
      if (kind === 'switch') {
        Palette.renderDoc();
        $('#st-path').textContent = d ? d.key : '';
        const tinted = d && /\/(grass_block_top|grass_block_side_overlay|short_grass|grass|tall_grass_\w+|fern|large_fern_\w+|\w*leaves|water_\w+|vine|lily_pad|sugar_cane|redstone_dust_\w+|\w*_stem|attached_\w+_stem|birch_leaves|spruce_leaves)\.png$/.test(d.key);
        $('#st-hint').textContent = tinted ? 'ⓘ 게임에서 생물군계 색이 입혀지는 텍스처예요 (회색으로 보이는 게 정상)' : '';
      }
      this.updateFrameBar();
      this.updateStatus(Editor.hover);
    });
    Editor.on('status', h => this.updateStatus(h));
    this.bindActions();
    // 애니메이션 프레임 바
    $('#fr-prev').onclick = () => Editor.doc && Editor.setFrame(Editor.doc.frame - 1);
    $('#fr-next').onclick = () => Editor.doc && Editor.setFrame(Editor.doc.frame + 1);
    $('#fr-dup').onclick = () => Editor.addFrame();
    $('#fr-del').onclick = async () => { if (await confirmBox('프레임 삭제', `${Editor.doc.frame + 1}번 프레임을 삭제할까요? (실행 취소 가능)`, '삭제', true)) Editor.deleteFrame(); };
    $('#fr-onion').onchange = e => { if (Editor.doc) { Editor.doc.onion = e.target.checked; Editor.render(); } };
    $('#fr-all').onchange = e => Editor.setFrameMode(!e.target.checked);
    $('#fr-time').onchange = e => {
      const d = Editor.doc; if (!d) return;
      const v = Math.max(1, Math.min(1000, Math.round(+e.target.value) || 1));
      e.target.value = v;
      if (!d.mcmeta) d.mcmeta = {};
      if (!d.mcmeta.animation) d.mcmeta.animation = {};
      d.mcmeta.animation.frametime = v;
      d.mcmetaDirty = true;
      Editor.markChanged('meta');
    };
  },
  updateFrameBar() {
    const d = Editor.doc;
    const on = !!(d && d.frames > 1);
    $('#frame-bar').classList.toggle('hidden', !on);
    if (!on) return;
    $('#fr-label').textContent = d.frameMode ? `${d.frame + 1} / ${d.frames}` : `${d.frames}프레임`;
    $('#fr-onion').checked = d.onion;
    $('#fr-all').checked = !d.frameMode;
    for (const id of ['#fr-prev', '#fr-next', '#fr-dup', '#fr-del', '#fr-onion']) $(id).disabled = !d.frameMode;
    if (document.activeElement !== $('#fr-time')) $('#fr-time').value = (d.mcmeta && d.mcmeta.animation && d.mcmeta.animation.frametime) || 1;
  },

  build() {
    const keys = new Set();
    const re = /^assets\/([^/]+)\/textures\/(.+)\.png$/;
    this.mcmetaKeys = new Set();
    for (const f of App.version.files) {
      if (re.test(f)) keys.add(f);
      else if (f.endsWith('.png.mcmeta')) this.mcmetaKeys.add(f.slice(0, -7));
    }
    for (const f of App.project.files) {
      if (re.test(f)) keys.add(f);
      else if (f.endsWith('.png.mcmeta')) this.mcmetaKeys.add(f.slice(0, -7));
    }
    this.list = [...keys].map(k => {
      const m = re.exec(k);
      const ns = m[1], rest = m[2];
      const parts = rest.split('/');
      const cat = ns === 'minecraft' ? (parts.length > 1 ? parts[0] : 'misc') : ns;
      return { key: k, name: parts[parts.length - 1], sub: parts.slice(1, -1).join('/'), cat, ns };
    }).sort((a, b) => a.key.localeCompare(b.key));
    this.byKey = new Map(this.list.map(t => [t.key, t]));
    // 카테고리 선택지
    const counts = {};
    for (const t of this.list) counts[t.cat] = (counts[t.cat] || 0) + 1;
    const cats = Object.keys(counts).sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    const sel = $('#tex-cat'), prev = sel.value;
    sel.innerHTML = `<option value="">전체 (${this.list.length})</option>` + cats.map(c => `<option value="${esc(c)}">${esc(CAT_LABELS[c] || c)} (${counts[c]})</option>`).join('');
    sel.value = counts[prev] ? prev : (counts.block ? 'block' : counts.blocks ? 'blocks' : '');
    this.stamp = Date.now();
    this.render();
  },

  isModified(key) { return App.project && App.project.files.has(key); },
  urlFor(key) {
    if (this.isModified(key)) return `${MC}proj/${encPath(key)}?t=${this.stamp}`;
    return `${MC}jar/${encodeURIComponent(App.version.id)}/${encPath(key)}`;
  },

  filtered() {
    const q = $('#tex-search').value.trim().toLowerCase();
    const cat = $('#tex-cat').value;
    const mod = $('#tex-modified').checked;
    return this.list.filter(t => (!cat || t.cat === cat || q) && (!mod || this.isModified(t.key) || (Editor.findDoc(t.key) || {}).dirty)
      && (!q || t.key.toLowerCase().includes(q)));
  },
  render() {
    const items = this.filtered();
    const cur = Editor.doc && Editor.doc.key;
    $('#tex-count').textContent = `${items.length}개 텍스처` + ($('#tex-search').value.trim() && $('#tex-cat').value ? ' (전체 카테고리에서 검색)' : '');
    if (!items.length) { this.grid.innerHTML = '<div class="empty-list">검색 결과가 없습니다</div>'; return; }
    const html = [];
    for (const t of items) {
      const doc = Editor.findDoc(t.key);
      const cls = ['tile'];
      if (this.isModified(t.key)) cls.push('mod');
      if (doc && doc.dirty) cls.push('mod', 'unsaved');
      if (this.mcmetaKeys.has(t.key)) cls.push('anim');
      if (t.key === cur) cls.push('active');
      if (Pins.has(t.key)) cls.push('pinned');
      const nm = t.name + (t.sub ? '' : '');
      html.push(`<div class="${cls.join(' ')}" data-key="${esc(t.key)}" title="${esc(t.key.replace(/^assets\/[^/]+\/textures\//, ''))}"><div class="thumb"><img loading="lazy" draggable="false" src="${esc(this.urlFor(t.key))}"></div><div class="nm">${esc(nm)}</div></div>`);
    }
    this.grid.innerHTML = html.join('');
    for (const d of Editor.docs) if (d.dirty) this.liveThumb(d);
  },
  tileFor(key) { return this.grid.querySelector(`.tile[data-key="${CSS.escape(key)}"]`); },
  markActive() {
    const cur = Editor.doc && Editor.doc.key;
    $$('.tile.active', this.grid).forEach(t => t.classList.remove('active'));
    if (cur) { const t = this.tileFor(cur); if (t) t.classList.add('active'); }
  },
  liveThumb(d) {
    const t = this.tileFor(d.key);
    const url = d.canvas.toDataURL();
    if (t) {
      t.querySelector('img').src = url;
      t.classList.toggle('unsaved', d.dirty);
      if (d.dirty) t.classList.add('mod'); else t.classList.toggle('mod', this.isModified(d.key));
    }
    const tab = $(`.doc-tab[data-key="${CSS.escape(d.key)}"] img`);
    if (tab) tab.src = url;
    if (d.key === 'pack.png') Pack.refreshIcon(url);
  },

  /* ------------------------------------------------ open / save */
  async readSource(key) {
    if (this.isModified(key)) return api.readFile(key);
    return api.readJar(App.version.id, key);
  },
  async readMcmeta(key) {
    const mk = key + '.mcmeta';
    let b = null;
    if (App.project.files.has(mk)) b = await api.readFile(mk);
    else if (App.jarSet.has(mk)) b = await api.readJar(App.version.id, mk);
    if (!b) return null;
    try { return JSON.parse(bytesToText(b)); } catch { return null; }
  },
  async open(key) {
    const ex = Editor.findDoc(key);
    if (ex) { Editor.setDoc(ex); return ex; }
    const bytes = await this.readSource(key);
    if (!bytes) throw new Error('텍스처를 읽을 수 없습니다: ' + key);
    const id = await bytesToImageData(bytes);
    let orig = null;
    if (key !== 'pack.png' && App.jarSet.has(key)) {
      const ob = this.isModified(key) ? await api.readJar(App.version.id, key) : bytes;
      const oid = ob === bytes ? id : await bytesToImageData(ob);
      orig = { w: oid.width, h: oid.height, data: new Uint8ClampedArray(oid.data) };
    }
    const mcmeta = await this.readMcmeta(key);
    const doc = new TexDoc({ key, name: key.split('/').pop(), imageData: id, orig, mcmeta, isNew: !this.isModified(key) });
    if (this.isModified(key)) await this.loadLayers(doc, id).catch(() => { /* 레이어 정보가 깨졌으면 그냥 한 장으로 */ });
    Editor.addDoc(doc);
    if ($('#tab-textures').classList.contains('active') === false) App.showTab('textures');
    return doc;
  },
  openBlank(key, imageData) {
    const doc = new TexDoc({ key, name: key.split('/').pop(), imageData, isNew: true });
    doc.dirty = true;
    Editor.addDoc(doc);
    App.showTab('textures');
    App.updateDirty();
    return doc;
  },
  async saveDoc(d) {
    if (Editor.doc === d) Editor.commitFloating();
    d.sync();
    const bytes = await canvasToPngBytes(d.canvas);
    await api.writeFile(d.key, bytes);
    App.project.files.add(d.key);
    await this.saveLayers(d, bytes);
    // 애니메이션 설정(.mcmeta) - 바뀌었거나, 프레임이 있는데 설정 파일이 없을 때
    const mk = d.key + '.mcmeta';
    if (d.frames > 1 && !d.mcmeta) { d.mcmeta = { animation: { frametime: 2 } }; d.mcmetaDirty = true; }
    if (d.mcmetaDirty && d.key !== 'pack.png' || (d.frames > 1 && !App.project.files.has(mk) && !App.jarSet.has(mk))) {
      await api.writeFile(mk, JSON.stringify(d.mcmeta, null, 2));
      App.project.files.add(mk);
      this.mcmetaKeys.add(d.key);
      d.mcmetaDirty = false;
    }
    d.dirty = false; d.isNew = false;
    this.stamp = Date.now();
    const t = this.tileFor(d.key);
    if (t) { t.classList.add('mod'); t.classList.remove('unsaved'); t.querySelector('img').src = this.urlFor(d.key); }
    else if (d.key !== 'pack.png' && !this.byKey.has(d.key)) this.build();
    if (d.key === 'pack.png') Pack.refreshIcon();
  },
  /* ---------- 레이어 보관: PNG에는 합친 그림만 들어가므로, 레이어는 .texel 폴더에 따로 저장 */
  layersPath(key) { return '.texel/layers/' + key + '.json'; },
  pixelHash(data) {
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  },
  async saveLayers(d, pngBytes) {
    const p = this.layersPath(d.key);
    if (d.layers.length <= 1) { await api.removeFile(p); return; }
    // 저장된 PNG를 다시 읽은 값으로 지문을 만들어, 나중에 PNG가 밖에서 바뀌었는지 알아본다
    const id = await bytesToImageData(pngBytes);
    const enc = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const json = {
      v: 1, w: d.w, h: d.h, active: d.active, seq: d.layerSeq, hash: this.pixelHash(id.data),
      layers: d.layers.map(l => ({ name: l.name, visible: l.visible, opacity: l.opacity, rgba: enc(new Uint8Array(l.data.buffer, l.data.byteOffset, l.data.length)) }))
    };
    await api.writeFile(p, JSON.stringify(json));
  },
  async loadLayers(d, id) {
    const b = await api.readFile(this.layersPath(d.key));
    if (!b) return;
    const j = JSON.parse(bytesToText(b));
    // PNG가 다른 프로그램에서 바뀌었으면 옛 레이어는 쓰지 않는다
    if (j.v !== 1 || j.w !== id.width || j.h !== id.height || j.hash !== this.pixelHash(id.data)) return;
    const n = j.w * j.h * 4;
    const layers = j.layers.map(l => {
      const s = atob(l.rgba), u = new Uint8ClampedArray(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      if (u.length !== n) throw new Error('bad layer');
      return TexDoc.layer(String(l.name || '레이어'), u, l.visible !== false, Math.max(0, Math.min(1, +l.opacity || 0)));
    });
    if (!layers.length) return;
    d.layers = layers;
    d.active = Math.max(0, Math.min(layers.length - 1, j.active | 0));
    d.layerSeq = Math.max(layers.length, j.seq | 0);
    d.sync();
  },
  async saveAll() {
    let n = 0;
    for (const d of Editor.docs) if (d.dirty) { await this.saveDoc(d); n++; }
    this.renderTabs();
    return n;
  },
  dirtyCount() { return Editor.docs.filter(d => d.dirty).length; },
  async closeDoc(d) {
    if (d.dirty) {
      const r = await modal({
        title: '저장하지 않은 변경사항', body: `<b>${esc(d.name)}</b>의 변경사항을 저장할까요?`,
        buttons: [{ label: '취소', value: null }, { label: '저장 안 함', value: 'discard', danger: true }, { label: '저장', value: 'save', primary: true }]
      });
      if (!r) return;
      if (r === 'save') await this.saveDoc(d);
      else { d.dirty = false; }
    }
    Editor.closeDoc(d);
    const t = this.tileFor(d.key);
    if (t) { t.classList.remove('unsaved'); t.classList.toggle('mod', this.isModified(d.key)); t.querySelector('img').src = this.urlFor(d.key); }
    if (d.key === 'pack.png') Pack.refreshIcon();
    App.updateDirty();
  },
  closeAll() { Editor.docs = []; Editor.setDoc(null); },

  renderTabs() {
    const box = $('#doc-tabs');
    box.innerHTML = '';
    for (const d of Editor.docs) {
      const t = el('div', 'doc-tab' + (d === Editor.doc ? ' active' : '') + (d.dirty ? ' dirty' : ''));
      t.dataset.key = d.key;
      t.title = d.key;
      const img = el('img'); img.src = d.canvas.toDataURL();
      const x = el('span', 'x');
      t.append(img, el('span', '', esc(d.name.replace(/\.png$/, ''))), x);
      t.onclick = (e) => { if (e.target === x) this.closeDoc(d).catch(errToast); else Editor.setDoc(d); };
      t.onauxclick = (e) => { if (e.button === 1) this.closeDoc(d).catch(errToast); };
      box.append(t);
    }
    const cur = box.querySelector('.active');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },

  updateStatus(h) {
    const d = Editor.doc;
    if (!d) { $('#st-pos').textContent = '–'; $('#st-hex').textContent = '–'; $('#st-size').textContent = '–'; $('#st-sel').textContent = ''; return; }
    $('#st-size').textContent = `${d.w} × ${d.h}px` + (d.frames > 1 ? ` · ${d.frames}프레임` : '');
    const s = d.floating || (Editor.drag && Editor.drag.type === 'select' ? Editor.drag.rect : d.sel);
    $('#st-sel').textContent = s ? `선택: ${s.w} × ${s.h}` : '';
    if (h) {
      const c = h.c || Editor.getPx(d.comp, h.x, h.y);
      $('#st-pos').textContent = `${h.orig ? '원본 ' : ''}X ${h.x}, Y ${h.y}`;
      $('#st-hex').textContent = c[3] ? '#' + rgbaToHex(c) : '투명';
      $('#st-swatch').style.background = cssColor(c);
    } else { $('#st-pos').textContent = '–'; $('#st-hex').textContent = '–'; $('#st-swatch').style.background = 'transparent'; }
  },

  /* ------------------------------------------------ actions */
  bindActions() {
    const need = () => { if (!Editor.doc) { toast('먼저 텍스처를 열어주세요'); return false; } return true; };
    const acts = {
      flipH: () => Editor.flip(true),
      flipV: () => Editor.flip(false),
      rotate: () => Editor.rotate(),
      gray: () => Editor.forRegion((b, i) => { const v = Math.round(b[i] * .299 + b[i + 1] * .587 + b[i + 2] * .114); b[i] = b[i + 1] = b[i + 2] = v; }),
      invert: () => Editor.forRegion((b, i) => { b[i] = 255 - b[i]; b[i + 1] = 255 - b[i + 1]; b[i + 2] = 255 - b[i + 2]; }),
      clear: async () => { if (await confirmBox('전부 지우기', Editor.doc.sel ? '선택 영역을 투명하게 지울까요?' : '텍스처 전체를 투명하게 지울까요? (실행 취소 가능)', '지우기', true)) Editor.deleteSel(); },
      hsb: () => this.hsbDialog(),
      tint: () => this.tintDialog(),
      addFrame: () => Editor.addFrame(),
      resize: () => this.resizeDialog(),
      import: () => this.importPng(),
      exportPng: async () => {
        Editor.commitFloating();
        const p = await api.saveFile('PNG로 저장', Editor.doc.name, await canvasToPngBytes(Editor.doc.canvas));
        if (p) toast('저장됨: ' + p);
      },
      revert: () => this.revert(Editor.doc),
      compare: () => { if (!Editor.doc.orig) toast('원본이 없는 텍스처입니다'); }
    };
    $$('#tool-panel [data-act]').forEach(b => {
      b.addEventListener('click', () => { if (need()) Promise.resolve(acts[b.dataset.act]()).catch(errToast); });
    });
    const cmp = $('#tool-panel [data-act="compare"]');
    const on = () => { if (Editor.doc && Editor.doc.orig) { Editor.showOrig = true; Editor.render(); } };
    const off = () => { if (Editor.showOrig) { Editor.showOrig = false; Editor.render(); } };
    cmp.addEventListener('pointerdown', on);
    cmp.addEventListener('pointerup', off);
    cmp.addEventListener('pointerleave', off);
  },
  async revert(d) {
    if (!await confirmBox('원본으로 되돌리기', `${d.name}을(를) 마인크래프트 원본 텍스처로 되돌릴까요?\n저장된 수정본 파일도 삭제됩니다.`, '되돌리기', true)) return;
    if (this.isModified(d.key)) { await api.removeFile(d.key); App.project.files.delete(d.key); }
    await api.removeFile(this.layersPath(d.key));
    if (d.orig) {
      if (Editor.doc === d) Editor.commitFloating();
      d.pushUndo();
      d.setSingle(d.orig.w, d.orig.h, d.orig.data.slice()); d.sel = null;
      d.sync();
      Editor.render();
      Editor.emit('layers');
      d.dirty = false; d.isNew = true;
      Editor.emit('change', d, 'revert');
      d.dirty = false;
    } else {
      d.dirty = false;
      Editor.closeDoc(d);
      this.build();
    }
    this.stamp = Date.now();
    const t = this.tileFor(d.key);
    if (t) { t.classList.remove('mod', 'unsaved'); t.querySelector('img').src = this.urlFor(d.key); }
    this.renderTabs();
    App.updateDirty();
    toast('원본으로 되돌렸습니다');
  },
  async importPng() {
    const f = await api.pickFile('PNG 이미지 가져오기', ['png']);
    if (!f) return;
    let id = await bytesToImageData(f.data);
    const d = Editor.doc;
    if (id.width !== d.w || id.height !== d.h) {
      const r = await modal({
        title: '이미지 크기가 다릅니다',
        body: `가져온 이미지: <b>${id.width}×${id.height}</b><br>현재 텍스처: <b>${d.w}×${d.h}</b><br><br>고해상도 리소스팩이라면 크기를 그대로 두어도 됩니다 (가로·세로 비율은 원본과 같게 해 주세요).`,
        buttons: [{ label: '취소', value: null }, { label: `${d.w}×${d.h}로 맞추기`, value: 'fit' }, { label: '가져온 크기 그대로', value: 'keep', primary: true }]
      });
      if (!r) return;
      if (r === 'fit') {
        const c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
        const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
        x.drawImage(imageDataToCanvas(id), 0, 0, d.w, d.h);
        id = x.getImageData(0, 0, d.w, d.h);
      }
    }
    Editor.replaceImage(id);
    toast('이미지를 가져왔습니다');
  },
  async resizeDialog() {
    const d = Editor.doc;
    const body = el('div');
    body.innerHTML = `
      <div class="row"><label>가로<input type="number" id="rs-w" min="1" max="4096" value="${d.w}"></label><label>세로<input type="number" id="rs-h" min="1" max="4096" value="${d.h}"></label></div>
      <div class="row"><button class="btn sm" data-m="0.5">½</button><button class="btn sm" data-m="2">×2</button><button class="btn sm" data-m="4">×4</button><button class="btn sm" data-m="8">×8</button><label class="chk"><input type="checkbox" id="rs-lock" checked> 비율 유지</label></div>
      <label>방식<select id="rs-mode"><option value="scale">이미지 늘리기 (픽셀 그대로 확대/축소)</option><option value="canvas">캔버스 크기만 바꾸기 (왼쪽 위 기준)</option></select></label>
      <p class="dim small">팁: 16×16 텍스처를 ×2(32×32)로 늘리면 더 섬세한 고해상도 텍스처를 그릴 수 있어요.</p>`;
    const r = await modal({
      title: '크기 변경', body, buttons: [{ label: '취소', value: null }, { label: '적용', primary: true, value: () => ({ w: +$('#rs-w').value, h: +$('#rs-h').value, mode: $('#rs-mode').value }) }],
      onOpen: (b) => {
        const W = $('#rs-w', b), H = $('#rs-h', b), lock = $('#rs-lock', b);
        W.oninput = () => { if (lock.checked) H.value = Math.max(1, Math.round(+W.value * d.h / d.w)); };
        H.oninput = () => { if (lock.checked) W.value = Math.max(1, Math.round(+H.value * d.w / d.h)); };
        $$('[data-m]', b).forEach(x => x.onclick = () => { const m = +x.dataset.m; W.value = Math.max(1, Math.round(d.w * m)); H.value = Math.max(1, Math.round(d.h * m)); });
      }
    });
    if (!r || !(r.w > 0 && r.h > 0 && r.w <= 4096 && r.h <= 4096)) return;
    if (r.w === d.w && r.h === d.h) return;
    Editor.resizeDoc(r.w, r.h, r.mode);
  },
  async tintDialog() {
    const d = Editor.doc;
    Editor.commitFloating();
    const wasDirty = d.dirty;
    d.pushUndo();
    const base = d.data.slice();
    const reg = Editor.region();
    const col = Editor.primary.slice();
    const body = el('div');
    body.innerHTML = `<div class="row"><span>입힐 색 (주 색)</span><div class="sw" style="position:static;--c:${cssColor(col)}"></div><b>#${rgbaToHex(col, false)}</b></div>
      <div class="slider"><span>강도</span><input type="range" id="tn-a" min="0" max="100" value="70"><b id="tn-v">70</b></div>
      <label class="chk"><input type="checkbox" id="tn-keep" checked> 명암 유지 (밝은 곳은 밝게, 어두운 곳은 어둡게)</label>
      <p class="dim small">예: 회색 철 텍스처에 원하는 색을 입혀 새로운 광물처럼 만들 수 있어요. ${d.sel ? '선택 영역에만' : '텍스처 전체에'} 적용됩니다.</p>`;
    let amt = .7, keep = true;
    const apply = () => {
      const out = d.data; out.set(base);
      for (let y = reg.y; y < reg.y + reg.h; y++) for (let x = reg.x; x < reg.x + reg.w; x++) {
        const i = (y * d.w + x) * 4;
        if (!base[i + 3]) continue;
        const l = (base[i] * .299 + base[i + 1] * .587 + base[i + 2] * .114) / 255;
        for (let j = 0; j < 3; j++) {
          const t = keep ? col[j] * l * 1.25 : col[j];
          out[i + j] = base[i + j] + (t - base[i + j]) * amt;
        }
      }
      d.sync(); Editor.render(); Preview.draw();
    };
    apply();
    const ok = await modal({
      title: '색 입히기', body, buttons: [{ label: '취소', value: false }, { label: '적용', value: true, primary: true }],
      onOpen: (b) => {
        $('#tn-a', b).oninput = (e) => { amt = e.target.value / 100; $('#tn-v', b).textContent = e.target.value; apply(); };
        $('#tn-keep', b).onchange = (e) => { keep = e.target.checked; apply(); };
      }
    });
    if (ok && amt > 0) Editor.markChanged('adjust');
    else { d.restore(d.undo.pop()); d.dirty = wasDirty; Editor.render(); Preview.draw(); }
  },
  async hsbDialog() {
    const d = Editor.doc;
    Editor.commitFloating();
    const wasDirty = d.dirty;
    d.pushUndo();
    const base = d.data.slice();
    const reg = Editor.region();
    const body = el('div');
    body.innerHTML = ['h:색조:-180:180', 's:채도:-100:100', 'v:밝기:-100:100', 'c:대비:-100:100'].map(s => {
      const [k, n, a, b] = s.split(':');
      return `<div class="slider"><span>${n}</span><input type="range" data-k="${k}" min="${a}" max="${b}" value="0"><b data-v="${k}">0</b></div>`;
    }).join('') + `<p class="dim small">${d.sel ? '선택 영역에만' : '텍스처 전체에'} 적용됩니다.</p>`;
    const vals = { h: 0, s: 0, v: 0, c: 0 };
    const apply = () => {
      const out = d.data;
      out.set(base);
      const cf = (100 + vals.c) / 100;
      for (let y = reg.y; y < reg.y + reg.h; y++) for (let x = reg.x; x < reg.x + reg.w; x++) {
        const i = (y * d.w + x) * 4;
        if (!base[i + 3]) continue;
        let [h, s, v] = rgbToHsv(base[i], base[i + 1], base[i + 2]);
        h = (h + vals.h + 360) % 360;
        s = Math.max(0, Math.min(1, vals.s >= 0 ? s + (1 - s) * vals.s / 100 * (s > 0 ? 1 : 0) : s * (1 + vals.s / 100)));
        v = Math.max(0, Math.min(1, v + vals.v / 100 * (vals.v > 0 ? 1 - v : v)));
        let [r, g, b] = hsvToRgb(h, s, v);
        if (vals.c) { r = (r - 128) * cf + 128; g = (g - 128) * cf + 128; b = (b - 128) * cf + 128; }
        out[i] = r; out[i + 1] = g; out[i + 2] = b;
      }
      d.sync(); Editor.render(); Preview.draw();
    };
    const ok = await modal({
      title: '색조 / 채도 / 밝기', body, buttons: [{ label: '취소', value: false }, { label: '적용', value: true, primary: true }],
      onOpen: (b) => $$('input[type=range]', b).forEach(r => r.oninput = () => { vals[r.dataset.k] = +r.value; $(`[data-v="${r.dataset.k}"]`, b).textContent = r.value; apply(); })
    });
    if (ok && (vals.h || vals.s || vals.v || vals.c)) Editor.markChanged('adjust');
    else { d.restore(d.undo.pop()); d.dirty = wasDirty; Editor.render(); Preview.draw(); }
  }
};
