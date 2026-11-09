'use strict';
/* 기타 파일 (모델, 블록상태, 텍스트, 셰이더 등) 편집 */
const FILE_CATS = {
  models: '모델', blockstates: '블록 상태', texts: '텍스트 (스플래시·엔딩)', font: '글꼴 설정', shaders: '셰이더', atlases: '아틀라스',
  particles: '파티클', items: '아이템 정의', equipment: '장비', post_effect: '후처리 효과', textures: '텍스처 애니메이션(.mcmeta)', waypoint_style: '웨이포인트'
};
const QUICK_FILES = [
  ['assets/minecraft/texts/splashes.txt', '스플래시 문구'],
  ['assets/minecraft/texts/end.txt', '엔딩 시'],
  ['assets/minecraft/texts/credits.json', '크레딧'],
  ['assets/minecraft/texts/credits.txt', '크레딧'],
  ['assets/minecraft/texts/postcredits.txt', '엔딩 후 문구'],
  ['assets/minecraft/font/default.json', '기본 글꼴']
];
const TEXT_EXT = /\.(json|mcmeta|txt|fsh|vsh|glsl|properties|jem|jpm)$/i;

const Files = {
  items: [], cur: null, orig: '', dirty: false, loadedFor: null,
  init() {
    this.vl = new VList($('#file-list'), 30, (it, r) => this.renderRow(it, r));
    $('#file-search').addEventListener('input', debounce(() => this.filter(), 150));
    $('#file-cat').onchange = () => this.filter();
    $('#file-modified').onchange = () => this.filter();
    const ta = $('#file-text');
    ta.addEventListener('input', () => { this.dirty = ta.value !== this.loadedText; this.validate(); App.updateDirty(); });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart;
        ta.setRangeText('  ', s, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      }
    });
    $('#file-save').onclick = () => this.save().catch(errToast);
    $('#file-revert').onclick = () => this.revert().catch(errToast);
    $('#file-format').onclick = () => {
      try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 2); ta.dispatchEvent(new Event('input')); }
      catch (e) { toast('JSON 형식 오류: ' + e.message, true); }
    };
  },
  reset() { this.items = []; this.cur = null; this.dirty = false; this.loadedFor = null; this.vl.setItems([]); this.showEmpty(); },
  showEmpty() {
    $('#file-name').textContent = '파일을 선택하세요'; $('#file-path').textContent = '';
    $('#file-text').value = ''; $('#file-text').disabled = true; $('#file-status').textContent = '';
  },
  ensure() {
    if (this.loadedFor === App.version.id) return;
    this.loadedFor = App.version.id;
    const set = new Map();
    const add = (f, inJar) => {
      if (!TEXT_EXT.test(f) || /\/lang\//.test(f) || f === 'pack.mcmeta') return;
      const m = /^assets\/([^/]+)\/([^/]+)\//.exec(f);
      if (!m) return;
      const prev = set.get(f);
      set.set(f, { path: f, inJar: inJar || (prev && prev.inJar), cat: m[1] === 'minecraft' ? m[2] : m[1], name: f.split('/').pop() });
    };
    for (const f of App.version.files) add(f, true);
    for (const f of App.project.files) add(f, false);
    this.items = [...set.values()].sort((a, b) => a.path.localeCompare(b.path));
    const counts = {};
    for (const it of this.items) counts[it.cat] = (counts[it.cat] || 0) + 1;
    $('#file-cat').innerHTML = `<option value="">모든 폴더 (${this.items.length})</option>` + Object.keys(counts).sort().map(c => `<option value="${esc(c)}">${esc(FILE_CATS[c] || c)} (${counts[c]})</option>`).join('');
    const q = $('#file-quick'); q.innerHTML = '';
    for (const [p, n] of QUICK_FILES) {
      if (!set.has(p)) continue;
      if (n === '크레딧' && q.querySelector('[data-n="크레딧"]')) continue;
      const b = el('button', 'btn sm', esc(n)); b.dataset.n = n;
      b.onclick = () => this.open(p).catch(errToast);
      q.append(b);
    }
    this.filter();
  },
  filter() {
    const q = $('#file-search').value.trim().toLowerCase();
    const cat = $('#file-cat').value, mod = $('#file-modified').checked;
    this.vl.setItems(this.items.filter(it => (!cat || it.cat === cat) && (!mod || App.project.files.has(it.path)) && (!q || it.path.toLowerCase().includes(q))));
  },
  renderRow(it, r) {
    r.classList.add('frow');
    r.classList.toggle('active', this.cur === it.path);
    r.classList.toggle('mod', App.project.files.has(it.path));
    const sub = it.path.replace(/^assets\/[^/]+\//, '').split('/').slice(0, -1).join('/');
    r.append(el('div', 'nm', `<b>${esc(it.name)}</b> <small>${esc(sub)}</small>`));
    r.title = it.path;
    r.onclick = () => this.open(it.path).catch(errToast);
  },
  async open(p) {
    if (this.dirty && this.cur !== p) {
      const r = await modal({ title: '저장하지 않은 변경사항', body: `<b>${esc(this.cur)}</b>의 변경사항을 저장할까요?`, buttons: [{ label: '취소', value: null }, { label: '저장 안 함', value: 'no', danger: true }, { label: '저장', value: 'yes', primary: true }] });
      if (!r) return;
      if (r === 'yes') await this.save();
    }
    const inProj = App.project.files.has(p);
    const b = inProj ? await api.readFile(p) : await api.readJar(App.version.id, p);
    this.cur = p;
    this.loadedText = bytesToText(b);
    this.dirty = false;
    const ta = $('#file-text');
    ta.disabled = false; ta.value = this.loadedText; ta.scrollTop = 0;
    $('#file-name').textContent = p.split('/').pop();
    $('#file-path').textContent = p + (inProj ? ' · 수정됨' : ' · 원본');
    $('#file-format').classList.toggle('hidden', !/\.(json|mcmeta)$/.test(p));
    this.validate();
    this.vl.refresh();
    App.updateDirty();
  },
  validate() {
    const st = $('#file-status');
    st.className = 'dim';
    if (!this.cur) { st.textContent = ''; return; }
    if (/\.(json|mcmeta)$/.test(this.cur)) {
      try { JSON.parse($('#file-text').value); st.textContent = this.dirty ? '● JSON 정상 · 저장 안 됨' : 'JSON 정상'; st.className = 'ok'; }
      catch (e) { st.textContent = 'JSON 오류: ' + e.message; st.className = 'err'; }
    } else st.textContent = this.dirty ? '● 저장 안 됨' : '';
  },
  async save() {
    if (!this.cur || !this.dirty) return 0;
    const text = $('#file-text').value;
    if (/\.(json|mcmeta)$/.test(this.cur)) {
      try { JSON.parse(text); } catch (e) {
        if (!await confirmBox('JSON 오류', 'JSON 형식에 오류가 있습니다. 그래도 저장할까요? (게임에서 오류가 날 수 있어요)\n\n' + e.message, '그래도 저장', true)) return 0;
      }
    }
    await api.writeFile(this.cur, text);
    App.project.files.add(this.cur);
    this.loadedText = text;
    this.dirty = false;
    $('#file-path').textContent = this.cur + ' · 수정됨';
    this.validate(); this.vl.refresh(); App.updateDirty();
    if (this.cur.endsWith('.png.mcmeta')) { Textures.mcmetaKeys.add(this.cur.slice(0, -7)); const d = Editor.findDoc(this.cur.slice(0, -7)); if (d) { try { d.mcmeta = JSON.parse(text); } catch { /* ignore */ } } }
    return 1;
  },
  async revert() {
    if (!this.cur) return;
    const it = this.items.find(x => x.path === this.cur);
    if (!it || !it.inJar) {
      if (!App.project.files.has(this.cur)) return;
      if (!await confirmBox('파일 삭제', '이 파일은 원본이 없는 직접 추가한 파일입니다. 프로젝트에서 삭제할까요?', '삭제', true)) return;
      await api.removeFile(this.cur); App.project.files.delete(this.cur);
      this.items = this.items.filter(x => x !== it); this.cur = null; this.dirty = false; this.showEmpty(); this.filter(); App.updateDirty();
      return;
    }
    if (!await confirmBox('원본으로 되돌리기', '이 파일을 마인크래프트 원본 내용으로 되돌릴까요?', '되돌리기', true)) return;
    if (App.project.files.has(this.cur)) { await api.removeFile(this.cur); App.project.files.delete(this.cur); }
    this.dirty = false;
    const p = this.cur; this.cur = null;
    await this.open(p);
    toast('원본으로 되돌렸습니다');
  }
};
