'use strict';
/* 레이어 패널 (오른쪽 도구 패널) */
const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1"/></svg>';

const Layers = {
  init() {
    this.list = $('#layer-list');
    this.op = $('#layer-opacity');
    this.thumb = document.createElement('canvas');
    let sliding = false;
    this.op.addEventListener('input', () => {
      const d = Editor.doc; if (!d) return;
      Editor.setLayerProp(d.active, 'opacity', +this.op.value / 100, sliding); // 처음 움직일 때만 실행 취소 기록
      sliding = true;
      $('#layer-opacity-val').textContent = this.op.value + '%';
    });
    this.op.addEventListener('change', () => { sliding = false; this.render(); });
    const acts = {
      add: () => Editor.addLayer(),
      dup: () => Editor.duplicateLayer(),
      del: () => Editor.deleteLayer(),
      up: () => Editor.moveLayer(1),
      down: () => Editor.moveLayer(-1),
      merge: () => Editor.mergeDown(),
      flatten: async () => {
        if (Editor.doc && Editor.doc.layers.length > 1 && await confirmBox('레이어 모두 합치기', '보이는 레이어를 모두 한 장으로 합칠까요? 숨긴 레이어는 버려집니다. (실행 취소 가능)', '합치기')) Editor.flattenLayers();
      }
    };
    $$('#layer-actions [data-l]').forEach(b => b.onclick = () => { if (Editor.doc) Promise.resolve(acts[b.dataset.l]()).catch(errToast); });
    Editor.on('change', () => this.renderSoon());
    Editor.on('layers', () => this.render());
    this.render();
  },
  renderSoon() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.render(); });
  },
  thumbUrl(d, l) {
    const fr = Editor.fr(), c = this.thumb, s = 36;
    const src = Editor.toScratch(l.data, d.w, d.h);
    c.width = c.height = s;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    const k = Math.min(s / d.w, s / fr.h), w = d.w * k, h = fr.h * k;
    x.drawImage(src, 0, fr.y0, d.w, fr.h, (s - w) / 2, (s - h) / 2, w, h);
    return c.toDataURL();
  },
  render() {
    const d = Editor.doc, box = this.list;
    $('#layer-section').classList.toggle('disabled', !d);
    if (!d) { box.innerHTML = '<div class="dim small">텍스처를 열면 레이어가 보여요</div>'; return; }
    // 위에 있는 레이어가 목록 위쪽에 오도록 거꾸로
    const rows = [];
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i];
      const r = el('div', 'layer-row' + (i === d.active ? ' active' : '') + (l.visible ? '' : ' hidden-layer'));
      r.dataset.i = i;
      const eye = el('button', 'layer-eye', l.visible ? EYE : EYE_OFF);
      eye.title = l.visible ? '숨기기' : '보이기';
      eye.onclick = (e) => { e.stopPropagation(); Editor.setLayerProp(i, 'visible', !l.visible); };
      const img = el('img', 'layer-thumb'); img.src = this.thumbUrl(d, l);
      const name = el('span', 'layer-name', esc(l.name));
      name.title = '더블클릭해서 이름 바꾸기';
      name.ondblclick = (e) => { e.stopPropagation(); this.rename(i, name); };
      const op = el('span', 'layer-op dim', l.opacity < 1 ? Math.round(l.opacity * 100) + '%' : '');
      r.append(eye, img, name, op);
      r.onclick = () => Editor.selectLayer(i);
      rows.push(r);
    }
    box.replaceChildren(...rows);
    const a = d.layer;
    if (document.activeElement !== this.op) {
      this.op.value = Math.round(a.opacity * 100);
      $('#layer-opacity-val').textContent = this.op.value + '%';
    }
    const one = d.layers.length <= 1;
    $('#layer-actions [data-l="del"]').disabled = one;
    $('#layer-actions [data-l="flatten"]').disabled = one;
    $('#layer-actions [data-l="merge"]').disabled = d.active === 0;
    $('#layer-actions [data-l="down"]').disabled = d.active === 0;
    $('#layer-actions [data-l="up"]').disabled = d.active === d.layers.length - 1;
  },
  rename(i, span) {
    const d = Editor.doc, l = d.layers[i];
    const inp = el('input', 'layer-rename');
    inp.value = l.name; inp.maxLength = 40;
    span.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (ok && v && v !== l.name) Editor.setLayerProp(i, 'name', v);
      else this.render();
    };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
    inp.onclick = (e) => e.stopPropagation();
  }
};
