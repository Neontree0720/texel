'use strict';
/* 언어(텍스트) 편집 */
const LANG_NAMES = {
  ko_kr: '한국어', en_us: 'English (US)', en_gb: 'English (UK)', ja_jp: '日本語', zh_cn: '简体中文', zh_tw: '繁體中文',
  de_de: 'Deutsch', fr_fr: 'Français', es_es: 'Español', it_it: 'Italiano', ru_ru: 'Русский', pt_br: 'Português (BR)',
  pl_pl: 'Polski', nl_nl: 'Nederlands', tr_tr: 'Türkçe', uk_ua: 'Українська', vi_vn: 'Tiếng Việt', th_th: 'ไทย', id_id: 'Bahasa Indonesia'
};
const LANG_CATS = {
  item: '아이템', block: '블록', entity: '엔티티(몹)', gui: 'GUI', menu: '메인 메뉴', options: '설정', advancements: '발전 과제',
  death: '사망 메시지', effect: '상태 효과', enchantment: '마법부여', biome: '생물군계', container: '보관함·작업대', key: '조작 키',
  chat: '채팅', multiplayer: '멀티플레이', selectWorld: '월드 선택', createWorld: '월드 만들기', subtitles: '자막', stat: '통계',
  commands: '명령어', attribute: '속성', color: '색', gamerule: '게임 규칙', mco: 'Realms', narrator: '내레이터', soundCategory: '소리 분류',
  title: '타이틀', deathScreen: '사망 화면', inventory: '인벤토리', filled_map: '지도', trim_material: '갑옷 장식 재료', trim_pattern: '갑옷 장식 무늬',
  jukebox_song: '음반', painting: '그림', instrument: '악기', book: '책', sign: '표지판', recipe: '제작법', structure_block: '구조물 블록',
  accessibility: '접근성', controls: '조작', difficulty: '난이도', gameMode: '게임 모드', generator: '월드 유형', lanServer: 'LAN 서버',
  pack: '리소스팩', resourcePack: '리소스팩', dataPack: '데이터팩', tutorial: '튜토리얼', demo: '데모'
};

const Lang = {
  langs: [], cur: null, states: {}, rows: [], lastInput: null, loadedFor: null,
  init() {
    this.vl = new VList($('#lang-list'), 42, (it, r) => this.renderRow(it, r));
    $('#lang-select').onchange = () => this.select($('#lang-select').value).catch(errToast);
    $('#lang-search').addEventListener('input', debounce(() => this.filter(), 150));
    $('#lang-cat').onchange = () => this.filter();
    $('#lang-modified').onchange = () => this.filter();
    $('#lang-replace').onclick = () => this.findReplace().catch(errToast);
    $('#lang-codes').onclick = () => this.codesDialog();
    document.addEventListener('focusin', e => {
      if (e.target.matches('.lrow input, #pack-desc, #pack-name')) this.lastInput = e.target;
      if (e.target.matches('.lrow input')) this.showPreview(e.target.value);
    });
    document.addEventListener('input', e => { if (e.target.matches('.lrow input')) this.showPreview(e.target.value); });
    this.markSoon = debounce(() => App.updateDirty(), 200);
  },
  showPreview(text) {
    const box = $('#lang-preview');
    this.previewText = text;
    box.title = text;
    if (!text) { box.innerHTML = '<span class="ph">(빈 글자)</span>'; return; }
    if (McFont.ready && McFont.key === McFont.currentKey()) {
      box.innerHTML = '';
      box.classList.add('canvas');
      box.append(McFont.render(text, { base: '#FFFFFF', scale: 4, shadow: true }));
      return;
    }
    // 글꼴을 불러오는 동안은 비슷한 글꼴로 먼저 보여주고, 다 불러오면 다시 그림
    box.classList.remove('canvas');
    box.innerHTML = mcFormat(text, '#FFFFFF', { shadow: true });
    McFont.ensure().then(ok => { if (ok && this.previewText === text) this.showPreview(text); });
  },
  reset() { this.langs = []; this.cur = null; this.states = {}; this.loadedFor = null; this.vl.setItems([]); },

  async ensure() {
    if (this.loadedFor === App.version.id) return;
    this.loadedFor = App.version.id;
    const map = new Map();
    for (const f of App.version.files) {
      const m = /^assets\/minecraft\/lang\/([^/]+)\.(json|lang)$/.exec(f);
      if (m && m[1] !== 'deprecated') map.set(m[1], { code: m[1], ext: m[2], src: 'jar', path: f });
    }
    try {
      const list = await withProgress('언어 목록 불러오는 중…', () => api.listAssets(App.version.id, 'minecraft/lang/'));
      for (const a of list) {
        const m = /^minecraft\/lang\/([^/]+)\.(json|lang)$/.exec(a.name);
        if (m && !map.has(m[1])) map.set(m[1], { code: m[1], ext: m[2], src: 'asset', path: a.name });
      }
    } catch (e) { toast('다른 언어 목록을 불러오지 못했습니다 (인터넷 연결 확인). 영어만 편집할 수 있어요.', true, 6000); }
    for (const f of App.project.files) {
      const m = /^assets\/minecraft\/lang\/([^/]+)\.(json|lang)$/.exec(f);
      if (m && !map.has(m[1])) map.set(m[1], { code: m[1], ext: m[2], src: 'none', path: null });
    }
    const pri = ['ko_kr', 'en_us'];
    this.langs = [...map.values()].sort((a, b) => {
      const ia = pri.indexOf(a.code.toLowerCase()), ib = pri.indexOf(b.code.toLowerCase());
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || a.code.localeCompare(b.code);
    });
    $('#lang-select').innerHTML = this.langs.map(l => {
      const n = LANG_NAMES[l.code.toLowerCase()];
      const mod = App.project.files.has(this.projPath(l)) ? ' ✎' : '';
      return `<option value="${esc(l.code)}">${esc(n ? `${n} (${l.code})` : l.code)}${mod}</option>`;
    }).join('');
    const def = this.langs.find(l => l.code.toLowerCase() === 'ko_kr') || this.langs.find(l => l.code.toLowerCase() === 'en_us') || this.langs[0];
    if (def) { $('#lang-select').value = def.code; await this.select(def.code); }
  },
  projPath(l) { return `assets/minecraft/lang/${l.code}.${l.ext}`; },
  parse(text, ext) {
    if (ext === 'json') { try { return JSON.parse(text); } catch { return {}; } }
    const o = {};
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i > 0) o[line.slice(0, i)] = line.slice(i + 1);
    }
    return o;
  },
  async select(code) {
    const l = this.langs.find(x => x.code === code);
    if (!l) return;
    this.cur = l;
    if (!this.states[code]) {
      await withProgress(`${LANG_NAMES[code.toLowerCase()] || code} 불러오는 중…`, async () => {
        let orig = {};
        if (l.src === 'jar') orig = this.parse(bytesToText(await api.readJar(App.version.id, l.path)), l.ext);
        else if (l.src === 'asset') orig = this.parse(bytesToText(await api.readAsset(App.version.id, l.path)), l.ext);
        let ov = {};
        const pp = this.projPath(l);
        if (App.project.files.has(pp)) ov = this.parse(bytesToText(await api.readFile(pp)), l.ext);
        let en = null;
        if (code.toLowerCase() !== 'en_us') {
          const enl = this.langs.find(x => x.code.toLowerCase() === 'en_us' && x.src === 'jar');
          if (enl) en = this.parse(bytesToText(await api.readJar(App.version.id, enl.path)), enl.ext);
        }
        this.states[code] = { orig, ov, en, dirty: false };
      });
    }
    const st = this.states[code];
    const keys = Object.keys(st.orig);
    for (const k of Object.keys(st.ov)) if (!(k in st.orig)) keys.push(k);
    this.rows = keys;
    const counts = {};
    for (const k of keys) { const c = k.split('.')[0]; counts[c] = (counts[c] || 0) + 1; }
    const cats = Object.keys(counts).sort((a, b) => (LANG_CATS[b] ? 1 : 0) - (LANG_CATS[a] ? 1 : 0) || counts[b] - counts[a]);
    $('#lang-cat').innerHTML = `<option value="">모든 분류 (${keys.length})</option>` + cats.map(c => `<option value="${esc(c)}">${esc(LANG_CATS[c] ? `${LANG_CATS[c]} · ${c}` : c)} (${counts[c]})</option>`).join('');
    this.filter();
  },
  filter() {
    const st = this.cur && this.states[this.cur.code];
    if (!st) return;
    const q = $('#lang-search').value.trim().toLowerCase();
    const cat = $('#lang-cat').value;
    const mod = $('#lang-modified').checked;
    const items = this.rows.filter(k => {
      if (cat && !k.startsWith(cat + '.') && k !== cat) return false;
      if (mod && !(k in st.ov)) return false;
      if (!q) return true;
      return k.toLowerCase().includes(q) || String(st.orig[k] || '').toLowerCase().includes(q) || String(st.ov[k] || '').toLowerCase().includes(q)
        || (st.en && String(st.en[k] || '').toLowerCase().includes(q));
    });
    this.vl.setItems(items);
    this.foot();
  },
  foot() {
    const st = this.states[this.cur.code];
    const n = Object.keys(st.ov).length;
    $('#lang-foot').textContent = `${this.vl.items.length}개 표시 · 이 언어에서 바꾼 항목 ${n}개` + (st.dirty ? ' (저장 안 됨)' : '');
  },
  renderRow(k, r) {
    const st = this.states[this.cur.code];
    r.classList.add('lrow');
    const mod = k in st.ov;
    r.classList.toggle('mod', mod);
    const orig = st.orig[k] != null ? String(st.orig[k]) : '';
    const kEl = el('div', 'k'); kEl.textContent = k; kEl.title = k;
    const oEl = el('div', 'o', mcFormat(orig));
    oEl.title = orig + (st.en && st.en[k] ? `\n\n[English] ${st.en[k]}` : '');
    const inp = el('input');
    inp.value = mod ? st.ov[k] : orig;
    inp.placeholder = '(비우면 원래대로)';
    inp.spellcheck = false;
    inp.addEventListener('input', () => {
      const v = inp.value;
      if (v === '' || v === orig) delete st.ov[k]; else st.ov[k] = v;
      st.dirty = true;
      r.classList.toggle('mod', k in st.ov);
      this.markSoon();
      this.foot();
    });
    inp.addEventListener('blur', () => { if (inp.value === '') inp.value = orig; });
    r.append(kEl, oEl, inp);
  },
  dirtyCount() { return Object.values(this.states).filter(s => s.dirty).length; },
  async saveAll() {
    let n = 0;
    for (const [code, st] of Object.entries(this.states)) {
      if (!st.dirty) continue;
      const l = this.langs.find(x => x.code === code);
      const pp = this.projPath(l);
      const keys = Object.keys(st.ov);
      if (!keys.length) {
        if (App.project.files.has(pp)) { await api.removeFile(pp); App.project.files.delete(pp); }
      } else {
        let text;
        if (l.ext === 'json') {
          const o = {};
          for (const k of this.rows.filter(k => k in st.ov)) o[k] = st.ov[k];
          for (const k of keys) if (!(k in o)) o[k] = st.ov[k];
          text = JSON.stringify(o, null, 2);
        } else text = keys.map(k => `${k}=${st.ov[k]}`).join('\n') + '\n';
        await api.writeFile(pp, text);
        App.project.files.add(pp);
      }
      st.dirty = false; n++;
    }
    if (this.cur) this.foot();
    return n;
  },
  insertCode(code) {
    const inp = this.lastInput;
    if (!inp || !document.body.contains(inp)) { toast('먼저 글자를 바꿀 입력칸을 클릭하세요'); return; }
    const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s;
    inp.value = inp.value.slice(0, s) + '§' + code + inp.value.slice(e);
    inp.focus();
    inp.setSelectionRange(s + 2, s + 2);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  },
  codesDialog() {
    const body = el('div');
    body.innerHTML = `<div class="dim small">입력칸의 커서 위치에 색상/서식 코드를 넣습니다. 코드 뒤에 오는 글자에 적용돼요.</div>
      <div class="codes">${Object.entries(MC_COLORS).map(([k, c]) => `<button data-c="${k}" title="${MC_COLOR_NAMES[k]} (§${k})" style="background:${c};color:${['0', '1', '4', '5', '8', '2'].includes(k) ? '#fff' : '#000'}">${k}</button>`).join('')}</div>
      <div class="codes fmt"><button data-c="l"><b>굵게 (§l)</b></button><button data-c="o"><i>기울임 (§o)</i></button><button data-c="n"><u>밑줄 (§n)</u></button><button data-c="m"><s>취소선 (§m)</s></button><button data-c="k">흔들림 (§k)</button><button data-c="r">초기화 (§r)</button></div>`;
    modal({
      title: '§ 색상 · 서식 코드', body, buttons: [{ label: '닫기', value: true }],
      onOpen: (b) => b.addEventListener('mousedown', e => { const t = e.target.closest('[data-c]'); if (t) { e.preventDefault(); this.insertCode(t.dataset.c); } })
    });
  },
  async findReplace() {
    if (!this.cur) return;
    const st = this.states[this.cur.code];
    const items = this.vl.items;
    const body = el('div');
    body.innerHTML = `<label>찾을 글자<input id="fr-find"></label><label>바꿀 글자<input id="fr-rep"></label>
      <p class="dim small">현재 목록에 보이는 ${items.length}개 항목에서 바꿉니다. (검색/분류로 범위를 좁힐 수 있어요)</p>`;
    const r = await modal({ title: '찾아 바꾸기', body, buttons: [{ label: '취소', value: null }, { label: '모두 바꾸기', primary: true, value: () => ({ f: $('#fr-find').value, t: $('#fr-rep').value }) }] });
    if (!r || !r.f) return;
    let n = 0;
    for (const k of items) {
      const cur = k in st.ov ? st.ov[k] : String(st.orig[k] ?? '');
      if (!cur.includes(r.f)) continue;
      const nv = cur.split(r.f).join(r.t);
      if (nv === String(st.orig[k] ?? '') || nv === '') delete st.ov[k]; else st.ov[k] = nv;
      n++;
    }
    if (n) { st.dirty = true; App.updateDirty(); }
    this.vl.refresh();
    this.foot();
    toast(`${n}개 항목을 바꿨습니다`);
  }
};
