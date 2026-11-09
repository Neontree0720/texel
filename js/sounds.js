'use strict';
/* 사운드 교체 */
const SND_CATS = {
  ambient: '환경음', block: '블록', damage: '피해', dig: '블록 부수기', enchant: '마법부여', entity: '엔티티', fire: '불', fireworks: '폭죽',
  item: '아이템', liquid: '물·용암', minecart: '광산 수레', mob: '몹', music: '배경 음악', note: '소리 블록', portal: '차원문',
  random: '기타 효과음', records: '음반', step: '발소리', title: '타이틀', ui: '인터페이스', event: '이벤트', music_disc: '음반'
};

const Sounds = {
  items: [], loadedFor: null, audio: new Audio(), playing: null,
  init() {
    this.vl = new VList($('#snd-list'), 46, (it, r) => this.renderRow(it, r));
    $('#snd-search').addEventListener('input', debounce(() => this.filter(), 150));
    $('#snd-cat').onchange = () => this.filter();
    $('#snd-modified').onchange = () => this.filter();
    const vol = $('#snd-vol');
    vol.oninput = () => { this.audio.volume = vol.value / 100; };
    this.audio.volume = .6;
    this.audio.onended = () => this.setPlaying(null);
  },
  reset() { this.items = []; this.loadedFor = null; this.stop(); this.vl.setItems([]); },
  async ensure() {
    if (this.loadedFor === App.version.id) return;
    let list = [];
    try {
      list = await withProgress('사운드 목록 불러오는 중…', () => api.listAssets(App.version.id, 'minecraft/sounds/'));
    } catch (e) {
      $('#snd-foot').textContent = '사운드 목록을 불러오지 못했습니다: ' + e.message + ' (인터넷 연결을 확인해 주세요)';
      return;
    }
    this.loadedFor = App.version.id;
    const map = new Map();
    for (const a of list) if (a.name.endsWith('.ogg')) map.set('assets/' + a.name, { name: a.name, path: 'assets/' + a.name, size: a.size, orig: true });
    for (const f of App.project.files) if (/^assets\/[^/]+\/sounds\/.+\.ogg$/.test(f) && !map.has(f)) map.set(f, { name: f.slice(7), path: f, orig: false });
    this.items = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const it of this.items) { const p = it.name.split('/'); it.cat = p[2] && p.length > 3 ? p[2] : 'random'; it.short = p.slice(2).join('/'); }
    const counts = {};
    for (const it of this.items) counts[it.cat] = (counts[it.cat] || 0) + 1;
    $('#snd-cat').innerHTML = `<option value="">모든 분류 (${this.items.length})</option>` + Object.keys(counts).sort().map(c => `<option value="${esc(c)}">${esc(SND_CATS[c] ? `${SND_CATS[c]} · ${c}` : c)} (${counts[c]})</option>`).join('');
    this.filter();
  },
  filter() {
    const q = $('#snd-search').value.trim().toLowerCase();
    const cat = $('#snd-cat').value, mod = $('#snd-modified').checked;
    const items = this.items.filter(it => (!cat || it.cat === cat) && (!mod || App.project.files.has(it.path)) && (!q || it.name.toLowerCase().includes(q)));
    this.vl.setItems(items);
    const n = this.items.filter(it => App.project.files.has(it.path)).length;
    $('#snd-foot').textContent = `${items.length}개 표시 · 바꾼 사운드 ${n}개 · 사운드는 교체하는 즉시 프로젝트에 저장됩니다`;
  },
  setPlaying(btn) {
    if (this.playing) this.playing.classList.remove('playing');
    this.playing = btn;
    if (btn) btn.classList.add('playing');
  },
  stop() { this.audio.pause(); this.setPlaying(null); },
  play(url, btn) {
    if (this.playing === btn) { this.stop(); return; }
    this.audio.src = url;
    this.audio.play().then(() => this.setPlaying(btn)).catch(e => { this.setPlaying(null); toast('재생할 수 없습니다: ' + e.message, true); });
  },
  renderRow(it, r) {
    r.classList.add('srow');
    const mine = App.project.files.has(it.path);
    r.classList.toggle('mod', mine);
    const p1 = el('button', 'play', '▶'); p1.title = '원래 소리 듣기';
    p1.disabled = !it.orig;
    p1.onclick = () => this.play(`${MC}obj/${encodeURIComponent(App.version.id)}/${encPath(it.name)}`, p1);
    const nm = el('div', 'nm', `${esc(it.short)}<small>${esc(SND_CATS[it.cat] || it.cat)}</small>`);
    nm.title = it.name;
    r.append(p1, nm);
    if (mine) {
      const p2 = el('button', 'play mine', '▶'); p2.title = '내가 넣은 소리 듣기';
      p2.onclick = () => this.play(`${MC}proj/${encPath(it.path)}?t=${Date.now()}`, p2);
      r.append(el('span', 'tag', '교체됨'), p2);
      const rv = el('button', 'btn sm danger', '되돌리기');
      rv.onclick = () => this.revert(it).catch(errToast);
      r.append(rv);
    }
    const rep = el('button', 'btn sm', '교체…');
    rep.onclick = () => this.replace(it).catch(errToast);
    r.append(rep);
  },
  async replace(it) {
    const f = await api.pickFile('바꿀 사운드 파일 선택 (.ogg)', ['ogg']);
    if (!f) return;
    const b = f.data;
    if (!(b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53)) throw new Error('올바른 .ogg (Ogg Vorbis) 파일이 아닙니다. 확장자만 바꾼 파일은 작동하지 않아요.');
    this.stop();
    await api.writeFile(it.path, b);
    App.project.files.add(it.path);
    this.vl.refresh(); this.filter();
    toast(`${it.short} 을(를) 교체했습니다`);
  },
  async revert(it) {
    this.stop();
    await api.removeFile(it.path);
    App.project.files.delete(it.path);
    if (!it.orig) this.items = this.items.filter(x => x !== it);
    this.filter();
    toast('원래 소리로 되돌렸습니다');
  }
};
