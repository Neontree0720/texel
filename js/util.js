'use strict';
/* 공용 유틸리티 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// 원본/프로젝트 파일 주소의 앞부분: 데스크톱은 mc:// 프로토콜, 웹 버전은 서비스 워커가 받는 /mc/ 경로
const MC = (window.api && window.api.mcBase) || 'mc://';
const IS_WEB = !!(window.api && window.api.isWeb);

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function encPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

/* ---------- toast ---------- */
function toast(msg, isErr = false, ms = 3200) {
  const t = el('div', 'toast' + (isErr ? ' err' : ''));
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}
function errToast(e) { console.error(e); toast(e && e.message ? e.message : String(e), true, 6000); }

/* ---------- modal ---------- */
function modal({ title, body, buttons = [{ label: '확인', value: true, primary: true }], onOpen, width }) {
  return new Promise(resolve => {
    const bg = el('div', 'modal-bg');
    const m = el('div', 'modal');
    if (width) m.style.width = width + 'px';
    if (title) m.append(el('h3', '', esc(title)));
    const b = el('div', 'mbody');
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
    m.append(b);
    const f = el('div', 'mfoot');
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    for (const bt of buttons) {
      const btn = el('button', 'btn' + (bt.primary ? ' primary' : '') + (bt.danger ? ' danger' : ''), esc(bt.label));
      btn.onclick = () => close(typeof bt.value === 'function' ? bt.value() : bt.value);
      f.append(btn);
    }
    m.append(f);
    bg.append(m);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const p = buttons.find(x => x.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); close(typeof p.value === 'function' ? p.value() : p.value); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    $('#modal-root').append(bg);
    if (onOpen) onOpen(b, close);
    const first = b.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
  });
}
async function confirmBox(title, msg, okLabel = '확인', danger = false) {
  return !!(await modal({ title, body: esc(msg), buttons: [{ label: '취소', value: false }, { label: okLabel, value: true, primary: !danger, danger }] }));
}

/* ---------- progress ---------- */
const Progress = {
  /* fromMain: 메인 프로세스가 띄운 진행 창이면, 메인이 '끝' 신호를 보낼 때 닫는다 */
  show(text, ratio = -1, fromMain = false) {
    this.fromMain = fromMain;
    $('#progress').classList.remove('hidden');
    $('#prog-text').textContent = text;
    const bar = $('.prog-bar');
    bar.classList.toggle('indet', ratio < 0);
    if (ratio >= 0) $('#prog-fill').style.width = (ratio * 100).toFixed(1) + '%';
  },
  hide() { this.fromMain = false; $('#progress').classList.add('hidden'); }
};
async function withProgress(text, fn) {
  Progress.show(text);
  try { return await fn(); } finally { Progress.hide(); }
}

/* ---------- virtual list ---------- */
class VList {
  constructor(container, rowH, render) {
    this.c = container; this.rowH = rowH; this.render = render;
    this.inner = el('div', 'vlist-inner');
    container.append(this.inner);
    this.items = []; this.rows = new Map();
    container.addEventListener('scroll', () => this.draw());
    new ResizeObserver(() => this.draw()).observe(container);
  }
  setItems(items, keepScroll = false) {
    this.items = items;
    for (const r of this.rows.values()) r.remove();
    this.rows.clear();
    this.inner.style.height = items.length * this.rowH + 'px';
    if (!keepScroll) this.c.scrollTop = 0;
    this.draw();
  }
  refresh() { for (const r of this.rows.values()) r.remove(); this.rows.clear(); this.draw(); }
  draw() {
    const st = this.c.scrollTop, h = this.c.clientHeight || 600;
    const a = Math.max(0, Math.floor(st / this.rowH) - 6);
    const b = Math.min(this.items.length, Math.ceil((st + h) / this.rowH) + 6);
    for (const [i, r] of this.rows) {
      if ((i < a || i >= b) && !r.contains(document.activeElement)) { r.remove(); this.rows.delete(i); }
    }
    for (let i = a; i < b; i++) {
      if (this.rows.has(i)) continue;
      const r = el('div', 'vrow');
      r.style.top = i * this.rowH + 'px';
      r.style.height = this.rowH + 'px';
      this.render(this.items[i], r, i);
      this.inner.append(r);
      this.rows.set(i, r);
    }
  }
}

/* ---------- color ---------- */
function hex2(n) { return n.toString(16).padStart(2, '0'); }
function rgbaToHex(c, withAlpha = true) {
  return (hex2(c[0]) + hex2(c[1]) + hex2(c[2]) + (withAlpha && c[3] !== 255 ? hex2(c[3]) : '')).toUpperCase();
}
function hexToRgba(h) {
  h = h.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255];
}
function cssColor(c) { return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`; }
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/* ---------- Minecraft § codes ---------- */
const MC_COLORS = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA', '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF', 'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
};
const MC_COLOR_NAMES = { '0': '검정', '1': '진한 파랑', '2': '진한 초록', '3': '청록', '4': '진한 빨강', '5': '보라', '6': '금색', '7': '회색', '8': '진한 회색', '9': '파랑', 'a': '초록', 'b': '하늘', 'c': '빨강', 'd': '분홍', 'e': '노랑', 'f': '흰색' };
/* opts.shadow: 게임처럼 글자 그림자 (글자색의 1/4 밝기, 오른쪽 아래로 한 칸) */
/* § 코드를 [{t: 글자, c: 색, b,i,u,s,k: 서식}] 조각으로 */
function mcRuns(text, baseColor) {
  const base = () => ({ c: baseColor || null, b: false, i: false, u: false, s: false, k: false });
  let style = base();
  const out = [];
  const parts = String(text).split('§');
  const push = (t) => { if (t) out.push({ ...style, t }); };
  push(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    const code = parts[i][0] ? parts[i][0].toLowerCase() : '';
    // 게임과 같이: 색 코드는 서식(굵게·흔들림 등)까지 모두 초기화
    if (MC_COLORS[code]) style = { ...base(), c: MC_COLORS[code] };
    else if (code === 'l') style.b = true; else if (code === 'o') style.i = true;
    else if (code === 'n') style.u = true; else if (code === 'm') style.s = true;
    else if (code === 'k') style.k = true;
    else if (code === 'r') style = base();
    push(parts[i].slice(1));
  }
  return out;
}
function mcFormat(text, baseColor, opts = {}) {
  let out = '', style;
  const span = (t) => {
    if (!t) return '';
    const css = [];
    if (style.c) css.push('color:' + style.c);
    if (opts.shadow) css.push('text-shadow:' + (opts.shadowPx || 2) + 'px ' + (opts.shadowPx || 2) + 'px 0 ' + mcShadow(style.c || '#FFFFFF'));
    if (style.b) css.push('font-weight:700');
    if (style.i) css.push('font-style:italic');
    const deco = [style.u && 'underline', style.s && 'line-through'].filter(Boolean).join(' ');
    if (deco) css.push('text-decoration:' + deco);
    if (style.k) return `<span class="mc-obf" data-t="${esc(t)}" style="${css.join(';')}">${esc(mcObfText(t))}</span>`;
    return `<span style="${css.join(';')}">${esc(t)}</span>`;
  };
  for (const r of mcRuns(text, baseColor)) { style = r; out += span(r.t); }
  return out;
}
function mcShadow(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = (v) => Math.floor(v / 4).toString(16).padStart(2, '0');
  return '#' + ch(n >> 16 & 255) + ch(n >> 8 & 255) + ch(n & 255);
}
/* §k 흔들림 (HTML 미리보기용): 글꼴을 불러왔으면 게임처럼 폭이 같은 아무 글자(영어·한글·기호 섞임)로 */
const MC_OBF_POOL = '!#$%&*+-0123456789<=>?@ABCDEFGHJKLMNOPQRSTUVWXYZabcdeghjmnopqrsuvwxyz가뷁쀍ㅹ§¶ΩЖ※';
function mcObfText(t) {
  let s = '';
  for (const ch of t) {
    if (ch === ' ') { s += ' '; continue; }
    if (typeof McFont !== 'undefined' && McFont.ready) {
      const g = McFont.glyph(ch.codePointAt(0)), a = McFont.byWidth.get(Math.ceil(g.adv));
      if (a && a.length) { s += String.fromCodePoint(a[Math.floor(Math.random() * a.length)]); continue; }
    }
    s += Array.from(MC_OBF_POOL)[Math.floor(Math.random() * Array.from(MC_OBF_POOL).length)];
  }
  return s;
}
setInterval(() => {
  for (const e of document.getElementsByClassName('mc-obf')) if (e.offsetParent) e.textContent = mcObfText(e.dataset.t);
}, 60);

/* ---------- image helpers ---------- */
async function bytesToImageData(bytes) {
  const blob = new Blob([bytes], { type: 'image/png' });
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  bmp.close();
  return d;
}
function canvasToPngBytes(canvas) {
  return new Promise((res, rej) => canvas.toBlob(async b => {
    if (!b) return rej(new Error('PNG 변환 실패'));
    res(new Uint8Array(await b.arrayBuffer()));
  }, 'image/png'));
}
function imageDataToCanvas(id) {
  const c = document.createElement('canvas');
  c.width = id.width; c.height = id.height;
  c.getContext('2d').putImageData(id, 0, 0);
  return c;
}
const textDecoder = new TextDecoder('utf-8');
function bytesToText(b) { return b ? textDecoder.decode(b) : ''; }
