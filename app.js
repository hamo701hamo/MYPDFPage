'use strict';

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

// Streamlit 등에 한 파일로 넣어 실행할 때는 worker 주소(Blob URL)를 window.PDF_WORKER_SRC로 넘겨받는다
pdfjsLib.GlobalWorkerOptions.workerSrc = window.PDF_WORKER_SRC || 'lib/pdf.worker.min.js';

const MAIN_COLOR = '#4F86F7';
const ATTACH_COLORS = ['#F2994A', '#27AE60', '#EB5757', '#9B51E0', '#2D9CDB', '#F2C94C', '#6FCF97'];
const THUMB_WIDTH = 300;        // 메인 썸네일 렌더링 폭(px)
const ATTACH_THUMB_WIDTH = 180; // 첨부 썸네일 렌더링 폭(px)
const HISTORY_LIMIT = 50;       // 실행 취소 최대 단계
const SAVE_DELAY = 300;         // 자동 저장 지연(ms)

// ---------------------------------------------------------------------------
// 상태 (PRD 5.3 데이터 모델 + 메인/첨부 구분)
// ---------------------------------------------------------------------------

const state = {
  files: new Map(),   // fileId -> { id, name, pageCount, color, data: ArrayBuffer }
  mainFileId: null,   // 메인 PDF
  attachmentIds: [],  // 첨부 패널에 보이는 PDF (추가 순서)
  pages: [],          // 메인 작업 영역: [{ uid, fileId, pageIndex, rotation }] — 배열 순서 = 배치 순서
};

// 화면 전용 상태 (저장하지 않음)
const selection = new Set();     // 첨부 패널에서 선택한 페이지 키 ("fileId:pageIndex")
const mainSelection = new Set(); // 메인 작업 영역에서 선택한 페이지 uid
let selectionAnchor = null;      // Shift+클릭 범위 선택의 기준 uid
const undoHistory = { undo: [], redo: [] }; // pages 배열 스냅샷

const pdfDocCache = new Map(); // fileId -> Promise<PDFDocumentProxy>
const thumbCache = new Map();  // 캐시 키 -> 렌더링된 canvas (다시 그릴 때 재사용)
let attachColorIndex = 0;
let attachSortables = [];
let activeEdit = null;         // 열려 있는 번호 입력칸 { finish }
let restoring = true;          // 저장된 작업을 불러오는 중에는 자동 저장하지 않음

const collapsedAttach = new Set(); // 접어 둔 첨부 파일 id (저장하지 않음)

const $ = (id) => document.getElementById(id);
const el = {
  banner: $('storage-banner'),
  bannerText: $('storage-banner-text'),
  btnUndo: $('btn-undo'),
  btnRedo: $('btn-redo'),
  btnReset: $('btn-reset'),
  btnSave: $('btn-save'),
  btnSaveLabel: $('btn-save-label'),
  workspace: $('workspace'),
  mainInfo: $('main-info'),
  selectionTools: $('selection-tools'),
  btnSelPrev: $('btn-sel-prev'),
  btnSelNext: $('btn-sel-next'),
  btnSelRotate: $('btn-sel-rotate'),
  btnDeleteSelected: $('btn-delete-selected'),
  deleteSelectedLabel: $('delete-selected-label'),
  btnMain: $('btn-main'),
  btnMainLabel: $('btn-main-label'),
  mainInput: $('main-input'),
  loading: $('loading'),
  empty: $('empty'),
  grid: $('grid'),
  attach: $('attach'),
  btnAttach: $('btn-attach'),
  attachInput: $('attach-input'),
  attachEmpty: $('attach-empty'),
  attachList: $('attach-list'),
  attachSelected: $('attach-selected'),
  btnExtract: $('btn-extract'),
  viewer: $('viewer'),
  viewerTitle: $('viewer-title'),
  viewerStage: $('viewer-stage'),
  viewerCanvas: $('viewer-canvas'),
  viewerPrev: $('viewer-prev'),
  viewerNext: $('viewer-next'),
  viewerClose: $('viewer-close'),
  confirm: $('confirm'),
  confirmTitle: $('confirm-title'),
  confirmMessage: $('confirm-message'),
  confirmOk: $('confirm-ok'),
  confirmCancel: $('confirm-cancel'),
  toasts: $('toasts'),
};

// ---------------------------------------------------------------------------
// 아이콘 (인라인 SVG, 24x24 선 아이콘)
// ---------------------------------------------------------------------------

const ICONS = {
  'file': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  'file-plus': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 12v6"/>',
  'files': '<path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"/><path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"/>',
  'undo': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  'redo': '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  'reset': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'trash': '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'alert': '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

document.querySelectorAll('[data-icon]').forEach((node) => {
  node.outerHTML = icon(node.dataset.icon);
});

// ---------------------------------------------------------------------------
// 토스트 알림 / 확인 대화상자 (alert, confirm 대신)
// ---------------------------------------------------------------------------

// type: 'info' | 'success' | 'error'
function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  if (type === 'error') item.setAttribute('role', 'alert');
  item.innerHTML = icon({ success: 'check', error: 'alert' }[type] || 'info');
  const text = document.createElement('span');
  text.textContent = message;
  item.append(text);
  el.toasts.append(item);

  const close = () => {
    item.classList.add('leaving');
    setTimeout(() => item.remove(), 200);
  };
  item.addEventListener('click', close);
  setTimeout(close, type === 'error' ? 7000 : 3500);
}

// 확인 → true, 취소/Esc/바깥 클릭 → false
function confirmDialog({ title, message, okLabel = '확인', danger = false }) {
  el.confirmTitle.textContent = title;
  el.confirmMessage.textContent = message;
  el.confirmOk.textContent = okLabel;
  el.confirmOk.className = danger ? 'danger-solid' : 'primary';
  el.confirm.returnValue = '';
  el.confirm.showModal();
  el.confirmCancel.focus(); // 실수로 Enter를 눌러도 지워지지 않도록 취소에 포커스
  return new Promise((resolve) => {
    el.confirm.addEventListener('close', () => resolve(el.confirm.returnValue === 'ok'), { once: true });
  });
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const selKey = (fileId, pageIndex) => `${fileId}:${pageIndex}`;

// ---------------------------------------------------------------------------
// 브라우저 저장소 (IndexedDB) — 새로고침해도 작업 유지 (PRD 5.4)
//   store "files": 원본 PDF, store "meta": 작업 상태
// ---------------------------------------------------------------------------

const DB_NAME = 'pdf-page-editor';
let db = null; // 쓸 수 없는 환경이면 null
let saveTimer = null;
let storageWarned = false;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('files', { keyPath: 'id' });
      req.result.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbReady = (async () => {
  try {
    if (!window.indexedDB) throw new Error('IndexedDB 없음');
    db = await openDb();
  } catch (err) {
    console.warn('IndexedDB를 사용할 수 없습니다', err);
    showBanner('이 환경(시크릿 모드 등)에서는 브라우저 저장소를 쓸 수 없어, 새로고침하면 작업 내용이 사라집니다.');
  }
})();

// store에 대해 fn(objectStore)을 실행하고, 트랜잭션이 끝나면 fn이 돌려준 요청의 결과를 반환
async function dbRun(storeName, mode, fn) {
  await dbReady;
  if (!db) return undefined;
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    handleStorageError(err);
    return undefined;
  }
}

function handleStorageError(err) {
  console.error('브라우저 저장 실패', err);
  if (storageWarned) return;
  storageWarned = true;
  const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
  const msg = quota
    ? '브라우저 저장 공간이 부족해 작업 내용을 저장하지 못했습니다. 편집은 계속할 수 있지만, 새로고침하면 일부 작업이 사라질 수 있습니다. 사용하지 않는 첨부 PDF를 제거해 보세요.'
    : '작업 내용을 브라우저에 저장하지 못했습니다. 새로고침하면 일부 작업이 사라질 수 있습니다.';
  showBanner(msg);
  toast(msg, 'error');
}

function showBanner(message) {
  el.bannerText.textContent = message;
  el.banner.hidden = false;
}

// IndexedDB는 값을 복사해서 저장하므로 원본 ArrayBuffer가 비워지지(detach) 않는다
const dbPutFile = (file) => dbRun('files', 'readwrite', (s) => s.put(file));
const dbDeleteFile = (id) => dbRun('files', 'readwrite', (s) => s.delete(id));

// 작업 상태(작은 JSON)는 localStorage에도 바로 써 둔다. IndexedDB 저장은 비동기라
// 편집 직후 새로고침하면 끝나기 전에 페이지가 닫혀 상태를 잃을 수 있기 때문 (원본 PDF는 IndexedDB에만 저장)
const LOCAL_META_KEY = 'pdf-page-editor:state';

function currentMeta() {
  return {
    mainFileId: state.mainFileId,
    attachmentIds: state.attachmentIds,
    pages: state.pages,
    attachColorIndex,
    updatedAt: Date.now(),
  };
}

function saveLocalMeta(meta) {
  try {
    localStorage.setItem(LOCAL_META_KEY, JSON.stringify(meta));
  } catch (err) {
    console.warn('localStorage 저장 실패', err); // IndexedDB 저장은 계속 시도
  }
}

function loadLocalMeta() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_META_KEY));
  } catch (err) {
    return null;
  }
}

function scheduleSave() {
  if (restoring) return;
  saveLocalMeta(currentMeta());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, SAVE_DELAY);
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const meta = currentMeta();
  saveLocalMeta(meta);
  return dbRun('meta', 'readwrite', (s) => s.put(meta, 'state'));
}

async function loadState() {
  const dbMeta = await dbRun('meta', 'readonly', (s) => s.get('state'));
  const localMeta = loadLocalMeta();
  // 둘 중 더 최근에 저장된 상태를 쓴다
  const meta = localMeta && (!dbMeta || (localMeta.updatedAt || 0) >= (dbMeta.updatedAt || 0)) ? localMeta : dbMeta;
  const files = (await dbRun('files', 'readonly', (s) => s.getAll())) || [];
  if (!meta) {
    files.forEach((f) => dbDeleteFile(f.id)); // 상태 없이 남은 파일 정리
    return;
  }
  files.forEach((f) => state.files.set(f.id, f));
  state.mainFileId = state.files.has(meta.mainFileId) ? meta.mainFileId : null;
  state.attachmentIds = (meta.attachmentIds || []).filter((id) => state.files.has(id));
  state.pages = (meta.pages || []).filter((p) => state.files.has(p.fileId));
  attachColorIndex = meta.attachColorIndex || 0;

  const lostPages = (meta.pages || []).length - state.pages.length;
  if (lostPages > 0) toast(`저장된 원본 파일 일부를 찾지 못해 ${lostPages}개 페이지를 복원하지 못했습니다.`);
  pruneFiles();
}

// ---------------------------------------------------------------------------
// 실행 취소 / 다시 실행 (메인 작업 영역의 pages 스냅샷)
// ---------------------------------------------------------------------------

// pages를 바꾸기 직전에 호출. 페이지 객체는 바꾸지 않고 새로 만들기 때문에 배열만 복사하면 된다
function recordHistory() {
  undoHistory.undo.push(state.pages.slice());
  if (undoHistory.undo.length > HISTORY_LIMIT) undoHistory.undo.shift();
  undoHistory.redo = [];
}

function clearHistory() {
  undoHistory.undo = [];
  undoHistory.redo = [];
}

function undo() {
  if (!undoHistory.undo.length) return;
  undoHistory.redo.push(state.pages);
  state.pages = undoHistory.undo.pop();
  render();
}

function redo() {
  if (!undoHistory.redo.length) return;
  undoHistory.undo.push(state.pages);
  state.pages = undoHistory.redo.pop();
  render();
}

// ---------------------------------------------------------------------------
// PDF 로딩
// ---------------------------------------------------------------------------

function isPdfFile(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

// PDF.js는 넘겨받은 버퍼를 worker로 전송(detach)하므로 항상 복사본을 넘긴다.
function getPdfDoc(fileId) {
  if (!pdfDocCache.has(fileId)) {
    const file = state.files.get(fileId);
    const task = pdfjsLib.getDocument({ data: new Uint8Array(file.data.slice(0)) });
    pdfDocCache.set(fileId, task.promise);
  }
  return pdfDocCache.get(fileId);
}

function describeLoadError(err) {
  if (err && err.name === 'PasswordException') return '암호가 설정된 PDF는 지원하지 않습니다';
  if (err && err.name === 'EncryptedPdfError') return '보안(암호화) 설정이 된 PDF는 지원하지 않습니다';
  return '파일을 읽을 수 없습니다';
}

// PDF 파일을 읽어 state.files에 등록(브라우저 저장소에도 저장)하고 fileId를 반환. 실패하면 null
async function loadPdfFile(file, color) {
  const data = await file.arrayBuffer();
  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
    // 열기 암호 없이 인쇄·복사만 제한한 PDF는 PDF.js로는 보이지만 pdf-lib로 저장할 수 없으므로,
    // 저장 단계에서 실패하지 않도록 업로드할 때 pdf-lib로도 읽어 확인한다
    const probe = await PDFLib.PDFDocument.load(data.slice(0), { ignoreEncryption: true, updateMetadata: false });
    if (probe.isEncrypted) {
      doc.destroy();
      throw Object.assign(new Error('encrypted'), { name: 'EncryptedPdfError' });
    }
  } catch (err) {
    console.warn(`PDF 로드 실패: ${file.name}`, err);
    if (doc && err.name !== 'EncryptedPdfError') doc.destroy();
    toast(`${describeLoadError(err)}: ${file.name}`, 'error');
    return null;
  }
  const id = uid('f');
  const record = { id, name: file.name, pageCount: doc.numPages, color, data };
  state.files.set(id, record);
  pdfDocCache.set(id, Promise.resolve(doc));
  dbPutFile(record);
  return id;
}

function filterPdfFiles(fileList) {
  const files = Array.from(fileList);
  const rejected = files.filter((f) => !isPdfFile(f));
  if (rejected.length) {
    toast(`PDF 파일만 업로드할 수 있습니다.\n제외된 파일: ${rejected.map((f) => f.name).join(', ')}`, 'error');
  }
  return files.filter(isPdfFile);
}

async function setMainFile(fileList) {
  await restoreDone;
  const files = filterPdfFiles(fileList);
  if (!files.length) return;
  if (files.length > 1) toast(`메인 PDF는 1개만 사용할 수 있습니다. 첫 번째 파일(${files[0].name})을 사용합니다.`);
  if (state.pages.length && !(await confirmDialog({
    title: '메인 PDF를 바꿀까요?',
    message: `현재 메인 작업 영역의 페이지 ${state.pages.length}개가 모두 지워지고 ${files[0].name}의 페이지로 바뀝니다. 첨부 PDF는 그대로 남습니다.`,
    okLabel: '바꾸기',
    danger: true,
  }))) return;

  const id = await loadPdfFile(files[0], MAIN_COLOR);
  if (!id) return;

  state.mainFileId = id;
  state.pages = [];
  for (let i = 0; i < state.files.get(id).pageCount; i++) {
    state.pages.push({ uid: uid('p'), fileId: id, pageIndex: i, rotation: 0 });
  }
  mainSelection.clear();
  clearHistory();
  pruneFiles();
  render();
}

async function addAttachments(fileList) {
  await restoreDone;
  for (const file of filterPdfFiles(fileList)) {
    const color = ATTACH_COLORS[attachColorIndex++ % ATTACH_COLORS.length];
    const id = await loadPdfFile(file, color);
    if (!id) continue;
    state.attachmentIds.push(id);
    render();
  }
}

function removeAttachment(fileId) {
  state.attachmentIds = state.attachmentIds.filter((id) => id !== fileId);
  collapsedAttach.delete(fileId);
  for (const key of [...selection]) {
    if (key.startsWith(`${fileId}:`)) selection.delete(key);
  }
  pruneFiles();
  render();
}

// 메인 PDF도 아니고, 첨부 목록에도 없고, 메인 작업 영역과 실행 취소 기록에서도 쓰지 않는 파일을
// 메모리와 브라우저 저장소에서 정리
function pruneFiles() {
  const used = new Set(state.pages.map((p) => p.fileId));
  const liveUids = new Set(state.pages.map((p) => p.uid));
  if (state.mainFileId) used.add(state.mainFileId);
  state.attachmentIds.forEach((id) => used.add(id));
  for (const snapshot of [...undoHistory.undo, ...undoHistory.redo]) {
    snapshot.forEach((p) => {
      used.add(p.fileId);
      liveUids.add(p.uid);
    });
  }

  // 메인 썸네일 캐시 키("m:페이지uid:회전")는 파일 id를 담지 않으므로 페이지 기준으로 정리 (메인 교체 등)
  for (const key of [...thumbCache.keys()]) {
    if (key.startsWith('m:') && !liveUids.has(key.split(':')[1])) dropThumb(key);
  }

  for (const id of [...state.files.keys()]) {
    if (used.has(id)) continue;
    state.files.delete(id);
    dbDeleteFile(id);
    const docPromise = pdfDocCache.get(id);
    pdfDocCache.delete(id);
    if (docPromise) docPromise.then((doc) => doc.destroy()).catch(() => {});
    for (const key of [...thumbCache.keys()]) {
      if (key.includes(id)) dropThumb(key);
    }
  }
}

// ---------------------------------------------------------------------------
// 렌더링
// ---------------------------------------------------------------------------

function render() {
  renderMain();
  renderAttachments();
  el.btnUndo.disabled = undoHistory.undo.length === 0;
  el.btnRedo.disabled = undoHistory.redo.length === 0;
  scheduleSave();
}

function renderMain() {
  activeEdit = null;
  // 드롭 직후 onUpdate에서 다시 그리면 onEnd가 불리지 않으므로 여기서 끈다
  document.body.classList.remove('dragging-multi');
  const hasPages = state.pages.length > 0;
  el.loading.hidden = !restoring;
  el.empty.hidden = hasPages || restoring;
  // 페이지가 없어도 첨부 PDF가 있으면 빈 그리드를 보여 줘서, 첨부 페이지를 끌어다 놓을 자리로 쓴다
  el.grid.hidden = !hasPages && (restoring || state.attachmentIds.length === 0);
  el.btnSave.disabled = !hasPages;
  el.btnReset.disabled = state.files.size === 0;

  const main = state.files.get(state.mainFileId);
  el.btnMainLabel.textContent = main ? '메인 PDF 교체' : '메인 PDF 업로드';
  el.btnMain.setAttribute('aria-label', el.btnMainLabel.textContent);

  // 사라진 페이지는 선택에서 뺀다 (삭제, 실행 취소 등)
  const live = new Set(state.pages.map((p) => p.uid));
  for (const u of [...mainSelection]) if (!live.has(u)) mainSelection.delete(u);

  el.grid.replaceChildren(
    ...state.pages.map((page, i) => {
      const file = state.files.get(page.fileId);
      const li = document.createElement('li');
      li.className = 'card';
      li.classList.toggle('selected', mainSelection.has(page.uid));
      li.dataset.uid = page.uid;
      li.style.setProperty('--file-color', file.color);

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.title = '클릭해서 선택, 더블클릭하면 크게 보기';
      // 회전 각도마다 따로 캐시 (실행 취소로 되돌릴 때 다시 그리지 않도록)
      thumb.append(getThumbCanvas(`m:${page.uid}:${page.rotation}`, page.fileId, page.pageIndex, page.rotation, THUMB_WIDTH));

      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'card-no';
      no.textContent = i + 1;
      no.title = '클릭해서 옮길 위치 번호 입력';
      no.setAttribute('aria-label', `${i + 1}번째 페이지 — 클릭해서 옮길 위치 번호 입력`);

      const src = document.createElement('div');
      src.className = 'card-src';
      src.textContent = `${file.name} · p${page.pageIndex + 1}`;
      src.title = src.textContent;

      const tools = document.createElement('div');
      tools.className = 'card-tools';
      tools.append(
        cardButton('move-prev', 'chevron-left', `${i + 1}번째 페이지를 앞으로 이동`, i === 0),
        cardButton('move-next', 'chevron-right', `${i + 1}번째 페이지를 뒤로 이동`, i === state.pages.length - 1),
        cardButton('rotate', 'rotate-cw', `${i + 1}번째 페이지를 시계 방향으로 90° 회전`, false),
        cardButton('delete', 'trash', `${i + 1}번째 페이지 삭제`, false),
      );

      li.append(thumb, no, src, tools);
      return li;
    }),
  );
  updateMainSelectionView();
}

// 메인 선택 표시만 갱신 (카드를 다시 만들지 않음)
function updateMainSelectionView() {
  for (const card of el.grid.children) {
    card.classList.toggle('selected', mainSelection.has(card.dataset.uid));
  }
  const main = state.files.get(state.mainFileId);
  const parts = [];
  if (main) parts.push(main.name);
  if (state.pages.length) parts.push(`총 ${state.pages.length}페이지`);
  if (mainSelection.size) parts.push(`${mainSelection.size}개 선택됨`);
  el.mainInfo.textContent = parts.join(' · ');
  el.selectionTools.hidden = mainSelection.size === 0;
  el.btnSelPrev.disabled = !canShiftSelection(-1);
  el.btnSelNext.disabled = !canShiftSelection(1);
  el.deleteSelectedLabel.textContent = `선택 삭제 (${mainSelection.size})`;
  el.btnDeleteSelected.setAttribute('aria-label', `선택한 ${mainSelection.size}개 페이지 삭제`);
}

function renderAttachments() {
  // 메인에 놓으면 onEnd보다 먼저 여기서 Sortable이 없어지므로 드래그 강조도 같이 끈다
  attachSortables.forEach((s) => s.destroy());
  attachSortables = [];
  document.body.classList.remove('dragging-attach');

  el.attachEmpty.hidden = state.attachmentIds.length > 0 || restoring;

  el.attachList.replaceChildren(
    ...state.attachmentIds.map((fileId) => {
      const file = state.files.get(fileId);
      const section = document.createElement('section');
      section.className = 'attach-file';
      section.style.setProperty('--file-color', file.color);

      const collapsed = collapsedAttach.has(fileId);
      section.classList.toggle('collapsed', collapsed);
      const selectedCount = Array.from({ length: file.pageCount }, (_, i) => selection.has(selKey(fileId, i))).filter(Boolean).length;

      const head = document.createElement('div');
      head.className = 'attach-file-head';

      // 파일 이름 부분 전체가 접기/펴기 버튼
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'attach-toggle';
      toggle.dataset.action = 'toggle-attach';
      toggle.dataset.fileId = fileId;
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', `${file.name}, ${file.pageCount}페이지 — ${collapsed ? '펼치기' : '접기'}`);
      toggle.title = file.name;
      toggle.innerHTML = icon('chevron-down');
      const dot = document.createElement('span');
      dot.className = 'file-dot';
      const name = document.createElement('span');
      name.className = 'attach-file-name';
      name.textContent = file.name;
      const count = document.createElement('span');
      count.className = 'attach-file-count';
      count.textContent = selectedCount ? `${selectedCount}/${file.pageCount}` : `${file.pageCount}p`;
      count.classList.toggle('has-selection', selectedCount > 0);
      toggle.append(dot, name, count);

      const allSelected = selectedCount === file.pageCount;
      const btnAll = document.createElement('button');
      btnAll.type = 'button';
      btnAll.className = 'small';
      btnAll.dataset.action = 'select-all';
      btnAll.dataset.fileId = fileId;
      btnAll.textContent = allSelected ? '선택 해제' : '전체 선택';
      btnAll.setAttribute('aria-label', `${file.name} 페이지 ${allSelected ? '선택 해제' : '전체 선택'}`);
      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'small icon-btn';
      btnRemove.dataset.action = 'remove-attach';
      btnRemove.dataset.fileId = fileId;
      btnRemove.innerHTML = icon('x');
      btnRemove.title = '첨부 목록에서 제거';
      btnRemove.setAttribute('aria-label', `${file.name} 첨부 목록에서 제거`);
      head.append(toggle, btnAll, btnRemove);

      const grid = document.createElement('ol');
      grid.className = 'attach-grid';
      grid.hidden = collapsed;
      for (let i = 0; i < file.pageCount; i++) {
        const selected = selection.has(selKey(fileId, i));
        const li = document.createElement('li');
        li.className = 'a-thumb';
        li.dataset.fileId = fileId;
        li.dataset.pageIndex = i;
        li.classList.toggle('selected', selected);
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.setAttribute('aria-pressed', String(selected));
        li.setAttribute('aria-label', `${file.name} ${i + 1}페이지`);
        li.title = `${i + 1}페이지 — 클릭해서 선택, 끌어서 메인에 추가, 더블클릭하면 크게 보기`;

        const box = document.createElement('div');
        box.className = 'a-thumb-img';
        box.append(getThumbCanvas(`a:${fileId}:${i}`, fileId, i, 0, ATTACH_THUMB_WIDTH));
        const label = document.createElement('span');
        label.className = 'a-thumb-no';
        label.textContent = i + 1;
        li.append(box, label);
        grid.append(li);
      }

      // 첨부 페이지는 복사(clone)되어 메인으로 들어간다. 첨부 패널 안에서의 정렬은 하지 않음
      // 끄는 동안 메인 작업 영역을 "여기에 놓기" 상태로 강조
      attachSortables.push(Sortable.create(grid, {
        group: { name: 'pages', pull: 'clone', put: false },
        sort: false,
        animation: 150,
        ghostClass: 'card-ghost',
        onStart: () => document.body.classList.add('dragging-attach'),
        onEnd: () => document.body.classList.remove('dragging-attach'),
      }));

      section.append(head, grid);
      return section;
    }),
  );

  const count = selection.size;
  el.attachSelected.textContent = count ? `${count}페이지 선택됨` : '선택한 페이지 없음';
  el.btnExtract.disabled = count === 0;
}

function cardButton(action, iconName, title, disabled) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `card-btn card-btn-${action}`;
  btn.dataset.action = action;
  btn.innerHTML = icon(iconName);
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.disabled = disabled;
  return btn;
}

// ---------------------------------------------------------------------------
// 썸네일: 화면에 들어온 것만 렌더링 (IntersectionObserver)
// ---------------------------------------------------------------------------

const pendingThumbs = new Map(); // 아직 그리지 않은 canvas -> [fileId, pageIndex, rotation, width]

const thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const canvas = entry.target;
    thumbObserver.unobserve(canvas);
    const args = pendingThumbs.get(canvas);
    if (!args) continue;
    pendingThumbs.delete(canvas);
    renderThumbnail(...args, canvas);
  }
}, { rootMargin: '400px 0px' }); // 화면 조금 밖까지 미리 그려서 스크롤할 때 빈칸이 덜 보이게

function getThumbCanvas(cacheKey, fileId, pageIndex, rotation, width) {
  let canvas = thumbCache.get(cacheKey);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = 0; // 그리기 전에는 회색 자리만 보이게
    canvas.height = 0;
    thumbCache.set(cacheKey, canvas);
    pendingThumbs.set(canvas, [fileId, pageIndex, rotation, width]);
  }
  if (pendingThumbs.has(canvas)) thumbObserver.observe(canvas);
  return canvas;
}

function dropThumb(cacheKey) {
  const canvas = thumbCache.get(cacheKey);
  if (!canvas) return;
  thumbCache.delete(cacheKey);
  pendingThumbs.delete(canvas);
  thumbObserver.unobserve(canvas);
}

// 동시에 여러 페이지를 렌더링하지 않도록 순서대로 처리하는 큐
let thumbQueue = Promise.resolve();

function renderThumbnail(fileId, pageIndex, rotation, width, canvas) {
  thumbQueue = thumbQueue.then(async () => {
    if (!state.files.has(fileId)) return; // 렌더링 전에 파일이 정리된 경우
    if (!canvas.isConnected) {
      // 기다리는 사이 화면에서 빠졌으면 다시 보일 때 그린다
      pendingThumbs.set(canvas, [fileId, pageIndex, rotation, width]);
      thumbObserver.observe(canvas);
      return;
    }
    try {
      const doc = await getPdfDoc(fileId);
      const pdfPage = await doc.getPage(pageIndex + 1);
      const rot = pdfPage.rotate + rotation;
      const base = pdfPage.getViewport({ scale: 1, rotation: rot });
      const viewport = pdfPage.getViewport({ scale: width / base.width, rotation: rot });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    } catch (err) {
      console.error('썸네일 렌더링 실패', fileId, pageIndex, err);
    }
  });
  return thumbQueue;
}

// ---------------------------------------------------------------------------
// 메인 작업 영역 편집
// ---------------------------------------------------------------------------

function deletePages(uids) {
  const remove = new Set(uids);
  if (!state.pages.some((p) => remove.has(p.uid))) return;
  recordHistory();
  state.pages = state.pages.filter((p) => !remove.has(p.uid));
  remove.forEach((u) => {
    for (const key of [...thumbCache.keys()]) {
      if (key.startsWith(`m:${u}:`)) dropThumb(key);
    }
    mainSelection.delete(u);
  });
  pruneFiles();
  render();
}

// 시계 방향 90° 회전. 실행 취소 기록이 이전 페이지 객체를 갖고 있으므로 새 객체로 바꾼다
function rotatePages(uids) {
  const target = new Set(uids);
  if (!state.pages.some((p) => target.has(p.uid))) return;
  recordHistory();
  state.pages = state.pages.map((p) => (target.has(p.uid) ? { ...p, rotation: (p.rotation + 90) % 360 } : p));
  render();
}

// 새 순서로 바꾼다. 순서가 그대로면 false
function setPageOrder(pages) {
  if (pages.every((p, i) => p === state.pages[i])) return false;
  recordHistory();
  state.pages = pages;
  render();
  return true;
}

// fromIndex의 페이지를 toIndex 자리에 끼워 넣는다 (사이의 페이지들은 한 칸씩 밀리거나 당겨짐)
function movePage(fromIndex, toIndex) {
  const last = state.pages.length - 1;
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex > last || toIndex > last) return false;
  const pages = state.pages.slice();
  const [page] = pages.splice(fromIndex, 1);
  pages.splice(toIndex, 0, page);
  return setPageOrder(pages);
}

// 선택한 페이지를 한 칸씩 앞(-1)/뒤(+1)로. 맨 끝에 닿은 페이지는 멈추고 나머지는 계속 움직인다
function shiftedSelection(step) {
  const pages = state.pages.slice();
  const sel = (i) => mainSelection.has(pages[i].uid);
  const swap = (i, j) => { [pages[i], pages[j]] = [pages[j], pages[i]]; };
  if (step < 0) {
    for (let i = 1; i < pages.length; i++) if (sel(i) && !sel(i - 1)) swap(i, i - 1);
  } else {
    for (let i = pages.length - 2; i >= 0; i--) if (sel(i) && !sel(i + 1)) swap(i, i + 1);
  }
  return pages;
}

function canShiftSelection(step) {
  if (!mainSelection.size) return false;
  return shiftedSelection(step).some((p, i) => p !== state.pages[i]);
}

// 선택한 페이지들을 원래 순서대로 묶어, 첫 페이지가 position(1부터) 번째에 오도록 끼워 넣는다
function selectionMovedTo(position) {
  const block = state.pages.filter((p) => mainSelection.has(p.uid));
  const rest = state.pages.filter((p) => !mainSelection.has(p.uid));
  const index = Math.min(Math.max(position - 1, 0), rest.length);
  return [...rest.slice(0, index), ...block, ...rest.slice(index)];
}

// ◀ ▶ 버튼과 번호 입력용 이동. 옮긴 페이지는 강조 표시된 채로 두고,
// 나머지 페이지들이 새 자리로 미끄러지듯 이동하는 애니메이션을 보여준다 (FLIP 기법)
function movePageAnimated(fromIndex, toIndex, focusAction) {
  const movedUid = state.pages[fromIndex] && state.pages[fromIndex].uid;
  animateReorder(() => movePage(fromIndex, toIndex), [movedUid], focusAction);
}

// 선택한 여러 페이지를 새 순서로 옮기고 같은 애니메이션을 보여준다
function moveSelectionAnimated(pages) {
  animateReorder(() => setPageOrder(pages), [...mainSelection]);
}

function animateReorder(apply, movedUids, focusAction) {
  const before = new Map(
    Array.from(el.grid.children, (card) => [card.dataset.uid, card.getBoundingClientRect()]),
  );
  if (!apply()) return;

  const movedSet = new Set(movedUids);
  for (const card of el.grid.children) {
    const uidKey = card.dataset.uid;
    if (movedSet.has(uidKey)) continue;
    const prev = before.get(uidKey);
    if (!prev) continue;
    const now = card.getBoundingClientRect();
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (dx || dy) {
      card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 250,
        easing: 'ease-out',
      });
    }
  }

  const movedCards = Array.from(el.grid.children).filter((card) => movedSet.has(card.dataset.uid));
  if (!movedCards.length) return;
  movedCards.forEach((card) => card.classList.add('moved'));
  const moved = movedCards[0];
  moved.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  // 같은 버튼을 계속 눌러 여러 칸 옮길 수 있도록 포커스 유지 (끝에 닿아 비활성이면 반대 버튼)
  if (focusAction) {
    const btn = moved.querySelector(`[data-action="${focusAction}"]`);
    const fallback = moved.querySelector('.card-btn:not(:disabled)');
    (btn && !btn.disabled ? btn : fallback || moved).focus({ preventScroll: true });
  }
}

// 순번을 클릭하면 입력칸으로 바꿔서 옮길 위치를 직접 입력받는다
function startNumberEdit(noButton) {
  const card = noButton.closest('.card');
  const fromIndex = state.pages.findIndex((p) => p.uid === card.dataset.uid);
  const total = state.pages.length;
  // 여러 페이지를 선택한 상태에서 선택된 카드의 번호를 고치면, 선택한 페이지 전체를 그 위치로 옮긴다
  const multi = mainSelection.size > 1 && mainSelection.has(card.dataset.uid);

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'card-no-input';
  input.min = 1;
  input.max = total;
  input.value = fromIndex + 1;
  input.setAttribute('aria-label', multi ? `선택한 ${mainSelection.size}개 페이지를 옮길 위치 (1~${total})` : `옮길 위치 (1~${total})`);
  noButton.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    activeEdit = null;
    const target = Math.round(Number(input.value));
    if (commit && input.value.trim() !== '' && Number.isFinite(target)) {
      if (multi) {
        const pages = selectionMovedTo(target);
        if (pages.some((p, i) => p !== state.pages[i])) {
          moveSelectionAnimated(pages);
          return;
        }
        render();
        return;
      }
      const toIndex = Math.min(Math.max(target, 1), total) - 1;
      if (toIndex !== fromIndex) {
        movePageAnimated(fromIndex, toIndex);
        return;
      }
    }
    render(); // 취소했거나 같은 위치면 원래대로
  };
  activeEdit = { finish };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// 메인 페이지 선택: 클릭 = 하나만, Ctrl/⌘+클릭 = 추가/해제, Shift+클릭 = 범위
function selectMainPage(pageUid, e) {
  const uids = state.pages.map((p) => p.uid);
  if (e.shiftKey && selectionAnchor && uids.includes(selectionAnchor)) {
    const [a, b] = [uids.indexOf(selectionAnchor), uids.indexOf(pageUid)].sort((x, y) => x - y);
    if (!(e.ctrlKey || e.metaKey)) mainSelection.clear();
    uids.slice(a, b + 1).forEach((u) => mainSelection.add(u));
  } else if (e.ctrlKey || e.metaKey) {
    if (mainSelection.has(pageUid)) mainSelection.delete(pageUid);
    else mainSelection.add(pageUid);
    selectionAnchor = pageUid;
  } else {
    mainSelection.clear();
    mainSelection.add(pageUid);
    selectionAnchor = pageUid;
  }
  updateMainSelectionView();
}

function clearMainSelection() {
  if (!mainSelection.size) return;
  mainSelection.clear();
  updateMainSelectionView();
}

// 첨부 페이지들을 메인 작업 영역의 index 위치에 복사해 넣는다
function insertAttachPages(refs, index) {
  recordHistory();
  const newPages = refs.map(({ fileId, pageIndex }) => ({ uid: uid('p'), fileId, pageIndex, rotation: 0 }));
  const pages = state.pages.slice();
  pages.splice(index, 0, ...newPages);
  state.pages = pages;
  refs.forEach(({ fileId, pageIndex }) => selection.delete(selKey(fileId, pageIndex)));
  render();
}

// 선택된 첨부 페이지를 첨부 목록 순서 → 페이지 순서로 정렬해서 반환
function selectedRefs() {
  const refs = [];
  for (const fileId of state.attachmentIds) {
    const file = state.files.get(fileId);
    for (let i = 0; i < file.pageCount; i++) {
      if (selection.has(selKey(fileId, i))) refs.push({ fileId, pageIndex: i });
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// 크게 보기
// ---------------------------------------------------------------------------

const viewer = {
  items: [],      // [{ fileId, pageIndex, rotation, label }] — ← → 로 넘겨 볼 페이지 목록
  index: 0,
  renderTask: null,
};

// 메인 작업 영역의 페이지 목록 또는 첨부 PDF 한 개의 페이지 목록을 넘겨 볼 수 있다
function openViewer(items, index) {
  viewer.items = items;
  viewer.index = index;
  if (!el.viewer.open) el.viewer.showModal();
  showViewerPage();
}

function mainViewerItems() {
  return state.pages.map((p, i) => ({
    fileId: p.fileId,
    pageIndex: p.pageIndex,
    rotation: p.rotation,
    label: `메인 ${i + 1} / ${state.pages.length} — ${state.files.get(p.fileId).name} · p${p.pageIndex + 1}`,
  }));
}

function attachViewerItems(fileId) {
  const file = state.files.get(fileId);
  return Array.from({ length: file.pageCount }, (_, i) => ({
    fileId,
    pageIndex: i,
    rotation: 0,
    label: `첨부 ${file.name} — ${i + 1} / ${file.pageCount}`,
  }));
}

async function showViewerPage() {
  const item = viewer.items[viewer.index];
  if (!item) return;
  el.viewerTitle.textContent = item.label;
  el.viewerPrev.disabled = viewer.index === 0;
  el.viewerNext.disabled = viewer.index === viewer.items.length - 1;

  // 빠르게 넘길 때 이전 렌더링은 취소
  if (viewer.renderTask) viewer.renderTask.cancel();
  const index = viewer.index;
  try {
    const doc = await getPdfDoc(item.fileId);
    const pdfPage = await doc.getPage(item.pageIndex + 1);
    if (index !== viewer.index || !el.viewer.open) return;

    // 화면에 꽉 차게 맞추고, 고해상도 화면에서도 선명하도록 devicePixelRatio 반영
    const rot = pdfPage.rotate + item.rotation;
    const base = pdfPage.getViewport({ scale: 1, rotation: rot });
    const box = el.viewerStage.getBoundingClientRect();
    const fit = Math.min(box.width / base.width, box.height / base.height);
    const dpr = window.devicePixelRatio || 1;
    const viewport = pdfPage.getViewport({ scale: fit * dpr, rotation: rot });

    const canvas = el.viewerCanvas;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(base.width * fit)}px`;
    canvas.style.height = `${Math.floor(base.height * fit)}px`;
    viewer.renderTask = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport });
    await viewer.renderTask.promise;
  } catch (err) {
    if (err && err.name === 'RenderingCancelledException') return;
    console.error('크게 보기 렌더링 실패', item, err);
  }
}

function moveViewer(step) {
  const next = viewer.index + step;
  if (next < 0 || next >= viewer.items.length) return;
  viewer.index = next;
  showViewerPage();
}

// ---------------------------------------------------------------------------
// 저장 / 초기화
// ---------------------------------------------------------------------------

async function exportPdf() {
  if (!state.pages.length) return;
  const label = el.btnSaveLabel.textContent;
  el.btnSave.disabled = true;
  el.btnSave.setAttribute('aria-busy', 'true');
  el.btnSaveLabel.textContent = '저장 중…';
  try {
    const out = await PDFLib.PDFDocument.create();
    const srcDocs = new Map();
    for (const page of state.pages) {
      if (!srcDocs.has(page.fileId)) {
        const file = state.files.get(page.fileId);
        try {
          srcDocs.set(page.fileId, await PDFLib.PDFDocument.load(file.data.slice(0)));
        } catch (err) {
          throw Object.assign(err, { fileName: file.name });
        }
      }
      const [copied] = await out.copyPages(srcDocs.get(page.fileId), [page.pageIndex]);
      if (page.rotation) {
        copied.setRotation(PDFLib.degrees((copied.getRotation().angle + page.rotation) % 360));
      }
      out.addPage(copied);
    }
    const bytes = await out.save();
    const fileName = exportFileName();
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), fileName);
    toast(`${fileName} 저장 완료 (${state.pages.length}페이지)`, 'success');
  } catch (err) {
    console.error('PDF 저장 실패', err);
    toast(err && err.fileName
      ? `PDF를 만드는 중 오류가 발생했습니다. 이 파일의 페이지를 저장할 수 없습니다: ${err.fileName}`
      : 'PDF를 만드는 중 오류가 발생했습니다.', 'error');
  } finally {
    el.btnSaveLabel.textContent = label;
    el.btnSave.removeAttribute('aria-busy');
    el.btnSave.disabled = state.pages.length === 0;
  }
}

function exportFileName() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const main = state.files.get(state.mainFileId);
  return main ? `${main.name.replace(/\.pdf$/i, '')}_편집본_${ymd}.pdf` : `편집본_${ymd}.pdf`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function resetAll() {
  if (!state.files.size) return;
  if (!(await confirmDialog({
    title: '전체 초기화할까요?',
    message: '메인 PDF와 첨부 PDF, 작업 중인 내용이 모두 지워집니다. 되돌릴 수 없습니다.',
    okLabel: '초기화',
    danger: true,
  }))) return;
  collapsedAttach.clear();
  state.mainFileId = null;
  state.attachmentIds = [];
  state.pages = [];
  selection.clear();
  mainSelection.clear();
  clearHistory();
  pruneFiles(); // 메모리와 브라우저 저장소의 파일 삭제
  thumbCache.clear();
  pendingThumbs.clear();
  thumbObserver.disconnect();
  attachColorIndex = 0;
  render();     // 빈 상태가 자동 저장된다
}

// ---------------------------------------------------------------------------
// 이벤트
// ---------------------------------------------------------------------------

el.btnUndo.addEventListener('click', undo);
el.btnRedo.addEventListener('click', redo);
el.btnReset.addEventListener('click', resetAll);
el.btnSave.addEventListener('click', exportPdf);

// 빈 상태 업로드 영역은 키보드(Enter·Space)로도 열 수 있다
function onActivate(target, fn) {
  target.addEventListener('click', fn);
  target.addEventListener('keydown', (e) => {
    if (e.target !== target || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    fn();
  });
}

el.btnMain.addEventListener('click', () => el.mainInput.click());
onActivate(el.empty, () => el.mainInput.click());
el.mainInput.addEventListener('change', async () => {
  if (el.mainInput.files.length) await setMainFile(el.mainInput.files);
  el.mainInput.value = ''; // 같은 파일을 다시 선택해도 change가 발생하도록
});

el.btnAttach.addEventListener('click', () => el.attachInput.click());
onActivate(el.attachEmpty, () => el.attachInput.click());
el.attachInput.addEventListener('change', async () => {
  if (el.attachInput.files.length) await addAttachments(el.attachInput.files);
  el.attachInput.value = '';
});

el.btnDeleteSelected.addEventListener('click', () => deletePages([...mainSelection]));
el.btnSelPrev.addEventListener('click', () => moveSelectionAnimated(shiftedSelection(-1)));
el.btnSelNext.addEventListener('click', () => moveSelectionAnimated(shiftedSelection(1)));
el.btnSelRotate.addEventListener('click', () => rotatePages([...mainSelection]));

// 파일을 끌어다 놓아 업로드 (페이지 드래그와 구분하기 위해 Files 타입만 처리)
function setupFileDrop(target, onFiles) {
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  target.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    target.classList.add('drop-over');
  });
  target.addEventListener('dragleave', (e) => {
    if (!target.contains(e.relatedTarget)) target.classList.remove('drop-over');
  });
  target.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    target.classList.remove('drop-over');
    onFiles(e.dataTransfer.files);
  });
}
setupFileDrop(el.workspace, setMainFile);
setupFileDrop(el.attach, addAttachments);

// 번호 입력 중에 다른 카드의 버튼·번호를 누르면, 입력칸이 먼저 사라져 클릭이 무시되던 문제 방지:
// 포커스 이동(blur)을 막아 두고 click 처리에서 입력을 먼저 확정한다
el.grid.addEventListener('mousedown', (e) => {
  if (activeEdit && e.target.closest('.card-btn, .card-no')) e.preventDefault();
});

// 메인 카드: 순번 클릭(위치 입력), ◀ ▶ ✕ 버튼, 카드 클릭(선택)
el.grid.addEventListener('click', (e) => {
  const target = e.target.closest('.card-no, .card-btn');
  const card = e.target.closest('.card');
  if (!card) return;
  const pageUid = card.dataset.uid;

  if (target && activeEdit) {
    if (e.target.closest('.card-no-input')) return;
    activeEdit.finish(true); // 다시 그려지므로 아래에서 uid로 새 요소를 찾는다
  }

  if (target && target.classList.contains('card-no')) {
    const no = el.grid.querySelector(`[data-uid="${pageUid}"] .card-no`);
    if (no) startNumberEdit(no);
    return;
  }
  if (target) {
    const index = state.pages.findIndex((p) => p.uid === pageUid);
    const action = target.dataset.action;
    if (action === 'delete') deletePages([pageUid]);
    else if (action === 'move-prev') movePageAnimated(index, index - 1, action);
    else if (action === 'move-next') movePageAnimated(index, index + 1, action);
    else if (action === 'rotate') {
      rotatePages([pageUid]);
      // 다시 그려진 카드의 회전 버튼에 포커스를 남겨 연속으로 누를 수 있게
      const btn = el.grid.querySelector(`[data-uid="${pageUid}"] [data-action="rotate"]`);
      if (btn) btn.focus({ preventScroll: true });
    }
    return;
  }
  if (!e.target.closest('.card-no-input')) selectMainPage(pageUid, e);
});

// 카드 바깥(빈 곳)을 클릭하면 메인 선택 해제
el.workspace.addEventListener('click', (e) => {
  if (!e.target.closest('.card, button, input')) clearMainSelection();
});

// 단축키: Ctrl+Z / Ctrl+Y(Ctrl+Shift+Z) / Delete / Ctrl+A / Esc
document.addEventListener('keydown', (e) => {
  if (el.viewer.open || el.confirm.open) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if (mod && key === 'a' && state.pages.length) {
    e.preventDefault();
    state.pages.forEach((p) => mainSelection.add(p.uid));
    updateMainSelectionView();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && mainSelection.size) {
    e.preventDefault();
    deletePages([...mainSelection]);
  } else if (e.key === 'Escape') {
    clearMainSelection();
  }
});

// 첨부 패널을 다시 그린 뒤에도 키보드 포커스가 같은 자리에 남도록 한다
function renderAttachmentsKeepFocus() {
  const active = document.activeElement;
  const selector = active && el.attachList.contains(active)
    ? (active.classList.contains('a-thumb')
      ? `.a-thumb[data-file-id="${active.dataset.fileId}"][data-page-index="${active.dataset.pageIndex}"]`
      : `button[data-action="${active.dataset.action}"][data-file-id="${active.dataset.fileId}"]`)
    : null;
  renderAttachments();
  const next = selector && el.attachList.querySelector(selector);
  if (next) next.focus({ preventScroll: true });
}

function toggleAttachPage(thumb) {
  const key = selKey(thumb.dataset.fileId, Number(thumb.dataset.pageIndex));
  if (selection.has(key)) selection.delete(key);
  else selection.add(key);
  renderAttachmentsKeepFocus();
}

// 첨부 패널: 페이지 선택, 접기/펴기, 전체 선택, 첨부 제거
el.attachList.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) {
    const { fileId } = btn.dataset;
    if (btn.dataset.action === 'remove-attach') {
      removeAttachment(fileId);
    } else if (btn.dataset.action === 'toggle-attach') {
      if (collapsedAttach.has(fileId)) collapsedAttach.delete(fileId);
      else collapsedAttach.add(fileId);
      renderAttachmentsKeepFocus();
    } else if (btn.dataset.action === 'select-all') {
      const keys = Array.from({ length: state.files.get(fileId).pageCount }, (_, i) => selKey(fileId, i));
      const allSelected = keys.every((k) => selection.has(k));
      keys.forEach((k) => (allSelected ? selection.delete(k) : selection.add(k)));
      renderAttachmentsKeepFocus();
    }
    return;
  }
  const thumb = e.target.closest('.a-thumb');
  if (thumb) toggleAttachPage(thumb);
});
el.attachList.addEventListener('keydown', (e) => {
  const thumb = e.target.closest('.a-thumb');
  if (!thumb || e.target !== thumb || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  toggleAttachPage(thumb);
});

// 더블클릭으로 크게 보기 (메인 카드 썸네일, 첨부 썸네일)
el.grid.addEventListener('dblclick', (e) => {
  const thumb = e.target.closest('.thumb');
  if (!thumb) return;
  const index = state.pages.findIndex((p) => p.uid === thumb.closest('.card').dataset.uid);
  if (index !== -1) openViewer(mainViewerItems(), index);
});
el.attachList.addEventListener('dblclick', (e) => {
  const thumb = e.target.closest('.a-thumb');
  if (!thumb) return;
  openViewer(attachViewerItems(thumb.dataset.fileId), Number(thumb.dataset.pageIndex));
});

el.viewerPrev.addEventListener('click', () => moveViewer(-1));
el.viewerNext.addEventListener('click', () => moveViewer(1));
el.viewerClose.addEventListener('click', () => el.viewer.close());
el.viewer.addEventListener('click', (e) => {
  // 페이지 바깥의 어두운 배경을 클릭하면 닫기
  if (e.target === el.viewer || e.target === el.viewerStage) el.viewer.close();
});
el.viewer.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') moveViewer(-1);
  else if (e.key === 'ArrowRight') moveViewer(1);
});
// 확인 대화상자 바깥(어두운 배경)을 클릭하면 취소
el.confirm.addEventListener('click', (e) => {
  if (e.target === el.confirm) el.confirm.close('cancel');
});

el.viewer.addEventListener('close', () => {
  if (viewer.renderTask) viewer.renderTask.cancel();
});
window.addEventListener('resize', () => {
  if (el.viewer.open) showViewerPage();
});

el.btnExtract.addEventListener('click', () => {
  const refs = selectedRefs();
  if (refs.length) insertAttachPages(refs, state.pages.length);
});

// 메인 작업 영역 드래그 정렬 + 첨부 페이지 드롭 받기
Sortable.create(el.grid, {
  group: { name: 'pages', pull: false, put: true },
  animation: 150,
  filter: '.card-btn, .card-no, .card-no-input',
  preventOnFilter: false,
  ghostClass: 'card-ghost',
  chosenClass: 'card-chosen',
  // 선택된 카드를 끌면 선택한 페이지 전체를 함께 옮긴다
  onStart: (e) => {
    if (mainSelection.size > 1 && mainSelection.has(e.item.dataset.uid)) document.body.classList.add('dragging-multi');
  },
  onEnd: () => document.body.classList.remove('dragging-multi'),
  // 메인 안에서 순서 변경. SortableJS가 DOM을 먼저 옮기므로 state에 반영 후 다시 그린다.
  onUpdate: (e) => {
    const draggedUid = e.item.dataset.uid;
    if (!(mainSelection.size > 1 && mainSelection.has(draggedUid))) {
      movePage(e.oldIndex, e.newIndex);
      return;
    }
    // 끌어 놓은 카드 자리에 선택한 페이지 전체를 원래 순서대로 넣는다
    const byUid = new Map(state.pages.map((p) => [p.uid, p]));
    const block = state.pages.filter((p) => mainSelection.has(p.uid));
    const pages = Array.from(el.grid.children, (card) => card.dataset.uid)
      .filter((u) => u === draggedUid || !mainSelection.has(u))
      .flatMap((u) => (u === draggedUid ? block : [byUid.get(u)]));
    if (!setPageOrder(pages)) render(); // 순서가 그대로여도 SortableJS가 옮긴 DOM은 되돌린다
  },
  // 첨부 패널에서 끌어온 페이지. 끌어온 페이지가 선택된 상태면 선택된 페이지 전체를 넣는다.
  onAdd: (e) => {
    const fileId = e.item.dataset.fileId;
    const pageIndex = Number(e.item.dataset.pageIndex);
    e.item.remove();
    const refs = selection.has(selKey(fileId, pageIndex)) ? selectedRefs() : [{ fileId, pageIndex }];
    insertAttachPages(refs, e.newIndex);
  },
});

// 페이지를 닫거나 새로고침하기 직전에 대기 중인 자동 저장을 바로 실행
window.addEventListener('pagehide', () => {
  if (saveTimer) saveState();
});

// 시작: 저장된 작업 복원
render();
const restoreDone = (async () => {
  try {
    await dbReady;
    if (db) await loadState();
  } catch (err) {
    console.error('작업 복원 실패', err);
  } finally {
    restoring = false;
    render();
  }
})();
