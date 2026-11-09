'use strict';
/* Texel 웹 버전: 데스크톱(Electron)의 main.js + preload.js 가 하던 일을 브라우저 안에서 대신한다.
   - 마인크래프트 원본 파일: Mojang 서버에서 받아 Cache Storage 에 보관
   - 프로젝트: 브라우저 저장소(OPFS) 또는 사용자가 고른 내 컴퓨터 폴더(File System Access API)
   - 설정·최근 목록: localStorage, 폴더 권한 핸들: IndexedDB
   - mc 파일 주소(/mc/...): sw.js 가 가로채서 이 페이지에 물어본다 */
(() => {
  if (window.api) return; // 데스크톱 앱에서는 아무것도 하지 않음

  const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
  const RES_URL = '/mcres/'; // vercel.json 이 resources.download.minecraft.net 으로 넘겨줌 (그쪽은 CORS 없음)
  const PROJECT_META = '.rpstudio.json';
  const EDITOR_DIR = '.texel';
  const CACHE = 'texel-mc-v1';
  const BROWSER_LABEL = '브라우저 저장소 (이 브라우저 안)';
  const CONFIG_KEY = 'texel-config';

  // ------------------------------------------------------------ 진행 표시
  const progressFns = [];
  const progress = (text, ratio) => { for (const f of progressFns) try { f({ text, ratio }); } catch { /* ignore */ } };

  // ------------------------------------------------------------ IndexedDB (폴더 핸들 보관)
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('texel', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function kv(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  const kvGet = k => kv('readonly', s => s.get(k));
  const kvSet = (k, v) => kv('readwrite', s => s.put(v, k));
  const kvDel = k => kv('readwrite', s => s.delete(k));

  // ------------------------------------------------------------ 설정
  function loadConfig() {
    try { const c = JSON.parse(localStorage.getItem(CONFIG_KEY)); if (c && typeof c === 'object') return c; } catch { /* none */ }
    return { recent: [] };
  }
  function saveConfig(c) { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); }
  function addRecent(dir, name, label) {
    const c = loadConfig();
    c.recent = [{ dir, name, label, time: Date.now() }, ...(c.recent || []).filter(r => r.dir !== dir)].slice(0, 12);
    saveConfig(c);
  }

  // ------------------------------------------------------------ 내려받기 + 캐시
  async function cacheOpen() { try { return await caches.open(CACHE); } catch { return null; } }
  async function cacheGet(key) {
    const c = await cacheOpen();
    const r = c && await c.match(key);
    return r ? new Uint8Array(await r.arrayBuffer()) : null;
  }
  async function cachePut(key, bytes) {
    const c = await cacheOpen();
    if (c) try { await c.put(key, new Response(bytes)); } catch { /* 저장 공간 부족 등: 무시 */ }
  }
  async function download(url, label) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`다운로드 실패 (HTTP ${r.status})`);
    const total = Number(r.headers.get('content-length')) || 0;
    if (!r.body || !label) return new Uint8Array(await r.arrayBuffer());
    const chunks = [];
    let got = 0, last = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (Date.now() - last > 100) {
        last = Date.now();
        progress(`${label} (${(got / 1048576).toFixed(1)}MB${total ? ' / ' + (total / 1048576).toFixed(1) + 'MB' : ''})`, total ? got / total : -1);
      }
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  // 캐시에 있으면 그것, 없으면 받아서 캐시에 넣기
  async function cached(key, url, label) {
    const hit = await cacheGet(key);
    if (hit) return hit;
    const b = await download(url, label);
    await cachePut(key, b);
    return b;
  }
  const dec = new TextDecoder();
  const json = b => JSON.parse(dec.decode(b));

  // ------------------------------------------------------------ 버전
  let manifestCache = null;
  const versions = new Map();
  const fileCache = new Map();

  async function getManifest() {
    if (manifestCache) return manifestCache;
    try {
      const b = await download(MANIFEST_URL);
      manifestCache = json(b);
      await cachePut('/__mc/manifest', b);
    } catch {
      const b = await cacheGet('/__mc/manifest');
      if (b) manifestCache = json(b);
    }
    return manifestCache || { versions: [] };
  }
  async function listVersions() {
    const cachedJars = new Set();
    const c = await cacheOpen();
    if (c) for (const k of await c.keys()) {
      const m = /\/__mc\/jar\/(.+)$/.exec(new URL(k.url).pathname);
      if (m) cachedJars.add(decodeURIComponent(m[1]));
    }
    const m = await getManifest();
    const remote = (m.versions || []).map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, cached: cachedJars.has(v.id) }));
    return { local: [], remote, latest: m.latest || {}, mcDir: '' };
  }
  async function getVersionJson(id) {
    const key = '/__mc/vj/' + encodeURIComponent(id);
    const hit = await cacheGet(key);
    if (hit) return json(hit);
    const m = await getManifest();
    const entry = (m.versions || []).find(v => v.id === id);
    if (!entry) throw new Error(`버전 정보를 찾을 수 없습니다: ${id}`);
    const b = await download(entry.url);
    await cachePut(key, b);
    return json(b);
  }
  function fallbackPackFormat(id) {
    const m = /^1\.(\d+)/.exec(id);
    if (!m) return 3;
    const n = +m[1];
    if (n <= 8) return 1; if (n <= 10) return 2; if (n <= 12) return 3; if (n <= 14) return 4;
    if (n === 15) return 5; if (n === 16) return 6; if (n === 17) return 7; if (n === 18) return 8;
    return 9;
  }
  async function loadVersion(id) {
    if (!versions.has(id)) {
      progress(`${id} 버전 정보 확인 중…`, -1);
      const vj = await getVersionJson(id);
      const url = vj.downloads && vj.downloads.client && vj.downloads.client.url;
      if (!url) throw new Error('이 버전은 클라이언트 다운로드 정보가 없습니다.');
      const buf = await cached('/__mc/jar/' + encodeURIComponent(id), url, `${id} 다운로드 중`);
      progress(`${id} 텍스처 읽는 중…`, -1);
      const zip = await JSZip.loadAsync(buf);
      let packFormat = { major: fallbackPackFormat(id), minor: 0 };
      const vf = zip.file('version.json');
      if (vf) {
        try {
          const v = JSON.parse(await vf.async('string'));
          const pv = v.pack_version;
          if (typeof pv === 'number') packFormat = { major: pv, minor: 0 };
          else if (pv && pv.resource_major != null) packFormat = { major: pv.resource_major, minor: pv.resource_minor || 0 };
          else if (pv && pv.resource != null) packFormat = { major: pv.resource, minor: 0 };
        } catch { /* keep fallback */ }
      }
      versions.clear();
      fileCache.clear();
      versions.set(id, { zip, vj, assetIndex: null, packFormat });
    }
    const v = versions.get(id);
    const files = Object.keys(v.zip.files).filter(n => n.startsWith('assets/') && !v.zip.files[n].dir);
    progress('', 1);
    return { id, packFormat: v.packFormat, files, type: v.vj.type };
  }
  async function readJarFile(vid, p) {
    const key = vid + '|' + p;
    if (fileCache.has(key)) return fileCache.get(key);
    const v = versions.get(vid);
    if (!v) throw new Error('버전이 로드되지 않았습니다');
    const f = v.zip.file(p);
    if (!f) return null;
    const b = await f.async('uint8array');
    if (fileCache.size > 3000) fileCache.clear();
    fileCache.set(key, b);
    return b;
  }
  async function getAssetIndex(vid) {
    const v = versions.get(vid);
    if (!v) throw new Error('버전이 로드되지 않았습니다');
    if (v.assetIndex) return v.assetIndex;
    const ai = v.vj.assetIndex;
    if (!ai) throw new Error('에셋 인덱스 정보가 없습니다');
    const key = '/__mc/idx/' + encodeURIComponent(ai.id);
    let b = await cacheGet(key);
    if (!b) {
      progress('에셋 목록 다운로드 중…', -1);
      b = await download(ai.url);
      await cachePut(key, b);
      progress('', 1);
    }
    v.assetIndex = json(b).objects || {};
    return v.assetIndex;
  }
  async function readObject(vid, name) {
    const idx = await getAssetIndex(vid);
    const o = idx[name];
    if (!o) return null;
    const sub = o.hash.slice(0, 2);
    return cached('/__mc/obj/' + o.hash, RES_URL + sub + '/' + o.hash);
  }

  // ------------------------------------------------------------ 폴더(디렉터리 핸들) 다루기
  function relParts(rel) {
    const parts = String(rel).replace(/\\/g, '/').split('/').filter(p => p && p !== '.');
    if (!parts.length || parts.some(p => p === '..')) throw new Error('잘못된 경로: ' + rel);
    return parts;
  }
  async function subDir(root, parts, create) {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  async function walk(dir, prefix = '', out = []) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') await walk(h, prefix + name + '/', out);
      else out.push(prefix + name);
    }
    return out;
  }
  async function readRel(root, rel) {
    try {
      const parts = relParts(rel);
      const d = await subDir(root, parts.slice(0, -1), false);
      const f = await (await d.getFileHandle(parts[parts.length - 1])).getFile();
      return new Uint8Array(await f.arrayBuffer());
    } catch { return null; }
  }
  async function writeRel(root, rel, data) {
    const parts = relParts(rel);
    const d = await subDir(root, parts.slice(0, -1), true);
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(typeof data === 'string' ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    await w.close();
  }
  async function removeRel(root, rel) {
    const parts = relParts(rel);
    const chain = [root];
    try {
      for (const p of parts.slice(0, -1)) chain.push(await chain[chain.length - 1].getDirectoryHandle(p));
      await chain[chain.length - 1].removeEntry(parts[parts.length - 1]);
    } catch { return; }
    // 빈 폴더 정리
    for (let i = chain.length - 1; i > 0; i--) {
      const it = chain[i].entries();
      if (!(await it.next()).done) break;
      try { await chain[i - 1].removeEntry(parts[i - 1]); } catch { break; }
    }
  }
  async function exists(root, rel) {
    try {
      const parts = relParts(rel);
      const d = await subDir(root, parts.slice(0, -1), false);
      await d.getFileHandle(parts[parts.length - 1]);
      return true;
    } catch { return false; }
  }
  function sanitizeName(n) { return String(n).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'MyPack'; }

  // ------------------------------------------------------------ 프로젝트
  // dir 형식: 'browser:<폴더 이름>' (브라우저 저장소) 또는 'folder:<id>' (내 컴퓨터 폴더, 핸들은 IndexedDB)
  let cur = null; // { dir, root }
  let pickedParent = null; // { label, handle }

  async function browserRoot(create = true) {
    if (!navigator.storage || !navigator.storage.getDirectory) throw new Error('이 브라우저는 파일 저장을 지원하지 않아요. 최신 Chrome이나 Edge를 써 주세요.');
    return (await navigator.storage.getDirectory()).getDirectoryHandle('projects', { create });
  }
  async function ensurePermission(h) {
    const opts = { mode: 'readwrite' };
    if (h.queryPermission && (await h.queryPermission(opts)) === 'granted') return;
    if (h.requestPermission && (await h.requestPermission(opts)) === 'granted') return;
    throw new Error(`"${h.name}" 폴더에 접근할 권한이 없어요. 다시 열어서 허용해 주세요.`);
  }
  async function resolveDir(dir) {
    if (dir.startsWith('browser:')) {
      try { return await (await browserRoot(false)).getDirectoryHandle(dir.slice(8)); }
      catch { throw new Error('브라우저 저장소에서 이 프로젝트를 찾을 수 없어요 (사이트 데이터가 지워졌을 수 있어요).'); }
    }
    if (dir.startsWith('folder:')) {
      const h = await kvGet('h:' + dir);
      if (!h) throw new Error('이 폴더 정보를 찾을 수 없어요. "폴더 열기"로 다시 열어 주세요.');
      await ensurePermission(h);
      return h;
    }
    throw new Error('이 프로젝트는 데스크톱 앱에서 만든 것이라 웹에서는 열 수 없어요.');
  }
  function labelOf(dir, root) {
    return dir.startsWith('folder:') ? `📁 ${root.name} (내 컴퓨터 폴더)` : BROWSER_LABEL;
  }
  async function rememberFolder(h) {
    // 이미 등록한 같은 폴더면 그 id 를 다시 씀
    for (const r of loadConfig().recent || []) {
      if (!r.dir.startsWith('folder:')) continue;
      const old = await kvGet('h:' + r.dir).catch(() => null);
      if (old && old.isSameEntry && await old.isSameEntry(h)) { await kvSet('h:' + r.dir, h); return r.dir; }
    }
    const dir = 'folder:' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    await kvSet('h:' + dir, h);
    return dir;
  }
  async function openRoot(dir, root) {
    let meta = null;
    try { meta = json(await readRel(root, PROJECT_META)); } catch { /* not a studio project */ }
    if (!meta) {
      const pm = await readRel(root, 'pack.mcmeta');
      if (!pm) throw new Error('리소스팩 폴더가 아닙니다 (pack.mcmeta 없음)');
      let desc = null;
      try { const j = json(pm); desc = typeof j.pack.description === 'string' ? j.pack.description : null; } catch { /* ignore */ }
      meta = { name: root.name, description: desc, version: null };
    }
    cur = { dir, root };
    const files = (await walk(root)).filter(f => f !== PROJECT_META && !f.startsWith(EDITOR_DIR + '/'));
    addRecent(dir, meta.name, labelOf(dir, root));
    return { dir, meta, files };
  }
  function need() { if (!cur) throw new Error('열린 프로젝트가 없습니다'); return cur.root; }

  function buildMcmeta(description, pf) {
    const pack = { description: description || '' };
    pack.pack_format = pf.major;
    if (pf.major >= 65) { pack.min_format = pf.major; pack.max_format = pf.major; }
    return { pack };
  }
  async function zipProject() {
    const root = need();
    const zip = new JSZip();
    for (const f of await walk(root)) {
      if (f === PROJECT_META || f.startsWith(EDITOR_DIR + '/')) continue;
      zip.file(f, await readRel(root, f));
    }
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  function pickFile(exts) {
    return new Promise(res => {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (exts && exts.length) inp.accept = exts.map(e => '.' + e).join(',');
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        res(f ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null);
      };
      inp.addEventListener('cancel', () => res(null));
      inp.click();
    });
  }
  async function dirPicker() {
    if (!window.showDirectoryPicker) throw new Error('이 브라우저는 내 컴퓨터 폴더를 직접 열 수 없어요. Chrome이나 Edge에서는 돼요. 대신 .zip 가져오기를 써 주세요.');
    try { return await window.showDirectoryPicker({ id: 'texel', mode: 'readwrite' }); }
    catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
  }

  async function createProject({ parent, name, description, version, packFormat }) {
    const folder = sanitizeName(name);
    let dir, root;
    if (pickedParent && parent === pickedParent.label) {
      await ensurePermission(pickedParent.handle);
      root = await pickedParent.handle.getDirectoryHandle(folder, { create: true });
      if (await exists(root, 'pack.mcmeta')) throw new Error(`"${pickedParent.handle.name}" 안에 이미 같은 이름의 리소스팩 폴더가 있습니다: ${folder}`);
      dir = await rememberFolder(root);
    } else {
      const base = await browserRoot();
      root = await base.getDirectoryHandle(folder, { create: true });
      if (await exists(root, 'pack.mcmeta')) throw new Error('브라우저 저장소에 이미 같은 이름의 리소스팩이 있습니다: ' + folder);
      dir = 'browser:' + folder;
      if (navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }
    const meta = { name, description, version, created: Date.now() };
    await writeRel(root, PROJECT_META, JSON.stringify(meta, null, 2));
    await writeRel(root, 'pack.mcmeta', JSON.stringify(buildMcmeta(description, packFormat), null, 2));
    return openRoot(dir, root);
  }

  async function importZip() {
    const f = await pickFile(['zip']);
    if (!f) return null;
    const zip = await JSZip.loadAsync(f.data);
    const names = Object.keys(zip.files);
    const mc = names.filter(n => /(^|\/)pack\.mcmeta$/.test(n)).sort((a, b) => a.length - b.length)[0];
    if (mc == null) throw new Error('zip 안에 pack.mcmeta가 없습니다');
    const prefix = mc.slice(0, mc.length - 'pack.mcmeta'.length);
    const base = await browserRoot();
    const stem = sanitizeName(f.name.replace(/\.zip$/i, ''));
    let folder = stem;
    for (let i = 2; ; i++) {
      let taken = false;
      try { await base.getDirectoryHandle(folder); taken = true; } catch { /* free */ }
      if (!taken) break;
      folder = `${stem} (${i})`;
    }
    const root = await base.getDirectoryHandle(folder, { create: true });
    for (const n of names) {
      const e = zip.files[n];
      if (e.dir || !n.startsWith(prefix) || n.length === prefix.length) continue;
      await writeRel(root, n.slice(prefix.length), await e.async('uint8array'));
    }
    if (navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return openRoot('browser:' + folder, root);
  }

  // ------------------------------------------------------------ 서비스 워커 (mc 파일 주소)
  const MIME = { png: 'image/png', ogg: 'audio/ogg', json: 'application/json', mcmeta: 'application/json', txt: 'text/plain', lang: 'text/plain' };
  async function serveMc(kind, parts) {
    if (kind === 'jar') return readJarFile(parts.shift(), parts.join('/'));
    if (kind === 'obj') return readObject(parts.shift(), parts.join('/'));
    if (kind === 'proj' && cur) return readRel(cur.root, parts.join('/'));
    return null;
  }
  async function onSwMessage(e) {
    const m = e.data, port = e.ports && e.ports[0];
    if (!m || m.type !== 'mc' || !port) return;
    try {
      const b = await serveMc(m.kind, m.parts.slice());
      if (!b) { port.postMessage({ ok: false }); return; }
      const copy = b.slice(); // 캐시에 있는 원본은 넘겨주지 않음
      const ext = (m.parts[m.parts.length - 1] || '').split('.').pop().toLowerCase();
      port.postMessage({ ok: true, data: copy.buffer, type: MIME[ext] || 'application/octet-stream' }, [copy.buffer]);
    } catch (err) {
      port.postMessage({ ok: false, error: String(err && err.message || err) });
    }
  }
  async function setupWorker() {
    const sw = navigator.serviceWorker;
    if (!sw) throw new Error('이 브라우저(또는 비공개 창)에서는 Texel 웹 버전을 쓸 수 없어요. 일반 창의 Chrome이나 Edge로 열어 주세요.');
    sw.onmessage = onSwMessage;
    const reg = await sw.register('sw.js', { scope: './' });
    await sw.ready;
    if (sw.controller) return;
    // 처음 방문했거나 강력 새로고침한 경우: 워커가 이 페이지를 맡을 때까지 기다림
    await new Promise(res => {
      const t = setTimeout(res, 3000);
      sw.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
      if (reg.active) reg.active.postMessage('claim');
    });
    if (!sw.controller) {
      if (!sessionStorage.getItem('texel-sw-reload')) { sessionStorage.setItem('texel-sw-reload', '1'); location.reload(); await new Promise(() => {}); }
      throw new Error('그림 파일을 불러오는 준비가 안 됐어요. 페이지를 새로고침해 주세요.');
    }
    sessionStorage.removeItem('texel-sw-reload');
  }

  // ------------------------------------------------------------ api
  window.api = {
    isWeb: true,
    mcBase: new URL('mc/', location.href).pathname,
    ready: setupWorker(),
    listVersions,
    loadVersion,
    readJar: (vid, p) => readJarFile(vid, p),
    listAssets: async (vid, prefix) => {
      const idx = await getAssetIndex(vid);
      return Object.keys(idx).filter(k => k.startsWith(prefix)).map(k => ({ name: k, size: idx[k].size }));
    },
    readAsset: (vid, name) => readObject(vid, name),
    zipHexText: async (bytes) => {
      const z = await JSZip.loadAsync(bytes);
      const parts = [];
      for (const n of Object.keys(z.files)) if (n.endsWith('.hex')) parts.push(await z.file(n).async('string'));
      return parts.join('\n');
    },
    createProject,
    openProject: async () => {
      const h = await dirPicker();
      if (!h) return null;
      return openRoot(await rememberFolder(h), h);
    },
    openProjectPath: async (dir) => openRoot(dir, await resolveDir(dir)),
    importZip,
    saveMeta: async (meta, packFormat) => {
      const root = need();
      await writeRel(root, PROJECT_META, JSON.stringify(meta, null, 2));
      let mcmeta = {};
      try { mcmeta = json(await readRel(root, 'pack.mcmeta')); } catch { /* new */ }
      const fresh = buildMcmeta(meta.description, packFormat);
      if (typeof meta.description !== 'string') delete fresh.pack.description;
      mcmeta.pack = Object.assign({}, mcmeta.pack || {}, fresh.pack);
      if (packFormat.major < 65) { delete mcmeta.pack.min_format; delete mcmeta.pack.max_format; }
      await writeRel(root, 'pack.mcmeta', JSON.stringify(mcmeta, null, 2));
      addRecent(cur.dir, meta.name, labelOf(cur.dir, root));
      return true;
    },
    writeFile: async (rel, data) => { await writeRel(need(), rel, data); return true; },
    readFile: async (rel) => readRel(need(), rel),
    removeFile: async (rel) => { await removeRel(need(), rel); return true; },
    exportZip: async (name) => {
      progress('압축 중…', -1);
      try {
        const file = sanitizeName(name) + '.zip';
        downloadBlob(await zipProject(), file);
        return file + ' (다운로드 폴더)';
      } finally { progress('', 1); }
    },
    install: async (name) => {
      progress('압축 중…', -1);
      try {
        const file = sanitizeName(name) + '.zip';
        downloadBlob(await zipProject(), file);
        return file;
      } finally { progress('', 1); }
    },
    reveal: async () => true,
    pickFolder: async () => {
      const h = await dirPicker();
      if (!h) return null;
      pickedParent = { label: `📁 ${h.name} (내 컴퓨터 폴더)`, handle: h };
      return pickedParent.label;
    },
    pickFile: async (_title, exts) => pickFile(exts),
    saveFile: async (_title, defName, data) => { downloadBlob(new Blob([data]), defName); return defName; },
    getConfig: async () => {
      // 브라우저 저장소에 있는데 최근 목록에서 빠진 프로젝트도 보여 줌 (안 그러면 찾을 길이 없음)
      const c = loadConfig();
      c.recent = c.recent || [];
      try {
        const base = await browserRoot(false);
        for await (const [name, h] of base.entries()) {
          const dir = 'browser:' + name;
          if (h.kind !== 'directory' || c.recent.some(r => r.dir === dir)) continue;
          let pname = name;
          try { pname = json(await readRel(h, PROJECT_META)).name || name; } catch { /* folder name */ }
          c.recent.push({ dir, name: pname, label: BROWSER_LABEL, time: 0 });
        }
      } catch { /* 아직 없음 */ }
      return c;
    },
    removeRecent: async (dir) => {
      if (dir.startsWith('browser:')) {
        // 브라우저 저장소 프로젝트는 목록에서만 빼면 찾을 수 없게 되므로, 지울지 묻는다
        if (!confirm('이 프로젝트를 브라우저 저장소에서 완전히 지울까요?\n되돌릴 수 없어요. 필요하면 먼저 열어서 .zip으로 내보내 두세요.')) return loadConfig();
        if (cur && cur.dir === dir) throw new Error('지금 열려 있는 프로젝트는 지울 수 없어요.');
        await (await browserRoot(false)).removeEntry(dir.slice(8), { recursive: true }).catch(() => {});
      }
      const c = loadConfig();
      c.recent = (c.recent || []).filter(r => r.dir !== dir);
      saveConfig(c);
      if (dir.startsWith('folder:')) kvDel('h:' + dir).catch(() => {});
      return c;
    },
    setSetting: async (key, value) => { const c = loadConfig(); c.settings = { ...(c.settings || {}), [key]: value }; saveConfig(c); return c.settings; },
    defaultProjectsDir: async () => BROWSER_LABEL,
    quit: () => {},
    onProgress: (fn) => { progressFns.push(fn); },
    onCloseRequest: () => {}
  };
})();
