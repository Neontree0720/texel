'use strict';
/* 팩 설정 */
const Pack = {
  init() {
    $('#pack-name').addEventListener('input', () => this.preview());
    $('#pack-desc').addEventListener('input', () => this.preview());
    $('#pack-snap').onchange = () => App.fillVersionSelect($('#pack-version'), $('#pack-snap').checked, App.project.meta.version);
    $('#pack-save').onclick = () => this.save().catch(errToast);
    $('#pack-icon-edit').onclick = () => this.editIcon().catch(errToast);
    $('#pack-icon-import').onclick = () => this.importIcon().catch(errToast);
  },
  render() {
    const m = App.project.meta;
    $('#pack-name').value = m.name || '';
    $('#pack-desc').value = m.description || '';
    $('#pack-snap').checked = !!(App.versionInfo(m.version) && App.versionInfo(m.version).type !== 'release');
    App.fillVersionSelect($('#pack-version'), $('#pack-snap').checked, m.version);
    const pf = App.version.packFormat;
    $('#pack-format').textContent = pf.minor ? `${pf.major}.${pf.minor}` : pf.major;
    this.preview();
    this.refreshIcon();
    this.stats();
  },
  preview() {
    const name = $('#pack-name').value || '이름 없음', desc = $('#pack-desc').value;
    const real = McFont.ready && McFont.key === McFont.currentKey();
    const put = (sel, text, color) => {
      const box = $(sel);
      if (real) { box.innerHTML = ''; if (text) box.append(McFont.render(text, { base: color, scale: 2, shadow: true })); }
      else box.innerHTML = mcFormat(text, color, { shadow: true });
    };
    put('#pack-prev-name', name, '#FFFFFF');
    put('#pack-prev-desc', desc, '#A8A8A8');
    if (!real) McFont.ensure().then(ok => { if (ok && $('#tab-pack').classList.contains('active')) this.preview(); });
  },
  refreshIcon(url) {
    const d = Editor.findDoc('pack.png');
    const src = url || (d && d.dirty ? d.canvas.toDataURL() : App.project.files.has('pack.png') ? `${MC}proj/pack.png?t=${Date.now()}` : '');
    for (const img of [$('#pack-icon'), $('#pack-icon2')]) { img.src = src; img.style.visibility = src ? 'visible' : 'hidden'; }
  },
  stats() {
    const f = [...App.project.files];
    const tex = f.filter(x => /\/textures\/.+\.png$/.test(x)).length;
    const lang = f.filter(x => /\/lang\//.test(x)).length;
    const snd = f.filter(x => /\.ogg$/.test(x)).length;
    const other = f.filter(x => x.startsWith('assets/') && !/\.(png|ogg)$/.test(x) && !/\/lang\//.test(x)).length;
    $('#pack-stats').innerHTML = [[tex, '바꾼 텍스처'], [lang, '바꾼 언어 파일'], [snd, '바꾼 사운드'], [other, '기타 파일']]
      .map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  },
  async defaultIcon() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    const cands = ['assets/minecraft/textures/block/grass_block_side.png', 'assets/minecraft/textures/blocks/grass_side.png'];
    for (const k of cands) {
      if (!App.jarSet.has(k)) continue;
      try {
        const id = await bytesToImageData(await api.readJar(App.version.id, k));
        x.drawImage(imageDataToCanvas(id), 0, 0, id.width, id.width, 0, 0, 64, 64);
        // 회색 잔디 색을 초록으로 물들이기
        const d = x.getImageData(0, 0, 64, 64);
        for (let i = 0; i < d.data.length; i += 4) {
          const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2];
          if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && i < 64 * 4 * 22) { d.data[i] = r * .55; d.data[i + 1] = g * .78; d.data[i + 2] = b * .35; }
        }
        x.putImageData(d, 0, 0);
        return x.getImageData(0, 0, 64, 64);
      } catch { /* next */ }
    }
    x.fillStyle = '#5a9c3c'; x.fillRect(0, 0, 64, 64);
    return x.getImageData(0, 0, 64, 64);
  },
  async editIcon() {
    if (App.project.files.has('pack.png') || Editor.findDoc('pack.png')) await Textures.open('pack.png');
    else Textures.openBlank('pack.png', await this.defaultIcon());
  },
  async importIcon() {
    const f = await api.pickFile('팩 아이콘 이미지 (정사각형 PNG 권장)', ['png']);
    if (!f) return;
    const id = await bytesToImageData(f.data);
    await this.editIcon();
    Editor.replaceImage(id);
    await Textures.saveDoc(Editor.doc);
    Textures.renderTabs();
    App.updateDirty();
    toast('팩 아이콘을 바꿨습니다');
  },
  async save() {
    const m = App.project.meta;
    m.name = $('#pack-name').value.trim() || m.name;
    m.description = $('#pack-desc').value;
    const nv = $('#pack-version').value;
    if (nv && nv !== m.version) {
      const ok = await confirmBox('버전 변경', `기준 버전을 ${m.version} → ${nv}(으)로 바꿀까요?\n열린 텍스처는 저장된 뒤 닫히고, 새 버전의 텍스처 목록을 불러옵니다.`, '바꾸기');
      if (!ok) { $('#pack-version').value = m.version; return; }
      await App.saveAll(true);
      await App.loadBaseVersion(nv);
      m.version = nv;
    }
    await api.saveMeta(m, App.version.packFormat);
    App.updateHeader();
    this.render();
    toast('팩 설정을 저장했습니다');
  }
};
