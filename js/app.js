'use strict';
/* 앱 전체 흐름: 시작 화면, 프로젝트, 버전, 탭, 단축키 */

function drawLogo(canvas) {
  const x = canvas.getContext('2d');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const greens = ['#5dbb3f', '#4fa834', '#6cc94a', '#459a2e'];
  const dirts = ['#8b5a36', '#79492b', '#9a6a43', '#6b3f24'];
  for (let y = 0; y < 16; y++) for (let X = 0; X < 16; X++) {
    const edge = 3 + ((X * 7 + 3) % 3 === 0 ? 1 : 0) + ((X * 5) % 4 === 0 ? 1 : 0);
    const pal = y < edge ? greens : dirts;
    x.fillStyle = pal[Math.floor(rnd() * pal.length)];
    x.fillRect(X, y, 1, 1);
  }
}

const App = {
  project: null, version: null, jarSet: new Set(), versionList: null,

  async start() {
    if (api.ready) await api.ready; // 웹 버전: 서비스 워커 준비
    for (const m of [Editor, ColorPicker, Palette, Preview, Layers, SavedPalettes, Pins, Textures, Lang, Sounds, Files, Pack]) m.init();
    $$('#sidenav button').forEach(b => b.onclick = () => this.showTab(b.dataset.tab));
    $('#btn-save').onclick = () => this.saveAll().catch(errToast);
    $('#btn-export').onclick = () => this.exportZip().catch(errToast);
    $('#btn-install').onclick = () => this.install().catch(errToast);
    $('#btn-folder').onclick = () => api.reveal().catch(errToast);
    $('#btn-home').onclick = () => this.goHome().catch(errToast);
    $('#btn-settings').onclick = () => this.settingsDialog().catch(errToast);
    api.getConfig().then(c => this.applySettings(c.settings || {})).catch(() => {});
    $('#new-create').onclick = () => this.create().catch(e => { Progress.hide(); errToast(e); });
    $('#new-parent-btn').onclick = async () => { const p = await api.pickFolder('리소스팩을 저장할 위치'); if (p) $('#new-parent').value = p; };
    $('#new-snap').onchange = () => this.fillVersionSelect($('#new-version'), $('#new-snap').checked, $('#new-version').value);
    $('#new-version').onchange = () => this.updateVerNote();
    $('#open-folder').onclick = async () => { try { const p = await api.openProject(); if (p) await this.setProject(p); } catch (e) { Progress.hide(); errToast(e); } };
    $('#open-zip').onclick = async () => { try { const p = await withProgress('리소스팩 가져오는 중…', () => api.importZip()); if (p) await this.setProject(p); } catch (e) { Progress.hide(); errToast(e); } };
    // 화면 쪽에서 띄운 진행 창은 화면 쪽이 닫고, 메인이 혼자 띄운 것(백그라운드 다운로드 등)은 메인의 '끝' 신호로 닫는다
    api.onProgress(d => {
      const ours = !$('#progress').classList.contains('hidden') && !Progress.fromMain;
      if (d.text) Progress.show(d.text, d.ratio, !ours);
      else if (Progress.fromMain) Progress.hide();
    });
    api.onCloseRequest(() => this.requestClose());
    if (IS_WEB) {
      // 웹: 저장 안 한 채로 탭을 닫으려 하면 브라우저가 한 번 묻는다
      window.addEventListener('beforeunload', e => { if (this.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
      $('#btn-folder').remove();
      $('#btn-install').title = '마인크래프트에 넣을 .zip 파일 받기';
      $('#ver-note').after(el('p', 'dim small web-note', '웹 버전은 프로젝트를 이 브라우저 안에 저장해요. 브라우저 기록·사이트 데이터를 지우면 함께 지워지니, 가끔 <b>.zip 내보내기</b>로 백업해 두세요.'));
    }
    document.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('keyup', e => Editor.handleKeyUp(e));
    window.addEventListener('blur', () => { Editor.spaceDown = false; Editor.updateCursor(); });
    $('#new-parent').value = await api.defaultProjectsDir();
    this.renderRecent();
    this.updateHeader();
    try {
      this.versionList = await api.listVersions();
    } catch (e) {
      this.versionList = { local: [], remote: [], latest: {} };
      errToast(e);
    }
    this.fillVersionSelect($('#new-version'), false);
  },

  /* ------------------------------------------------ settings */
  settings: {},
  applySettings(s) {
    this.settings = s;
    Editor.setCompare(!!s.compareOriginal);
  },
  async settingsDialog() {
    const body = el('div');
    body.innerHTML = `
      <div class="setting-row">
        <label class="chk"><input type="checkbox" id="set-compare" ${this.settings.compareOriginal ? 'checked' : ''}> 텍스처 편집할 때 원본 나란히 보기</label>
        <span class="dim">왼쪽에 마인크래프트 원본, 오른쪽에 지금 그리는 텍스처가 나와요. 왼쪽을 클릭하면 그 색을 가져와요 (우클릭은 보조 색). 확대·이동은 양쪽이 같이 움직여요.</span>
      </div>`;
    await modal({
      title: '설정', body, buttons: [{ label: '닫기', value: true, primary: true }],
      onOpen: (b) => {
        $('#set-compare', b).onchange = async (e) => {
          this.applySettings(await api.setSetting('compareOriginal', e.target.checked));
        };
      }
    });
  },

  /* ------------------------------------------------ versions */
  versionInfo(id) {
    const L = this.versionList || { local: [], remote: [] };
    return L.local.find(v => v.id === id) || L.remote.find(v => v.id === id) || null;
  },
  fillVersionSelect(sel, snaps, selected) {
    const L = this.versionList || { local: [], remote: [], latest: {} };
    const localIds = new Set(L.local.map(v => v.id));
    const opt = (v, note) => `<option value="${esc(v.id)}">${esc(v.id)}${note ? '  ' + note : ''}</option>`;
    let html = '';
    const local = L.local.filter(v => snaps || v.type === 'release' || v.id === selected);
    if (local.length) html += `<optgroup label="이 컴퓨터에 설치된 버전">${local.map(v => opt(v, v.hasJar ? '' : '(다운로드 필요)')).join('')}</optgroup>`;
    const rel = L.remote.filter(v => v.type === 'release' && v.releaseTime >= '2014-09-02' && !localIds.has(v.id));
    if (rel.length) html += `<optgroup label="정식 버전">${rel.map(v => opt(v, v.cached ? '' : '(다운로드)')).join('')}</optgroup>`;
    if (snaps) {
      const sn = L.remote.filter(v => v.type === 'snapshot' && !localIds.has(v.id) && v.releaseTime >= '2018-01-01');
      if (sn.length) html += `<optgroup label="스냅샷 / 미리보기">${sn.map(v => opt(v, v.cached ? '' : '(다운로드)')).join('')}</optgroup>`;
    }
    if (selected && !this.versionInfo(selected)) html = opt({ id: selected }) + html;
    if (!html) html = '<option value="">버전 목록을 불러올 수 없습니다</option>';
    sel.innerHTML = html;
    const all = [...sel.options].map(o => o.value);
    if (selected && all.includes(selected)) sel.value = selected;
    else {
      const best = L.local.find(v => v.hasJar && v.type === 'release') || L.remote.find(v => v.id === (L.latest && L.latest.release));
      if (best && all.includes(best.id)) sel.value = best.id;
    }
    if (sel.id === 'new-version') this.updateVerNote();
  },
  updateVerNote() {
    const v = this.versionInfo($('#new-version').value);
    $('#ver-note').textContent = !v ? '' : (v.hasJar || v.cached) ? '✔ 이 버전의 텍스처를 바로 불러올 수 있어요.'
      : '이 버전은 처음 사용할 때 Mojang 공식 서버에서 게임 파일(약 30~40MB)을 내려받아 원본 텍스처를 가져옵니다.';
  },
  async loadBaseVersion(id) {
    Progress.show(`${id} 불러오는 중…`);
    try {
      const v = await api.loadVersion(id);
      this.version = v;
      this.jarSet = new Set(v.files);
      const info = this.versionInfo(id);
      if (info && info.remote !== false) info.cached = true;
    } finally { Progress.hide(); }
    if (this.project) this.resetViews();
  },
  resetViews() {
    Textures.closeAll();
    Lang.reset(); Sounds.reset(); Files.reset();
    Textures.build();
    Pins.reset().then(() => Pins.markTiles());
    this.updateHeader();
    this.updateDirty();
  },

  /* ------------------------------------------------ projects */
  async renderRecent() {
    const c = await api.getConfig();
    const box = $('#recent-list');
    box.innerHTML = '';
    if (!c.recent || !c.recent.length) { box.innerHTML = '<div class="recent-empty">아직 프로젝트가 없어요. 왼쪽에서 새 리소스팩을 만들어 보세요!</div>'; return; }
    for (const r of c.recent) {
      const it = el('div', 'recent', `<div class="ri"><b>${esc(r.name)}</b><span>${esc(r.label || r.dir)}</span></div><span class="rm" title="목록에서 제거">×</span>`);
      it.onclick = async (e) => {
        if (e.target.classList.contains('rm')) { await api.removeRecent(r.dir); this.renderRecent(); return; }
        try { await this.setProject(await api.openProjectPath(r.dir)); }
        catch (err) { Progress.hide(); errToast(err); }
      };
      box.append(it);
    }
  },
  async create() {
    const name = $('#new-name').value.trim();
    const desc = $('#new-desc').value;
    const ver = $('#new-version').value;
    const parent = $('#new-parent').value;
    if (!name) { toast('이름을 입력하세요', true); return; }
    if (!ver) { toast('버전을 선택하세요', true); return; }
    if (!await this.confirmLeave()) return;
    this.project = null;
    await this.loadBaseVersion(ver);
    const proj = await api.createProject({ parent, name, description: desc, version: ver, packFormat: this.version.packFormat });
    this.project = { dir: proj.dir, meta: proj.meta, files: new Set(proj.files) };
    // 기본 팩 아이콘
    try {
      const id = await Pack.defaultIcon();
      await api.writeFile('pack.png', await canvasToPngBytes(imageDataToCanvas(id)));
      this.project.files.add('pack.png');
    } catch { /* ignore */ }
    await this.setProject({ dir: proj.dir, meta: proj.meta, files: [...this.project.files] });
    toast(`"${name}" 리소스팩을 만들었어요! 왼쪽에서 텍스처를 골라 편집해 보세요.`);
  },
  async setProject(p) {
    if (this.project && this.project.dir !== p.dir && !await this.confirmLeave()) return;
    this.project = { dir: p.dir, meta: p.meta, files: new Set(p.files) };
    if (!p.meta.version) {
      const v = await this.askVersion();
      if (!v) { this.project = null; this.updateHeader(); return; }
      p.meta.version = v;
      if (!this.version || this.version.id !== v) await this.loadBaseVersion(v);
      await api.saveMeta(p.meta, this.version.packFormat);
    } else if (!this.version || this.version.id !== p.meta.version) {
      await this.loadBaseVersion(p.meta.version);
    }
    this.resetViews();
    $('#welcome').classList.add('hidden');
    this.showTab('textures');
  },
  async askVersion() {
    const body = el('div');
    body.innerHTML = `<p>이 리소스팩이 사용할 마인크래프트 버전을 골라주세요. 이 버전의 원본 텍스처를 기준으로 편집합니다.</p><select id="ask-ver"></select>`;
    return modal({
      title: '마인크래프트 버전 선택', body, buttons: [{ label: '취소', value: null }, { label: '선택', primary: true, value: () => $('#ask-ver').value }],
      onOpen: (b) => this.fillVersionSelect($('#ask-ver', b), false)
    });
  },
  async goHome() {
    if (!await this.confirmLeave()) return;
    this.renderRecent();
    $('#welcome').classList.remove('hidden');
    if (this.project && !$('#welcome-back')) {
      const b = el('button', 'btn ghost', '← 현재 프로젝트로 돌아가기');
      b.id = 'welcome-back';
      b.onclick = () => $('#welcome').classList.add('hidden');
      $('.welcome-hero').append(el('div', 'spacer'), b);
    }
  },
  async confirmLeave() {
    if (!this.isDirty()) return true;
    const r = await modal({ title: '저장하지 않은 변경사항', body: '저장하지 않은 변경사항이 있습니다. 저장할까요?', buttons: [{ label: '취소', value: null }, { label: '저장 안 함', value: 'no', danger: true }, { label: '저장', value: 'yes', primary: true }] });
    if (!r) return false;
    if (r === 'yes') await this.saveAll();
    else { for (const d of Editor.docs) d.dirty = false; for (const s of Object.values(Lang.states)) s.dirty = false; Files.dirty = false; this.updateDirty(); }
    return true;
  },

  /* ------------------------------------------------ ui */
  updateHeader() {
    $('#proj-name').textContent = this.project ? this.project.meta.name : '프로젝트 없음';
    $('#ver-badge').textContent = this.version && this.project ? `Minecraft ${this.version.id}` : '';
    for (const id of ['#btn-save', '#btn-export', '#btn-install', '#btn-folder']) if ($(id)) $(id).disabled = !this.project;
    document.title = this.project ? `${this.project.meta.name} - Texel` : 'Texel';
  },
  isDirty() { return !!this.project && (Textures.dirtyCount() + Lang.dirtyCount() + (Files.dirty ? 1 : 0)) > 0; },
  updateDirty() { $('#dirty-flag').classList.toggle('on', this.isDirty()); },
  showTab(name) {
    $$('#sidenav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    if (!this.project) return;
    if (name === 'textures') { Editor.resize(); }
    if (name === 'lang') Lang.ensure().catch(errToast);
    if (name === 'sounds') Sounds.ensure().catch(errToast);
    if (name === 'files') Files.ensure();
    if (name === 'pack') Pack.render();
  },

  /* ------------------------------------------------ save / export */
  async saveAll(silent) {
    if (!this.project) return 0;
    const n = (await Textures.saveAll()) + (await Lang.saveAll()) + (await Files.save());
    this.updateDirty();
    if ($('#tab-pack').classList.contains('active')) Pack.stats();
    if (!silent) toast(n ? `저장했습니다 (${n}개 항목)` : '저장할 변경사항이 없습니다');
    return n;
  },
  async exportZip() {
    if (!this.project) return;
    await this.saveAll(true);
    let p;
    try { p = await api.exportZip(this.project.meta.name); } finally { Progress.hide(); }
    if (p) toast('내보냈습니다: ' + p, false, 5000);
  },
  async install() {
    if (!this.project) return;
    await this.saveAll(true);
    let p;
    try { p = await api.install(this.project.meta.name); } finally { Progress.hide(); }
    if (IS_WEB) {
      if (!p) return;
      await modal({
        title: '리소스팩 파일을 받았어요!',
        body: `<p><b>${esc(p)}</b> 파일이 다운로드 폴더에 저장됐어요. 이렇게 넣으면 적용돼요:</p>
          <ol class="steps">
            <li>마인크래프트에서 <b>설정 → 리소스 팩 → 팩 폴더 열기</b>를 눌러요.<br><span class="dim">(Windows라면 <code>%appdata%\\.minecraft\\resourcepacks</code> 폴더예요)</span></li>
            <li>받은 .zip 파일을 그 폴더에 넣어요. <span class="dim">압축은 풀지 않아도 돼요.</span></li>
            <li>게임으로 돌아가 이 팩을 오른쪽(선택됨)으로 옮기면 끝!</li>
          </ol>
          <p class="dim">같은 이름의 예전 파일이 있다면 지우고 넣어 주세요. 게임을 켜둔 상태라면 F3+T로 새로고침할 수 있어요.</p>`
      });
      return;
    }
    await modal({
      title: '마인크래프트에 적용했어요!',
      body: `<p>리소스팩을 아래 위치에 넣었습니다:</p><p class="dim small" style="word-break:break-all">${esc(p)}</p>
        <p>마인크래프트에서 <b>설정 → 리소스 팩</b>으로 들어가 이 팩을 오른쪽(선택됨)으로 옮기면 적용됩니다.<br>
        <span class="dim">이미 게임을 켜둔 상태라면 F3+T 를 눌러 리소스를 새로고침할 수 있어요.</span></p>`
    });
  },
  async requestClose() {
    if (this.isDirty()) {
      const r = await modal({ title: '종료하기 전에', body: '저장하지 않은 변경사항이 있습니다.', buttons: [{ label: '취소', value: null }, { label: '저장 안 하고 종료', value: 'no', danger: true }, { label: '저장 후 종료', value: 'yes', primary: true }] });
      if (!r) return;
      if (r === 'yes') { try { await this.saveAll(true); } catch (e) { errToast(e); return; } }
    }
    api.quit();
  },

  /* ------------------------------------------------ keys */
  onKey(e) {
    if ($('#modal-root').children.length) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); this.saveAll().catch(errToast); return; }
    if (!this.project || !$('#welcome').classList.contains('hidden')) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ($('#tab-textures').classList.contains('active')) {
      if (Editor.handleKey(e)) e.preventDefault();
    }
  }
};

window.addEventListener('DOMContentLoaded', () => App.start().catch(errToast));
