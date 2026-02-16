/**
 * @fileoverview 프로젝트 대시보드 — 칸반 보드 스타일 프로젝트/카드 관리 앱
 * @version 2.0
 * @date 2026-02-14
 * @stack HTML5 · CSS3 · Vanilla JavaScript (ES6+)
 * @storage localStorage (project_dashboard_data)
 */

// ══════════════════════════════════════
//  Constants
// ══════════════════════════════════════

const STORAGE_KEY = 'project_dashboard_data';
const MAX_PROJECT_NAME = 30;
const MAX_CARD_CONTENT = 500;
const DEBOUNCE_DELAY = 300;
const STORAGE_WARNING_THRESHOLD = 4 * 1024 * 1024;
const STORAGE_MAX_KB = 5120;

const CARD_TYPES = { TASK: 'task', NOTE: 'note', IMPORTANT: 'important' };
const VIEWS = { DASHBOARD: 'dashboard', TODAY: 'today', SCHEDULE: 'schedule', FOCUS: 'focus', SEARCH: 'search' };

const PRESET_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#F43F5E',
  '#8B5CF6', '#06B6D4', '#F97316', '#EC4899',
  '#84CC16', '#64748B', '#14B8A6', '#6366F1'
];

// ══════════════════════════════════════
//  Firebase
// ══════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyDPVVKdc-VT-RqqrXN-nooEHi5MAU2sr30",
  authDomain: "my-project-dashboard-b971a.firebaseapp.com",
  projectId: "my-project-dashboard-b971a",
  storageBucket: "my-project-dashboard-b971a.firebasestorage.app",
  messagingSenderId: "316403017474",
  appId: "1:316403017474:web:970829e799eed30e78041b"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

/** @type {firebase.User|null} */
let currentUser = null;

// ══════════════════════════════════════
//  State
// ══════════════════════════════════════

/** @type {{ projects: Array, archive: Array, settings: object, version: string, updatedAt: string }} */
let state = {
  projects: [],
  archive: [],
  columns: null,
  settings: { lastActiveView: VIEWS.DASHBOARD, lastFocusedProject: null },
  version: '2.0',
  updatedAt: ''
};

/** @type {string} Current active view */
let activeView = VIEWS.DASHBOARD;

/** @type {string|null} Project ID for focus view */
let focusedProjectId = null;

/** @type {boolean} Whether the archive panel is open */
let archiveOpen = false;

/** @type {string|null} Currently open dropdown menu project ID */
let openDropdownId = null;

/** @type {string} View before search was activated */
let viewBeforeSearch = VIEWS.DASHBOARD;

/** @type {string|null} ID of the most recently added card (for entry animation) */
let lastAddedCardId = null;

// ══════════════════════════════════════
//  DOM References
// ══════════════════════════════════════

const mainContent = document.getElementById('main-content');
const summaryFill = document.getElementById('summary-progress-fill');
const summaryText = document.getElementById('summary-progress-text');
const summaryProgressBar = document.getElementById('summary-progress-bar');
const projectDots = document.getElementById('project-dots');
const archiveSection = document.getElementById('archive-section');
const archiveToggle = document.getElementById('archive-toggle');
const archiveArrow = document.getElementById('archive-arrow');
const archiveCountEl = document.getElementById('archive-count');
const archiveList = document.getElementById('archive-list');
const modalOverlay = document.getElementById('modal-overlay');
const modalEl = document.getElementById('modal');
const searchInput = document.getElementById('search-input');
const storageWarning = document.getElementById('storage-warning');

// ══════════════════════════════════════
//  Utilities
// ══════════════════════════════════════

/**
 * Create a DOM element with optional properties.
 * @param {string} tag - Tag name
 * @param {object} [opts] - Options: className, text, attrs, style, children
 * @returns {HTMLElement}
 */
function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  if (opts.style) Object.assign(node.style, opts.style);
  if (opts.children) {
    for (const child of opts.children) { if (child) node.appendChild(child); }
  }
  return node;
}

/**
 * Create a debounced version of a function.
 * @param {Function} fn
 * @param {number} delay - Milliseconds
 * @returns {Function}
 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Close any open dropdowns or popovers. */
function closeAllPopups() {
  openDropdownId = null;
  document.querySelectorAll('.lane-dropdown, .color-popover').forEach(n => n.remove());
}

/** Remove all drop indicator elements from the board. */
function clearDropIndicators() {
  document.querySelectorAll('.lane-drop-indicator').forEach(el => el.remove());
}

/**
 * Initialize/synchronize columns layout from project data.
 * Creates one column per project if columns don't exist (migration).
 */
function initColumns() {
  if (!state.columns || !Array.isArray(state.columns)) {
    const sorted = [...state.projects].sort((a, b) => (a.order || 0) - (b.order || 0));
    state.columns = sorted.map(p => [p.id]);
  }
  const projectIds = new Set(state.projects.map(p => p.id));
  state.columns = state.columns
    .map(col => col.filter(id => projectIds.has(id)))
    .filter(col => col.length > 0);
  const inColumns = new Set(state.columns.flat());
  state.projects.forEach(p => {
    if (!inColumns.has(p.id)) state.columns.push([p.id]);
  });
}

/**
 * Get today's date with time zeroed.
 * @returns {number} Timestamp
 */
function todayTs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Parse a date string and zero the time.
 * @param {string} dateStr - Date string (YYYY-MM-DD or ISO)
 * @returns {number} Timestamp
 */
function dateTs(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Get D-day text and CSS class for a due date.
 * @param {string} dueDate - YYYY-MM-DD
 * @returns {{ text: string, cls: string }}
 */
function getDDayText(dueDate) {
  const today = todayTs();
  const due = dateTs(dueDate);
  const diff = Math.round((due - today) / 86400000);
  if (diff < 0) return { text: `D+${Math.abs(diff)} 지연`, cls: 'overdue' };
  if (diff === 0) return { text: '오늘', cls: 'today' };
  return { text: `D-${diff}`, cls: 'future' };
}

/**
 * Get progress bar color based on percentage.
 * @param {number} percent - 0 to 100
 * @returns {string} Hex color
 */
function progressColor(percent) {
  if (percent >= 100) return '#22C55E';
  if (percent >= 67) return '#3B82F6';
  if (percent >= 34) return '#F97316';
  return '#EF4444';
}

/**
 * Sort cards: incomplete first, then completed.
 * Within each group, cards with due dates come first (ascending), then undated (newest first).
 * @param {Array} cards
 * @returns {Array}
 */
function sortCards(cards) {
  return [...cards].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const aHas = a.dueDate ? 1 : 0;
    const bHas = b.dueDate ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    if (a.dueDate && b.dueDate) return dateTs(a.dueDate) - dateTs(b.dueDate);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

/**
 * Format a date to Korean locale (full).
 * @param {string} iso - ISO date string
 * @returns {string}
 */
function formatDateKR(iso) {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
}

/**
 * Format a date for short display.
 * @param {string} dateStr - Date string
 * @returns {string}
 */
function formatShortDate(dateStr) {
  const d = new Date(dateStr);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

/**
 * Apply shake animation to an element for invalid input feedback.
 * @param {HTMLElement} element
 */
function shakeElement(element) {
  element.classList.add('shake');
  setTimeout(() => {
    element.classList.remove('shake');
  }, 1000);
}

// ══════════════════════════════════════
//  Storage Layer
// ══════════════════════════════════════

/** Save state to localStorage (always) and Firestore (if logged in). */
function saveState() {
  state.updatedAt = new Date().toISOString();
  // 항상 localStorage에 저장 (캐시/오프라인 용)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      alert('저장 공간이 부족합니다. 아카이브된 프로젝트를 삭제하거나 데이터를 백업 후 정리해 주세요.');
    }
  }
  // 로그인 상태면 Firestore에도 저장
  if (currentUser) {
    saveToFirestore();
  }
}

/** Load state from localStorage. */
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    state.projects = p.projects || [];
    state.archive = p.archive || [];
    state.columns = p.columns || null;
    state.settings = p.settings || state.settings;
    state.version = p.version || '2.0';
    state.updatedAt = p.updatedAt || new Date().toISOString();
    activeView = state.settings.lastActiveView || VIEWS.DASHBOARD;
    focusedProjectId = state.settings.lastFocusedProject || null;
  } catch (e) {
    console.warn('localStorage 파싱 오류, 기본 상태로 초기화합니다.', e);
  }
}

/** Check storage usage and show warning banner if over threshold. */
function checkStorageUsage() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) { storageWarning.hidden = true; return; }
  if (new Blob([data]).size > STORAGE_WARNING_THRESHOLD) {
    storageWarning.hidden = false;
  } else {
    storageWarning.hidden = true;
  }
}

/**
 * Get current storage usage in KB.
 * @returns {number}
 */
function getStorageUsageKB() {
  const data = localStorage.getItem(STORAGE_KEY) || '';
  return Math.round(new Blob([data]).size / 1024);
}

// ══════════════════════════════════════
//  Firestore Sync
// ══════════════════════════════════════

/** Debounced Firestore save timer. */
let _firestoreSaveTimer = null;

/** Save state to Firestore with 500ms debounce. */
function saveToFirestore() {
  if (!currentUser) return;
  clearTimeout(_firestoreSaveTimer);
  _firestoreSaveTimer = setTimeout(() => {
    const data = JSON.parse(JSON.stringify(state));
    // 중첩 배열을 문자열로 변환
    if (data.columns) {
      data.columnsJSON = JSON.stringify(data.columns);
      delete data.columns;
    }
    const docRef = db.collection('users').doc(currentUser.uid)
      .collection('dashboard').doc('state');
    docRef.set(data)
      .then(() => console.log('[Firestore] 저장 완료'))
      .catch(err => console.error('[Firestore] 저장 실패:', err));
  }, 500);
}

/** Flush pending Firestore save immediately (for beforeunload). */
function flushFirestoreSave() {
  if (!currentUser || !_firestoreSaveTimer) return;
  clearTimeout(_firestoreSaveTimer);
  _firestoreSaveTimer = null;
  const data = JSON.parse(JSON.stringify(state));
  if (data.columns) {
    data.columnsJSON = JSON.stringify(data.columns);
    delete data.columns;
  }
  const docRef = db.collection('users').doc(currentUser.uid)
    .collection('dashboard').doc('state');
  docRef.set(data);
}

/**
 * Apply remote Firestore data to local state.
 * @param {object} remoteData - Firestore document data
 */
function applyRemoteState(remoteData) {
  state.projects = remoteData.projects || [];
  state.archive = remoteData.archive || [];
  // 문자열로 저장된 columns를 다시 배열로 변환
  if (remoteData.columnsJSON) {
    state.columns = JSON.parse(remoteData.columnsJSON);
  } else {
    state.columns = remoteData.columns || null;
  }
  state.settings = remoteData.settings || state.settings;
  state.version = remoteData.version || '2.0';
  state.updatedAt = remoteData.updatedAt || '';
  activeView = state.settings.lastActiveView || VIEWS.DASHBOARD;
  focusedProjectId = state.settings.lastFocusedProject || null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { /* ignore */ }
}

/**
 * Load state from Firestore. On login, Firestore always wins.
 * @param {boolean} [forceRemote=false] - true면 무조건 Firestore 데이터 적용
 * @returns {Promise<void>}
 */
async function loadFromFirestore(forceRemote) {
  if (!currentUser) return;
  console.log('[Firestore] 로드 시작...', { uid: currentUser.uid, forceRemote });
  try {
    const docRef = db.collection('users').doc(currentUser.uid).collection('dashboard').doc('state');
    const doc = await docRef.get();
    console.log('[Firestore] 문서 존재:', doc.exists);

    if (doc.exists) {
      const remoteData = doc.data();
      console.log('[Firestore] 원격 데이터:', { projects: (remoteData.projects || []).length, updatedAt: remoteData.updatedAt });

      if (forceRemote) {
        // 로그인 직후 or 수동 새로고침: 무조건 Firestore 우선
        applyRemoteState(remoteData);
      } else {
        const remoteTime = remoteData.updatedAt ? new Date(remoteData.updatedAt).getTime() : 0;
        const localTime = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;
        if (remoteTime >= localTime) {
          applyRemoteState(remoteData);
        } else {
          console.log('[Firestore] 로컬이 더 최신 → Firestore에 업로드');
          saveToFirestore();
        }
      }
    } else {
      console.log('[Firestore] 문서 없음 (첫 로그인)');
      // 첫 로그인: localStorage에 데이터가 있으면 업로드
      if (state.projects.length > 0 || state.archive.length > 0) {
        saveToFirestore();
      }
    }
    renderAll();
  } catch (err) {
    console.warn('[Firestore] 로드 실패:', err);
    renderAll();
  }
}

// ══════════════════════════════════════
//  Auth Functions
// ══════════════════════════════════════

/** Sign in with Google popup. */
function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => {
    if (err.code !== 'auth/popup-closed-by-user') {
      console.error('로그인 오류:', err);
      alert('로그인에 실패했습니다: ' + err.message);
    }
  });
}

/** Sign out from Firebase. */
function signOutUser() {
  auth.signOut().catch(err => {
    console.error('로그아웃 오류:', err);
  });
}

/** Update auth UI based on login state. */
function updateAuthUI(user) {
  const loginBtn = document.getElementById('login-btn');
  const userProfile = document.getElementById('user-profile');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');

  if (user) {
    loginBtn.hidden = true;
    userProfile.hidden = false;
    userAvatar.src = user.photoURL || '';
    userName.textContent = user.displayName || user.email || '';
  } else {
    loginBtn.hidden = false;
    userProfile.hidden = true;
  }
}

/** Sync button: force reload from Firestore. */
async function syncFromCloud() {
  console.log('[Sync] 수동 새로고침 시작');
  const syncBtn = document.getElementById('sync-btn');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.classList.add('syncing');
  }
  try {
    if (currentUser) {
      // localStorage를 건드리지 않고 바로 Firestore에서 불러오기
      await loadFromFirestore(true);
    }
    // 로그인 안 된 상태에서는 아무것도 하지 않음
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.classList.remove('syncing');
    }
  }
}

// ══════════════════════════════════════
//  Project CRUD
// ══════════════════════════════════════

/**
 * Get an unused preset color.
 * @returns {string} Hex color
 */
function getUnusedColor() {
  const used = new Set(state.projects.map(p => p.color));
  return PRESET_COLORS.find(c => !used.has(c)) || PRESET_COLORS[0];
}

/**
 * Create a new project.
 * @param {string} name
 * @param {string} color - Hex color
 */
function createProject(name, color) {
  const trimmed = name.trim();
  if (!trimmed) return;
  state.projects.push({
    id: crypto.randomUUID(),
    name: trimmed.slice(0, MAX_PROJECT_NAME),
    color,
    order: state.projects.length,
    cards: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  saveState();
  renderAll();
}

/**
 * Update project properties.
 * @param {string} id - Project ID
 * @param {object} updates - Properties to update (name, color)
 */
function updateProject(id, updates) {
  const p = state.projects.find(x => x.id === id);
  if (!p) return;
  if (updates.name !== undefined) {
    const t = updates.name.trim();
    if (!t) return;
    p.name = t.slice(0, MAX_PROJECT_NAME);
  }
  if (updates.color !== undefined) p.color = updates.color;
  p.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
}

/**
 * Archive a project (move from active to archive).
 * @param {string} id - Project ID
 */
function archiveProject(id) {
  const idx = state.projects.findIndex(p => p.id === id);
  if (idx === -1) return;
  const [p] = state.projects.splice(idx, 1);
  state.archive.push(p);
  if (focusedProjectId === id) { focusedProjectId = null; activeView = VIEWS.DASHBOARD; }
  saveState();
  renderAll();
}

/**
 * Restore a project from archive.
 * @param {string} id - Project ID
 */
function restoreProject(id) {
  const idx = state.archive.findIndex(p => p.id === id);
  if (idx === -1) return;
  const [p] = state.archive.splice(idx, 1);
  p.order = state.projects.length;
  state.projects.push(p);
  saveState();
  renderAll();
}

/**
 * Permanently delete a project.
 * @param {string} id - Project ID
 * @param {boolean} fromArchive - Whether the project is in the archive
 */
function deleteProject(id, fromArchive) {
  if (fromArchive) {
    state.archive = state.archive.filter(p => p.id !== id);
  } else {
    state.projects = state.projects.filter(p => p.id !== id);
  }
  if (focusedProjectId === id) { focusedProjectId = null; activeView = VIEWS.DASHBOARD; }
  saveState();
  renderAll();
}

/**
 * Reorder a project using column-aware positioning.
 * @param {string} draggedId - The project being dragged
 * @param {string} targetId - The project to drop onto
 * @param {string} position - 'left', 'right', 'top', or 'bottom'
 */
function reorderProject(draggedId, targetId, position) {
  if (draggedId === targetId) return;
  initColumns();

  // Remove dragged from its current column
  for (let i = 0; i < state.columns.length; i++) {
    const ri = state.columns[i].indexOf(draggedId);
    if (ri !== -1) { state.columns[i].splice(ri, 1); break; }
  }
  state.columns = state.columns.filter(col => col.length > 0);

  // Find target after cleanup
  let targetCol = -1, targetRow = -1;
  state.columns.forEach((col, ci) => {
    const ri = col.indexOf(targetId);
    if (ri !== -1) { targetCol = ci; targetRow = ri; }
  });
  if (targetCol === -1) return;

  if (position === 'left') {
    state.columns.splice(targetCol, 0, [draggedId]);
  } else if (position === 'right') {
    state.columns.splice(targetCol + 1, 0, [draggedId]);
  } else if (position === 'top') {
    state.columns[targetCol].splice(targetRow, 0, draggedId);
  } else {
    state.columns[targetCol].splice(targetRow + 1, 0, draggedId);
  }

  let order = 0;
  state.columns.flat().forEach(id => {
    const p = state.projects.find(p => p.id === id);
    if (p) p.order = order++;
  });
  saveState();
  renderAll();
}

// ══════════════════════════════════════
//  Card CRUD
// ══════════════════════════════════════

/**
 * Add a card to a project.
 * @param {string} projectId
 * @param {string} content
 * @param {string} [type="task"] - One of CARD_TYPES values
 * @param {string|null} [dueDate=null] - YYYY-MM-DD or null
 */
function addCard(projectId, content, type, dueDate) {
  if (type === undefined) type = CARD_TYPES.TASK;
  if (dueDate === undefined) dueDate = null;
  const trimmed = content.trim();
  if (!trimmed) return;
  const safeContent = trimmed.slice(0, MAX_CARD_CONTENT);
  if (type === CARD_TYPES.IMPORTANT && !dueDate) { alert('중요 항목은 날짜를 지정해 주세요.'); return; }

  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  const cardId = crypto.randomUUID();
  lastAddedCardId = cardId;

  project.cards.unshift({
    id: cardId,
    type,
    content: safeContent,
    completed: false,
    dueDate,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  });
  project.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
}

/**
 * Update a card's properties.
 * @param {string} projectId
 * @param {string} cardId
 * @param {object} updates - Properties to update (content, type, dueDate)
 */
function updateCard(projectId, cardId, updates) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const card = project.cards.find(c => c.id === cardId);
  if (!card) return;

  if (updates.content !== undefined) {
    const t = updates.content.trim();
    if (!t) return;
    card.content = t.slice(0, MAX_CARD_CONTENT);
  }
  if (updates.type !== undefined) {
    card.type = updates.type;
    if (card.type === CARD_TYPES.NOTE) { card.completed = false; card.completedAt = null; }
  }
  if (updates.dueDate !== undefined) card.dueDate = updates.dueDate;

  card.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
}

/**
 * Delete a card with animation and confirmation.
 * @param {string} projectId
 * @param {string} cardId
 */
function deleteCard(projectId, cardId) {
  if (!confirm('이 카드를 삭제하시겠습니까?')) return;

  const cardEl = document.querySelector(`[data-card-id="${cardId}"]`);
  if (cardEl) {
    cardEl.classList.add('card-removing');
    setTimeout(() => {
      const project = state.projects.find(p => p.id === projectId);
      if (!project) return;
      project.cards = project.cards.filter(c => c.id !== cardId);
      project.updatedAt = new Date().toISOString();
      saveState();
      renderAll();
    }, 150);
  } else {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;
    project.cards = project.cards.filter(c => c.id !== cardId);
    project.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
  }
}

/**
 * Toggle a card's completed state.
 * @param {string} projectId
 * @param {string} cardId
 */
function toggleCard(projectId, cardId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const card = project.cards.find(c => c.id === cardId);
  if (!card || card.type === CARD_TYPES.NOTE) return;
  card.completed = !card.completed;
  card.completedAt = card.completed ? new Date().toISOString() : null;
  card.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
}

// ══════════════════════════════════════
//  Progress
// ══════════════════════════════════════

/**
 * Get progress stats for a single project.
 * @param {{ cards: Array }} project
 * @returns {{ total: number, done: number, percent: number }}
 */
function getProjectProgress(project) {
  const tasks = project.cards.filter(c => c.type === CARD_TYPES.TASK || c.type === CARD_TYPES.IMPORTANT);
  const total = tasks.length;
  const done = tasks.filter(c => c.completed).length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * Get overall progress across all active projects.
 * @returns {{ total: number, done: number, percent: number }}
 */
function getOverallProgress() {
  const all = state.projects.flatMap(p => p.cards).filter(c => c.type === CARD_TYPES.TASK || c.type === CARD_TYPES.IMPORTANT);
  const total = all.length;
  const done = all.filter(c => c.completed).length;
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

// ══════════════════════════════════════
//  Backup / Restore (F-15)
// ══════════════════════════════════════

/** Export entire state as a JSON file download. */
function exportJSON() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().split('T')[0];
  const a = document.createElement('a');
  a.href = url;
  a.download = `dashboard_backup_${today}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import state from a JSON file.
 * @param {Event} e - File input change event
 */
function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = event => {
    try {
      const data = JSON.parse(event.target.result);
      if (!validateBackup(data)) {
        alert('올바른 백업 파일이 아닙니다');
        return;
      }
      if (!confirm('기존 데이터를 덮어씁니다. 계속하시겠습니까?')) return;

      state.projects = data.projects;
      state.archive = data.archive || [];
      state.settings = data.settings || { lastActiveView: VIEWS.DASHBOARD, lastFocusedProject: null };
      state.version = data.version || '2.0';
      activeView = VIEWS.DASHBOARD;
      focusedProjectId = null;
      saveState();
      renderAll();
      closeModal();
    } catch (err) {
      alert('올바른 백업 파일이 아닙니다');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/**
 * Validate backup data structure.
 * @param {*} data - Parsed JSON
 * @returns {boolean}
 */
function validateBackup(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.projects)) return false;
  if (data.archive !== undefined && !Array.isArray(data.archive)) return false;

  const validateProject = p => {
    if (!p || !p.id || !p.name || !p.color) return false;
    if (!Array.isArray(p.cards)) return false;
    return p.cards.every(c => c && c.id && c.type && c.content !== undefined);
  };

  if (!data.projects.every(validateProject)) return false;
  if (data.archive && !data.archive.every(validateProject)) return false;

  return true;
}

// ══════════════════════════════════════
//  Card DOM Rendering
// ══════════════════════════════════════

/**
 * Render a single card DOM element.
 * @param {object} card - Card data
 * @param {string} projectId
 * @param {string} [projectColor] - Hex color for left border
 * @param {string} [projectName] - Show project name tag in footer
 * @param {string} [highlightQuery] - Highlight matching text
 * @returns {HTMLElement}
 */
function renderCardDOM(card, projectId, projectColor, projectName, highlightQuery) {
  const isEntering = card.id === lastAddedCardId;
  const div = el('div', {
    className: 'card' + (card.completed ? ' completed' : '') + (isEntering ? ' card-enter' : ''),
    attrs: { 'data-card-id': card.id, 'data-project-id': projectId },
    style: projectColor ? { borderLeftColor: projectColor } : {}
  });

  // Header
  const header = el('div', { className: 'card-header' });

  if (card.type === CARD_TYPES.NOTE) {
    header.appendChild(el('span', { className: 'card-note-badge', text: '메모' }));
  } else if (card.type === CARD_TYPES.IMPORTANT) {
    header.appendChild(el('span', { className: 'card-important-badge', text: '\uD83D\uDD25' }));
    const cb = el('div', {
      className: 'card-checkbox' + (card.completed ? ' checked' : ''),
      attrs: {
        'data-action': 'toggle',
        'role': 'checkbox',
        'aria-checked': card.completed ? 'true' : 'false',
        'aria-label': '중요 항목 완료 체크',
        'tabindex': '0'
      }
    });
    header.appendChild(cb);
  } else {
    const cb = el('div', {
      className: 'card-checkbox' + (card.completed ? ' checked' : ''),
      attrs: {
        'data-action': 'toggle',
        'role': 'checkbox',
        'aria-checked': card.completed ? 'true' : 'false',
        'aria-label': '할 일 완료 체크',
        'tabindex': '0'
      }
    });
    header.appendChild(cb);
  }

  // Content
  const content = el('div', { className: 'card-content' });
  const lines = card.content.split('\n');
  const needsTruncate = lines.length > 3;

  const textSpan = el('span', { className: 'card-text' + (needsTruncate ? ' card-text-preview' : '') });
  if (highlightQuery) {
    highlightText(textSpan, card.content, highlightQuery);
  } else {
    textSpan.textContent = card.content;
  }
  content.appendChild(textSpan);

  if (needsTruncate) {
    content.appendChild(el('span', { className: 'card-show-more', text: '더보기', attrs: { 'role': 'button', 'tabindex': '0' } }));
  }

  header.appendChild(content);

  // Delete button
  const delBtn = el('button', {
    className: 'btn-delete-card',
    text: '\u00D7',
    attrs: { 'aria-label': '카드 삭제', 'data-action': 'delete' }
  });
  header.appendChild(delBtn);

  div.appendChild(header);

  // Footer
  const footer = el('div', { className: 'card-footer' });

  if (projectName) {
    footer.appendChild(el('span', {
      className: 'list-card-project-tag',
      text: projectName,
      style: { background: projectColor || '#64748B' }
    }));
  }

  if (card.dueDate) {
    const dd = getDDayText(card.dueDate);
    footer.appendChild(el('span', { className: 'date-badge ' + dd.cls, text: dd.text }));
    footer.appendChild(el('span', { className: 'card-due-date', text: formatShortDate(card.dueDate) }));
  }

  if (card.completed && card.completedAt) {
    const d = new Date(card.completedAt);
    footer.appendChild(el('span', { className: 'completed-date', text: `\u2713 ${d.getMonth() + 1}/${d.getDate()} 완료` }));
  }

  if (footer.childNodes.length > 0) div.appendChild(footer);

  return div;
}

/**
 * Highlight matching text with mark tags (XSS-safe using textContent/createTextNode).
 * @param {HTMLElement} container
 * @param {string} text
 * @param {string} query
 */
function highlightText(container, text, query) {
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  let lastIdx = 0;

  while (true) {
    const idx = lower.indexOf(qLower, lastIdx);
    if (idx === -1) break;
    if (idx > lastIdx) {
      container.appendChild(document.createTextNode(text.slice(lastIdx, idx)));
    }
    const mark = el('mark', { className: 'search-highlight', text: text.slice(idx, idx + query.length) });
    container.appendChild(mark);
    lastIdx = idx + query.length;
  }

  if (lastIdx < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIdx)));
  }
}

/**
 * Start inline editing of a card.
 * @param {HTMLElement} cardEl - Card DOM element
 * @param {object} card - Card data
 * @param {string} projectId
 */
function startCardEdit(cardEl, card, projectId) {
  if (cardEl.querySelector('.card-edit-area')) return;

  const editArea = el('div', { className: 'card-edit-area' });

  const textarea = document.createElement('textarea');
  textarea.className = 'card-edit-textarea';
  textarea.value = card.content;
  textarea.maxLength = MAX_CARD_CONTENT;
  textarea.setAttribute('aria-label', '카드 내용 편집');
  editArea.appendChild(textarea);

  // Type + date options
  const opts = el('div', { className: 'card-edit-options' });

  const types = el('div', { className: 'quick-add-types' });
  [CARD_TYPES.TASK, CARD_TYPES.NOTE, CARD_TYPES.IMPORTANT].forEach(t => {
    const lbl = el('label', { className: 'quick-add-type-label' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'edit-type-' + card.id;
    radio.value = t;
    radio.checked = card.type === t;
    lbl.appendChild(radio);
    lbl.appendChild(document.createTextNode(t === CARD_TYPES.TASK ? '할 일' : t === CARD_TYPES.NOTE ? '메모' : '중요'));
    types.appendChild(lbl);
  });
  opts.appendChild(types);

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'quick-add-date';
  dateInput.value = card.dueDate || '';
  dateInput.setAttribute('aria-label', '마감일 선택');
  opts.appendChild(dateInput);

  types.addEventListener('change', e => {
    const val = e.target.value;
    if (val === CARD_TYPES.IMPORTANT && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }
  });

  editArea.appendChild(opts);

  // Action buttons
  const actions = el('div', { className: 'card-edit-actions' });

  const cancelBtn = el('button', { className: 'card-edit-btn card-edit-cancel', text: '취소', attrs: { 'aria-label': '편집 취소' } });
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); renderAll(); });

  const saveBtn = el('button', { className: 'card-edit-btn card-edit-save', text: '저장', attrs: { 'aria-label': '카드 저장' } });
  saveBtn.addEventListener('click', e => {
    e.stopPropagation();
    const selectedType = types.querySelector('input:checked').value;
    const dd = dateInput.value || null;
    if (selectedType === CARD_TYPES.IMPORTANT && !dd) { alert('중요 항목은 날짜를 지정해 주세요.'); return; }
    updateCard(projectId, card.id, { content: textarea.value, type: selectedType, dueDate: dd });
  });

  actions.append(cancelBtn, saveBtn);
  editArea.appendChild(actions);
  cardEl.appendChild(editArea);

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); saveBtn.click(); }
    if (e.key === 'Escape') { e.stopPropagation(); renderAll(); }
  });

  requestAnimationFrame(() => textarea.focus());
}

// ══════════════════════════════════════
//  Quick Add UI Builder
// ══════════════════════════════════════

/**
 * Build the quick-add footer for a project lane or focus view.
 * @param {string} projectId
 * @returns {HTMLElement}
 */
function buildQuickAdd(projectId) {
  const footer = el('div', { className: 'quick-add' });
  let panelOpen = false;

  // Row: input + toggle
  const row = el('div', { className: 'quick-add-row' });
  const input = el('input', {
    className: 'quick-add-input',
    attrs: { type: 'text', placeholder: '+ 할 일 추가...', 'aria-label': '새 카드 추가' }
  });

  const toggleBtn = el('button', { className: 'quick-add-toggle', text: '\u25BE', attrs: { 'aria-label': '옵션 토글' } });

  row.append(input, toggleBtn);
  footer.appendChild(row);

  // Expanded panel
  const panel = el('div', { className: 'quick-add-panel' });

  const textarea = document.createElement('textarea');
  textarea.className = 'quick-add-textarea';
  textarea.placeholder = '여러 줄 입력 (Ctrl+Enter로 줄바꿈, Enter로 추가)';
  textarea.setAttribute('aria-label', '카드 내용 입력');
  panel.appendChild(textarea);

  const opts = el('div', { className: 'quick-add-options' });

  const types = el('div', { className: 'quick-add-types' });
  const uid = 'qa-' + projectId.slice(0, 8);
  let selectedType = CARD_TYPES.TASK;

  [CARD_TYPES.TASK, CARD_TYPES.NOTE, CARD_TYPES.IMPORTANT].forEach(t => {
    const lbl = el('label', { className: 'quick-add-type-label' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = uid;
    radio.value = t;
    radio.checked = t === CARD_TYPES.TASK;
    radio.addEventListener('change', () => {
      selectedType = t;
      if (t === CARD_TYPES.IMPORTANT && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
    });
    lbl.appendChild(radio);
    lbl.appendChild(document.createTextNode(t === CARD_TYPES.TASK ? '할 일' : t === CARD_TYPES.NOTE ? '메모' : '중요'));
    types.appendChild(lbl);
  });

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'quick-add-date';
  dateInput.setAttribute('aria-label', '마감일 선택');

  const submitBtn = el('button', { className: 'quick-add-submit', text: '추가', attrs: { 'aria-label': '카드 추가' } });

  opts.append(types, dateInput, submitBtn);
  panel.appendChild(opts);
  footer.appendChild(panel);

  function doAdd(text) {
    const t = text.trim();
    if (!t) {
      shakeElement(panelOpen ? textarea : input);
      return;
    }
    const dd = dateInput.value || null;
    addCard(projectId, t, selectedType, dd);
  }

  // Simple input Enter
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doAdd(input.value);
    }
  });

  // Textarea Enter (no ctrl = submit, ctrl+enter = newline)
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault();
      doAdd(textarea.value);
    }
  });

  submitBtn.addEventListener('click', () => {
    doAdd(panelOpen ? textarea.value : input.value);
  });

  toggleBtn.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panel.classList.toggle('open', panelOpen);
    toggleBtn.textContent = panelOpen ? '\u25B4' : '\u25BE';
    toggleBtn.setAttribute('aria-expanded', panelOpen);
    if (panelOpen) {
      textarea.value = input.value;
      input.style.display = 'none';
      requestAnimationFrame(() => textarea.focus());
    } else {
      input.value = textarea.value.split('\n')[0];
      input.style.display = '';
      requestAnimationFrame(() => input.focus());
    }
  });

  return footer;
}

// ══════════════════════════════════════
//  Card List Event Delegation
// ══════════════════════════════════════

/**
 * Attach click + keyboard event delegation to a card-list container.
 * @param {HTMLElement} container
 */
function attachCardListEvents(container) {
  container.addEventListener('click', e => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;

    const projectId = cardEl.dataset.projectId;
    const cardId = cardEl.dataset.cardId;
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;
    const card = project.cards.find(c => c.id === cardId);
    if (!card) return;

    const action = e.target.closest('[data-action]');

    if (action && action.dataset.action === 'toggle') {
      e.stopPropagation();
      toggleCard(projectId, cardId);
      return;
    }

    if (action && action.dataset.action === 'delete') {
      e.stopPropagation();
      deleteCard(projectId, cardId);
      return;
    }

    // Click on show-more or card-text -> expand / edit
    if (e.target.closest('.card-show-more') || e.target.closest('.card-text')) {
      e.stopPropagation();
      if (!cardEl.classList.contains('expanded')) {
        cardEl.classList.add('expanded');
      } else {
        startCardEdit(cardEl, card, projectId);
      }
      return;
    }
  });

  // Keyboard: Enter/Space on checkbox or show-more
  container.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const toggle = e.target.closest('[data-action="toggle"]');
      if (toggle) {
        e.preventDefault();
        const cardEl = toggle.closest('.card');
        if (cardEl) toggleCard(cardEl.dataset.projectId, cardEl.dataset.cardId);
        return;
      }
      const showMore = e.target.closest('.card-show-more');
      if (showMore) {
        e.preventDefault();
        const cardEl = showMore.closest('.card');
        if (cardEl) cardEl.classList.add('expanded');
      }
    }
  });
}

// ══════════════════════════════════════
//  Modal System
// ══════════════════════════════════════

/**
 * Open a modal dialog with custom content.
 * @param {function(HTMLElement): void} buildContent - Builds the modal inner content
 */
function openModal(buildContent) {
  modalEl.textContent = '';
  buildContent(modalEl);
  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

/** Close the modal and restore body scroll. */
function closeModal() {
  modalOverlay.classList.remove('open');
  modalEl.textContent = '';
  document.body.style.overflow = '';
}

/** Show the create-project modal. */
function showCreateProjectModal() {
  const defaultColor = getUnusedColor();
  let selectedColor = defaultColor;

  openModal(container => {
    container.setAttribute('aria-label', '새 프로젝트 만들기');
    const title = el('h2', { className: 'modal-title', text: '새 프로젝트 만들기' });

    const nameField = el('div', { className: 'modal-field' });
    const nameLabel = el('label', { className: 'modal-label', text: '프로젝트 이름' });
    const nameInput = el('input', {
      className: 'modal-input',
      attrs: { type: 'text', placeholder: '프로젝트 이름 입력', maxlength: String(MAX_PROJECT_NAME), 'aria-label': '프로젝트 이름' }
    });
    const charCount = el('div', { className: 'modal-char-count', text: `0 / ${MAX_PROJECT_NAME}` });
    nameInput.addEventListener('input', () => { charCount.textContent = `${nameInput.value.length} / ${MAX_PROJECT_NAME}`; });
    nameField.append(nameLabel, nameInput, charCount);

    const colorField = el('div', { className: 'modal-field' });
    const colorLabel = el('label', { className: 'modal-label', text: '컬러' });
    const palette = el('div', { className: 'color-palette' });

    PRESET_COLORS.forEach(c => {
      const swatch = el('button', {
        className: 'color-swatch' + (c === selectedColor ? ' selected' : ''),
        style: { background: c },
        attrs: { type: 'button', 'aria-label': `컬러 ${c}` }
      });
      swatch.addEventListener('click', () => {
        selectedColor = c;
        palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        customInput.value = c;
      });
      palette.appendChild(swatch);
    });

    const customRow = el('div', { className: 'color-custom-row' });
    const customLabel = el('label', { text: '커스텀:' });
    const customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.value = selectedColor;
    customInput.setAttribute('aria-label', '커스텀 컬러 선택');
    customInput.addEventListener('input', () => {
      selectedColor = customInput.value;
      palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    });
    customRow.append(customLabel, customInput);
    colorField.append(colorLabel, palette, customRow);

    const actions = el('div', { className: 'modal-actions' });
    const cancelBtn = el('button', { className: 'modal-btn modal-btn-cancel', text: '취소' });
    cancelBtn.addEventListener('click', closeModal);
    const createBtn = el('button', { className: 'modal-btn modal-btn-primary', text: '생성' });
    createBtn.addEventListener('click', () => {
      if (!nameInput.value.trim()) { nameInput.classList.add('error'); nameInput.focus(); return; }
      createProject(nameInput.value, selectedColor);
      closeModal();
    });
    actions.append(cancelBtn, createBtn);

    container.append(title, nameField, colorField, actions);
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') createBtn.click();
      if (e.key === 'Escape') closeModal();
    });
    requestAnimationFrame(() => nameInput.focus());
  });
}

/**
 * Show delete-project confirmation modal (requires typing the exact project name).
 * @param {object} project
 * @param {boolean} fromArchive
 */
function showDeleteProjectModal(project, fromArchive) {
  openModal(container => {
    container.setAttribute('aria-label', '프로젝트 삭제 확인');
    const title = el('h2', { className: 'modal-title', text: '프로젝트 삭제' });
    const warning = el('p', { className: 'modal-warning' });
    warning.textContent = `"${project.name}" 프로젝트를 영구 삭제합니다. 확인하려면 프로젝트 이름을 입력하세요.`;

    const field = el('div', { className: 'modal-field' });
    const input = el('input', {
      className: 'modal-input',
      attrs: { type: 'text', placeholder: project.name, 'aria-label': '프로젝트 이름 확인' }
    });
    field.appendChild(input);

    const actions = el('div', { className: 'modal-actions' });
    const cancelBtn = el('button', { className: 'modal-btn modal-btn-cancel', text: '취소' });
    cancelBtn.addEventListener('click', closeModal);
    const delBtn = el('button', { className: 'modal-btn modal-btn-danger', text: '삭제', attrs: { disabled: '' } });

    input.addEventListener('input', () => {
      delBtn.toggleAttribute('disabled', input.value !== project.name);
    });
    delBtn.addEventListener('click', () => {
      if (input.value === project.name) { deleteProject(project.id, fromArchive); closeModal(); }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value === project.name) delBtn.click();
      if (e.key === 'Escape') closeModal();
    });
    actions.append(cancelBtn, delBtn);
    container.append(title, warning, field, actions);
    requestAnimationFrame(() => input.focus());
  });
}

/** Show the settings modal (F-15: backup/restore + storage info). */
function showSettingsModal() {
  openModal(container => {
    container.setAttribute('aria-label', '설정');
    const title = el('h2', { className: 'modal-title', text: '\u2699\uFE0F 설정' });

    // Sync status
    const syncStatus = el('div', { className: 'settings-sync-status' });
    if (currentUser) {
      syncStatus.textContent = `☁️ Google 계정으로 동기화 중 (${currentUser.displayName || currentUser.email})`;
    } else {
      syncStatus.textContent = '💾 로컬 저장 모드 (로그인하면 클라우드 동기화)';
    }
    container.appendChild(syncStatus);

    // Action buttons
    const actionsDiv = el('div', { className: 'settings-actions' });

    const exportBtn = el('button', {
      className: 'settings-action-btn',
      text: '\uD83D\uDCE4 JSON 내보내기',
      attrs: { 'aria-label': 'JSON 파일로 데이터 내보내기' }
    });
    exportBtn.addEventListener('click', exportJSON);

    const importBtn = el('button', {
      className: 'settings-action-btn',
      text: '\uD83D\uDCE5 JSON 가져오기',
      attrs: { 'aria-label': 'JSON 파일에서 데이터 가져오기' }
    });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', importJSON);
    importBtn.addEventListener('click', () => fileInput.click());

    actionsDiv.append(exportBtn, importBtn, fileInput);

    // Storage usage display
    const storageSection = el('div', { className: 'settings-storage' });
    const usedKB = getStorageUsageKB();
    const usagePercent = Math.min(100, Math.round((usedKB / STORAGE_MAX_KB) * 100));

    storageSection.appendChild(el('div', { className: 'settings-storage-label', text: '저장 공간' }));

    const storageBar = el('div', { className: 'settings-storage-bar' });
    const fillCls = usagePercent >= 90 ? 'danger' : usagePercent >= 70 ? 'warning' : '';
    const storageFill = el('div', {
      className: 'settings-storage-fill' + (fillCls ? ' ' + fillCls : ''),
      style: { width: usagePercent + '%' }
    });
    storageBar.appendChild(storageFill);
    storageSection.appendChild(storageBar);

    storageSection.appendChild(el('div', {
      className: 'settings-storage-text',
      text: `${usedKB.toLocaleString()}KB / ${STORAGE_MAX_KB.toLocaleString()}KB 사용 중`
    }));

    // Close button
    const closeActions = el('div', { className: 'modal-actions' });
    const closeBtn = el('button', { className: 'modal-btn modal-btn-cancel', text: '닫기' });
    closeBtn.addEventListener('click', closeModal);
    closeActions.appendChild(closeBtn);

    container.append(title, actionsDiv, storageSection, closeActions);
  });
}

// ══════════════════════════════════════
//  Lane Dropdown & Color Popover
// ══════════════════════════════════════

/**
 * Show the lane context menu (rename, color, archive, delete).
 * @param {string} projectId
 * @param {HTMLElement} anchorEl
 */
function showLaneDropdown(projectId, anchorEl) {
  closeAllPopups();
  openDropdownId = projectId;
  const parent = anchorEl.parentElement;
  parent.style.position = 'relative';
  const dropdown = el('div', { className: 'lane-dropdown', attrs: { role: 'menu' } });

  const items = [
    { text: '\u270F\uFE0F 이름 변경', action: () => { closeAllPopups(); startInlineRename(projectId); } },
    { text: '\uD83C\uDFA8 컬러 변경', action: () => { closeAllPopups(); showColorPopover(projectId, anchorEl); } },
    { text: '\uD83D\uDCE6 아카이브', action: () => { closeAllPopups(); if (confirm('이 프로젝트를 아카이브하시겠습니까?')) archiveProject(projectId); } },
    'divider',
    { text: '\uD83D\uDDD1\uFE0F 삭제', cls: 'danger', action: () => { closeAllPopups(); const p = state.projects.find(x => x.id === projectId); if (p) showDeleteProjectModal(p, false); } }
  ];

  items.forEach(item => {
    if (item === 'divider') { dropdown.appendChild(el('div', { className: 'lane-dropdown-divider' })); return; }
    const btn = el('button', {
      className: 'lane-dropdown-item' + (item.cls ? ' ' + item.cls : ''),
      text: item.text,
      attrs: { role: 'menuitem' }
    });
    btn.addEventListener('click', item.action);
    dropdown.appendChild(btn);
  });

  parent.appendChild(dropdown);
}

/**
 * Start inline project name editing.
 * @param {string} projectId
 */
function startInlineRename(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const laneEl = document.querySelector(`[data-project-id="${projectId}"]`);
  if (!laneEl) return;
  const nameEl = laneEl.querySelector('.lane-name');
  if (!nameEl) return;

  const input = el('input', {
    className: 'lane-name-input',
    attrs: { type: 'text', maxlength: String(MAX_PROJECT_NAME), value: project.name, 'aria-label': '프로젝트 이름 변경' }
  });
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  function commit() {
    if (done) return; done = true;
    const val = input.value.trim();
    if (val && val !== project.name) { updateProject(projectId, { name: val }); } else { renderAll(); }
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { done = true; renderAll(); }
  });
  input.addEventListener('blur', commit);
}

/**
 * Show color picker popover for a project.
 * @param {string} projectId
 * @param {HTMLElement} anchorEl
 */
function showColorPopover(projectId, anchorEl) {
  closeAllPopups();
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const parent = anchorEl.parentElement;
  parent.style.position = 'relative';
  const popover = el('div', { className: 'color-popover' });
  const palette = el('div', { className: 'color-palette' });

  PRESET_COLORS.forEach(c => {
    const swatch = el('button', {
      className: 'color-swatch' + (c === project.color ? ' selected' : ''),
      style: { background: c },
      attrs: { type: 'button', 'aria-label': `컬러 ${c}` }
    });
    swatch.addEventListener('click', () => { updateProject(projectId, { color: c }); closeAllPopups(); });
    palette.appendChild(swatch);
  });

  const customRow = el('div', { className: 'color-custom-row' });
  const label = el('label', { text: '커스텀:' });
  const ci = document.createElement('input');
  ci.type = 'color'; ci.value = project.color;
  ci.setAttribute('aria-label', '커스텀 컬러 선택');
  ci.addEventListener('input', () => { updateProject(projectId, { color: ci.value }); closeAllPopups(); });
  customRow.append(label, ci);
  popover.append(palette, customRow);
  parent.appendChild(popover);
}

// ══════════════════════════════════════
//  Rendering — Main
// ══════════════════════════════════════

/** Render everything based on activeView. */
function renderAll() {
  // Update tab states + accessibility
  document.querySelectorAll('.view-tab').forEach(btn => {
    const v = btn.dataset.view;
    const isActive = v === activeView
      || (activeView === VIEWS.FOCUS && v === VIEWS.DASHBOARD)
      || (activeView === VIEWS.SEARCH && v === state.settings.lastActiveView);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  // Persist view setting (skip transient views)
  if (activeView !== VIEWS.SEARCH && activeView !== VIEWS.FOCUS) {
    state.settings.lastActiveView = activeView;
  }
  state.settings.lastFocusedProject = focusedProjectId;
  closeAllPopups();

  switch (activeView) {
    case VIEWS.DASHBOARD: renderDashboard(); break;
    case VIEWS.FOCUS: renderFocusView(); break;
    case VIEWS.TODAY: renderTodayView(); break;
    case VIEWS.SCHEDULE: renderScheduleView(); break;
    case VIEWS.SEARCH: renderSearchResults(searchInput.value); break;
    default: renderDashboard();
  }

  renderSummaryBar();
  renderArchive();
  checkStorageUsage();

  // Clear entry animation flag
  lastAddedCardId = null;
}

// ══════════════════════════════════════
//  Dashboard View
// ══════════════════════════════════════

/** Render the dashboard (kanban board) view. */
function renderDashboard() {
  mainContent.textContent = '';
  const container = el('div', { className: 'board-container', attrs: { id: 'board-container' } });

  if (state.projects.length === 0) {
    // Welcome empty state
    const welcome = el('div', { className: 'welcome-empty' });
    welcome.appendChild(el('div', { className: 'welcome-icon', text: '\uD83D\uDCCB', attrs: { 'aria-hidden': 'true' } }));
    welcome.appendChild(el('div', { className: 'welcome-text', text: '프로젝트를 추가하여 시작하세요' }));
    welcome.appendChild(el('div', { className: 'welcome-sub', text: '아래 버튼을 눌러 첫 프로젝트를 만들어 보세요' }));
    const addBtn = el('button', {
      className: 'welcome-add-btn',
      text: '+',
      attrs: { 'aria-label': '새 프로젝트 만들기' }
    });
    addBtn.addEventListener('click', showCreateProjectModal);
    welcome.appendChild(addBtn);
    container.appendChild(welcome);
  } else {
    initColumns();
    state.columns.forEach(colIds => {
      const column = el('div', { className: 'board-column' });
      colIds.forEach(id => {
        const project = state.projects.find(p => p.id === id);
        if (project) column.appendChild(renderProjectLane(project));
      });
      container.appendChild(column);
    });
  }

  mainContent.appendChild(container);
}

/**
 * Render a project lane with cards.
 * @param {object} project
 * @returns {HTMLElement}
 */
function renderProjectLane(project) {
  const { total, done, percent } = getProjectProgress(project);
  const lane = el('div', { className: 'project-lane', attrs: { 'data-project-id': project.id } });

  // Color bar
  const colorBar = el('div', { className: 'lane-color-bar', style: { background: project.color } });
  lane.appendChild(colorBar);

  // Header
  const header = el('div', { className: 'lane-header' });
  const headerTop = el('div', { className: 'lane-header-top' });

  const nameSpan = el('span', { className: 'lane-name', text: project.name });
  nameSpan.style.cursor = 'pointer';
  nameSpan.setAttribute('role', 'button');
  nameSpan.setAttribute('tabindex', '0');
  nameSpan.setAttribute('aria-label', `${project.name} 포커스 뷰로 전환`);
  const goFocus = () => {
    focusedProjectId = project.id;
    activeView = VIEWS.FOCUS;
    renderAll();
    saveState();
  };
  nameSpan.addEventListener('click', e => { e.stopPropagation(); goFocus(); });
  nameSpan.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goFocus(); } });

  const menuBtn = el('button', { className: 'lane-menu-btn', text: '\u22EF', attrs: { 'aria-label': '프로젝트 메뉴', 'aria-haspopup': 'true' } });
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (openDropdownId === project.id) closeAllPopups(); else showLaneDropdown(project.id, menuBtn);
  });

  headerTop.append(nameSpan, menuBtn);

  const progressRow = el('div', { className: 'lane-progress' });
  const pBar = el('div', {
    className: 'lane-progress-bar',
    attrs: { role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `${project.name} 진행률` }
  });
  pBar.appendChild(el('div', { className: 'lane-progress-fill', style: { width: percent + '%', background: progressColor(percent) } }));
  progressRow.append(pBar, el('span', { className: 'lane-progress-text', text: `${done}/${total}` }));

  header.append(headerTop, progressRow);
  lane.appendChild(header);

  // Mouse-based drag to reorder (column-aware)
  function initDrag(startX, startY) {
    const boardContainer = lane.closest('.board-container');
    if (!boardContainer) return;
    const laneRect = lane.getBoundingClientRect();
    const offsetX = startX - laneRect.left;
    const offsetY = startY - laneRect.top;

    // Create a floating ghost clone
    const ghost = lane.cloneNode(true);
    ghost.style.position = 'fixed';
    ghost.style.left = laneRect.left + 'px';
    ghost.style.top = laneRect.top + 'px';
    ghost.style.width = laneRect.width + 'px';
    ghost.style.zIndex = '1000';
    ghost.style.pointerEvents = 'none';
    ghost.style.boxShadow = '0 12px 40px rgba(0,0,0,0.25)';
    ghost.style.opacity = '0.9';
    ghost.style.transition = 'none';
    ghost.classList.add('lane-dragging');
    document.body.appendChild(ghost);

    lane.classList.add('lane-dragging');
    let lastDropTarget = null;
    let lastDropPosition = null;

    function onMove(cx, cy) {
      ghost.style.left = (cx - offsetX) + 'px';
      ghost.style.top = (cy - offsetY) + 'px';

      clearDropIndicators();
      const lanes = boardContainer.querySelectorAll('.project-lane:not(.lane-dragging)');
      let closestLane = null;
      let closestDist = Infinity;

      lanes.forEach(targetLane => {
        const rect = targetLane.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dist = Math.hypot(cx - centerX, cy - centerY);
        if (dist < closestDist) {
          closestDist = dist;
          closestLane = targetLane;
        }
      });

      if (closestLane) {
        const rect = closestLane.getBoundingClientRect();
        const distLeft = Math.abs(cx - rect.left);
        const distRight = Math.abs(cx - rect.right);
        const distTop = Math.abs(cy - rect.top);
        const distBottom = Math.abs(cy - rect.bottom);
        const minDist = Math.min(distLeft, distRight, distTop, distBottom);

        let direction;
        if (minDist === distTop) direction = 'top';
        else if (minDist === distBottom) direction = 'bottom';
        else if (minDist === distLeft) direction = 'left';
        else direction = 'right';

        lastDropTarget = closestLane.dataset.projectId;
        lastDropPosition = direction;

        const targetColumn = closestLane.closest('.board-column');
        const indicator = el('div', { className: 'lane-drop-indicator' });

        if (direction === 'left' || direction === 'right') {
          indicator.classList.add('vertical');
          indicator.style.height = targetColumn.offsetHeight + 'px';
          if (direction === 'left') {
            boardContainer.insertBefore(indicator, targetColumn);
          } else {
            if (targetColumn.nextSibling) {
              boardContainer.insertBefore(indicator, targetColumn.nextSibling);
            } else {
              boardContainer.appendChild(indicator);
            }
          }
        } else {
          indicator.classList.add('horizontal');
          if (direction === 'top') {
            targetColumn.insertBefore(indicator, closestLane);
          } else {
            if (closestLane.nextElementSibling) {
              targetColumn.insertBefore(indicator, closestLane.nextElementSibling);
            } else {
              targetColumn.appendChild(indicator);
            }
          }
        }
      } else {
        lastDropTarget = null;
        lastDropPosition = null;
      }
    }

    function onEnd() {
      ghost.remove();
      lane.classList.remove('lane-dragging');
      clearDropIndicators();
      if (lastDropTarget && lastDropTarget !== project.id) {
        reorderProject(project.id, lastDropTarget, lastDropPosition);
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    }

    function onMouseMove(e) { e.preventDefault(); onMove(e.clientX, e.clientY); }
    function onMouseUp() { onEnd(); }
    function onTouchMove(e) { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }
    function onTouchEnd() { onEnd(); }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }

  // Drag from header area (excluding interactive elements)
  header.addEventListener('mousedown', e => {
    if (e.target.closest('.lane-menu-btn') || e.target.closest('.lane-name') || e.target.closest('.lane-name-input')) return;
    e.preventDefault();
    initDrag(e.clientX, e.clientY);
  });
  header.addEventListener('touchstart', e => {
    if (e.target.closest('.lane-menu-btn') || e.target.closest('.lane-name') || e.target.closest('.lane-name-input')) return;
    const t = e.touches[0];
    initDrag(t.clientX, t.clientY);
  }, { passive: true });

  // Drag from color bar
  colorBar.addEventListener('mousedown', e => { e.preventDefault(); initDrag(e.clientX, e.clientY); });
  colorBar.addEventListener('touchstart', e => { initDrag(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });

  // Card list
  const cardList = el('div', { className: 'card-list' });
  const sorted = sortCards(project.cards);

  if (sorted.length === 0) {
    cardList.appendChild(el('div', { className: 'card-list-empty', text: '카드를 추가해 주세요' }));
  } else {
    sorted.forEach(card => {
      cardList.appendChild(renderCardDOM(card, project.id, project.color));
    });
  }

  attachCardListEvents(cardList);
  lane.appendChild(cardList);

  // Quick add
  lane.appendChild(buildQuickAdd(project.id));

  return lane;
}

// ══════════════════════════════════════
//  Focus View
// ══════════════════════════════════════

/** Render the focus (single project expanded) view. */
function renderFocusView() {
  const project = state.projects.find(p => p.id === focusedProjectId);
  if (!project) { activeView = VIEWS.DASHBOARD; renderDashboard(); return; }

  const { total, done, percent } = getProjectProgress(project);
  mainContent.textContent = '';

  const view = el('div', { className: 'focus-view' });

  // Header
  const header = el('div', { className: 'focus-header' });
  const backBtn = el('button', { className: 'focus-back', text: '\u2190 대시보드', attrs: { 'aria-label': '대시보드로 돌아가기' } });
  backBtn.addEventListener('click', () => { activeView = VIEWS.DASHBOARD; focusedProjectId = null; renderAll(); saveState(); });
  header.appendChild(backBtn);

  const titleRow = el('div', { className: 'focus-title' });
  titleRow.append(
    el('div', { className: 'focus-color-bar', style: { background: project.color } }),
    el('h2', { className: 'focus-name', text: project.name })
  );
  header.appendChild(titleRow);

  const progressRow = el('div', { className: 'focus-progress' });
  const pBar = el('div', {
    className: 'focus-progress-bar',
    attrs: { role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': '프로젝트 진행률' }
  });
  pBar.appendChild(el('div', { className: 'focus-progress-fill', style: { width: percent + '%', background: progressColor(percent) } }));
  progressRow.append(pBar, el('span', { className: 'focus-progress-text', text: `${done}/${total} 완료 (${percent}%)` }));
  header.appendChild(progressRow);

  view.appendChild(header);

  // Cards
  const cardsContainer = el('div', { className: 'focus-cards' });
  const sorted = sortCards(project.cards);

  if (sorted.length === 0) {
    cardsContainer.appendChild(el('div', { className: 'card-list-empty', text: '카드를 추가해 주세요' }));
  } else {
    sorted.forEach(card => {
      cardsContainer.appendChild(renderCardDOM(card, project.id, project.color));
    });
  }

  attachCardListEvents(cardsContainer);
  view.appendChild(cardsContainer);

  // Quick add
  view.appendChild(buildQuickAdd(project.id));

  mainContent.appendChild(view);
}

// ══════════════════════════════════════
//  Today View
// ══════════════════════════════════════

/** Render the "today" view (overdue + today's tasks + undated tasks). */
function renderTodayView() {
  mainContent.textContent = '';
  const view = el('div', { className: 'list-view' });
  const today = todayTs();

  view.appendChild(el('h2', { className: 'list-view-title', text: '\uD83D\uDCCB 오늘의 할 일 \u2014 ' + formatDateKR(new Date().toISOString()) }));

  // Collect cards
  const overdue = [];
  const byProject = new Map();

  state.projects.forEach(project => {
    project.cards.forEach(card => {
      if (card.completed) return;

      const isOverdue = card.dueDate && dateTs(card.dueDate) < today;
      const isToday = card.dueDate && dateTs(card.dueDate) === today;
      const isNoDueTask = !card.dueDate && (card.type === CARD_TYPES.TASK || card.type === CARD_TYPES.NOTE);

      if (isOverdue) {
        overdue.push({ card, project });
      }
      if (isToday || isNoDueTask) {
        if (!byProject.has(project.id)) byProject.set(project.id, { project, cards: [] });
        byProject.get(project.id).cards.push(card);
      }
    });
  });

  const hasContent = overdue.length > 0 || byProject.size > 0;

  if (!hasContent) {
    view.appendChild(el('div', { className: 'list-view-empty', children: [
      el('span', { className: 'list-view-empty-icon', text: '\uD83C\uDF89' }),
      el('span', { text: '오늘 할 일이 없습니다' })
    ]}));
    mainContent.appendChild(view);
    return;
  }

  // Overdue group
  if (overdue.length > 0) {
    const group = el('div', { className: 'list-group' });
    group.appendChild(el('div', { className: 'list-group-header overdue', text: `\u26A0\uFE0F 지연 (${overdue.length}개)` }));
    const listEl = el('div');
    overdue.forEach(({ card, project }) => {
      listEl.appendChild(renderCardDOM(card, project.id, project.color, project.name));
    });
    attachCardListEvents(listEl);
    group.appendChild(listEl);
    view.appendChild(group);
  }

  // Project groups
  byProject.forEach(({ project, cards }) => {
    const group = el('div', { className: 'list-group' });
    const header = el('div', { className: 'list-group-header project-group' });
    header.append(
      el('span', { className: 'list-group-dot', style: { background: project.color } }),
      el('span', { text: project.name })
    );
    group.appendChild(header);

    const listEl = el('div');
    cards.forEach(card => {
      listEl.appendChild(renderCardDOM(card, project.id, project.color));
    });
    attachCardListEvents(listEl);
    group.appendChild(listEl);
    view.appendChild(group);
  });

  mainContent.appendChild(view);
}

// ══════════════════════════════════════
//  Schedule View
// ══════════════════════════════════════

/** Render the schedule (upcoming dates timeline) view. */
function renderScheduleView() {
  mainContent.textContent = '';
  const view = el('div', { className: 'list-view' });
  const today = todayTs();

  view.appendChild(el('h2', { className: 'list-view-title', text: '\uD83D\uDCC5 다가오는 일정' }));

  // Collect all cards with dueDate, incomplete
  const items = [];
  state.projects.forEach(project => {
    project.cards.forEach(card => {
      if (card.completed || !card.dueDate) return;
      items.push({ card, project });
    });
  });

  items.sort((a, b) => dateTs(a.card.dueDate) - dateTs(b.card.dueDate));

  if (items.length === 0) {
    view.appendChild(el('div', { className: 'list-view-empty', children: [
      el('span', { className: 'list-view-empty-icon', text: '\uD83D\uDCED' }),
      el('span', { text: '예정된 일정이 없습니다' })
    ]}));
    mainContent.appendChild(view);
    return;
  }

  // Group by date
  const groups = new Map();
  items.forEach(item => {
    const key = item.card.dueDate;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  groups.forEach((groupItems, dateKey) => {
    const group = el('div', { className: 'list-group' });
    const ts = dateTs(dateKey);

    let headerCls, headerText;
    if (ts < today) {
      headerCls = 'list-group-header overdue';
      headerText = `\u26A0\uFE0F 지연 \u2014 ${formatShortDate(dateKey)}`;
    } else if (ts === today) {
      headerCls = 'list-group-header today-group';
      headerText = `\uD83D\uDCCD 오늘 \u2014 ${formatShortDate(dateKey)}`;
    } else {
      headerCls = 'list-group-header date-group';
      headerText = formatShortDate(dateKey);
    }

    group.appendChild(el('div', { className: headerCls, text: headerText }));

    const listEl = el('div');
    groupItems.forEach(({ card, project }) => {
      listEl.appendChild(renderCardDOM(card, project.id, project.color, project.name));
    });
    attachCardListEvents(listEl);
    group.appendChild(listEl);
    view.appendChild(group);
  });

  mainContent.appendChild(view);
}

// ══════════════════════════════════════
//  Search
// ══════════════════════════════════════

/**
 * Render search results filtered by query.
 * @param {string} query
 */
function renderSearchResults(query) {
  mainContent.textContent = '';
  const q = query.trim();

  if (!q) {
    activeView = viewBeforeSearch;
    renderAll();
    return;
  }

  const view = el('div', { className: 'search-view' });
  view.appendChild(el('div', { className: 'search-view-title', text: `"${q}" 검색 결과` }));

  const qLower = q.toLowerCase();
  const byProject = new Map();
  let totalResults = 0;

  state.projects.forEach(project => {
    const matches = project.cards.filter(c => c.content.toLowerCase().includes(qLower));
    if (matches.length > 0) {
      byProject.set(project.id, { project, cards: matches });
      totalResults += matches.length;
    }
  });

  if (totalResults === 0) {
    view.appendChild(el('div', { className: 'list-view-empty', children: [
      el('span', { className: 'list-view-empty-icon', text: '\uD83D\uDD0D' }),
      el('span', { text: `'${q}'에 대한 검색 결과가 없습니다` })
    ]}));
    mainContent.appendChild(view);
    return;
  }

  byProject.forEach(({ project, cards }) => {
    const group = el('div', { className: 'list-group' });
    const header = el('div', { className: 'list-group-header project-group' });
    header.append(
      el('span', { className: 'list-group-dot', style: { background: project.color } }),
      el('span', { text: `${project.name} (${cards.length})` })
    );
    group.appendChild(header);

    const listEl = el('div');
    cards.forEach(card => {
      listEl.appendChild(renderCardDOM(card, project.id, project.color, null, q));
    });
    attachCardListEvents(listEl);
    group.appendChild(listEl);
    view.appendChild(group);
  });

  mainContent.appendChild(view);
}

// ══════════════════════════════════════
//  Summary Bar
// ══════════════════════════════════════

/** Update the global summary progress bar and project dots. */
function renderSummaryBar() {
  const { total, done, percent } = getOverallProgress();
  summaryFill.style.width = percent + '%';
  summaryFill.style.background = progressColor(percent);
  summaryText.textContent = `완료 ${done} / 전체 ${total} \u2014 ${percent}%`;

  if (summaryProgressBar) {
    summaryProgressBar.setAttribute('aria-valuenow', String(percent));
  }

  projectDots.textContent = '';
  state.projects.forEach(project => {
    const dot = el('div', { className: 'project-dot', children: [
      el('div', { className: 'project-dot-circle', style: { background: project.color } }),
      el('span', { className: 'project-dot-name', text: project.name })
    ]});
    projectDots.appendChild(dot);
  });
}

// ══════════════════════════════════════
//  Archive
// ══════════════════════════════════════

/** Render the archive section (hidden when empty). */
function renderArchive() {
  archiveCountEl.textContent = state.archive.length;

  // Hide entire section when no archives
  if (state.archive.length === 0) {
    archiveSection.hidden = true;
    return;
  }
  archiveSection.hidden = false;

  archiveToggle.setAttribute('aria-expanded', String(archiveOpen));
  archiveArrow.classList.toggle('open', archiveOpen);
  archiveList.classList.toggle('open', archiveOpen);
  archiveList.textContent = '';

  state.archive.forEach(project => {
    const { percent } = getProjectProgress(project);
    const item = el('div', { className: 'archive-item' });
    item.appendChild(el('div', { className: 'archive-item-color', style: { background: project.color } }));

    const info = el('div', { className: 'archive-item-info' });
    info.append(
      el('div', { className: 'archive-item-name', text: project.name }),
      el('div', { className: 'archive-item-meta', text: `카드 ${project.cards.length}개 \u00B7 진행률 ${percent}%` })
    );

    const actions = el('div', { className: 'archive-item-actions' });
    const restoreBtn = el('button', { className: 'archive-restore-btn', text: '복원', attrs: { 'aria-label': `${project.name} 복원` } });
    restoreBtn.addEventListener('click', () => restoreProject(project.id));
    const delBtn = el('button', { className: 'archive-delete-btn', text: '완전 삭제', attrs: { 'aria-label': `${project.name} 완전 삭제` } });
    delBtn.addEventListener('click', () => showDeleteProjectModal(project, true));
    actions.append(restoreBtn, delBtn);

    item.append(info, actions);
    archiveList.appendChild(item);
  });
}

// ══════════════════════════════════════
//  Global Event Listeners
// ══════════════════════════════════════

// View tabs
document.querySelector('.view-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.view-tab');
  if (!btn) return;
  activeView = btn.dataset.view;
  focusedProjectId = null;
  searchInput.value = '';
  renderAll();
  saveState();
});

// Settings button
document.getElementById('settings-btn').addEventListener('click', showSettingsModal);

// Add project button
document.getElementById('add-project-btn').addEventListener('click', showCreateProjectModal);

// Archive toggle
archiveToggle.addEventListener('click', () => {
  archiveOpen = !archiveOpen;
  renderArchive();
});

// Storage warning close
document.getElementById('storage-warning-close').addEventListener('click', () => {
  storageWarning.hidden = true;
});

// Close popups on outside click
document.addEventListener('click', e => {
  if (openDropdownId && !e.target.closest('.lane-dropdown') && !e.target.closest('.lane-menu-btn')) closeAllPopups();
  if (!e.target.closest('.color-popover') && !e.target.closest('.lane-menu-btn')) {
    document.querySelectorAll('.color-popover').forEach(n => n.remove());
  }
});

// Modal overlay click + Escape
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (modalOverlay.classList.contains('open')) closeModal();
    else closeAllPopups();
  }
});

// Search with debounce
const debouncedSearch = debounce(query => {
  if (query.trim()) {
    if (activeView !== VIEWS.SEARCH) viewBeforeSearch = activeView;
    activeView = VIEWS.SEARCH;
    renderAll();
  } else {
    activeView = viewBeforeSearch;
    renderAll();
    saveState();
  }
}, DEBOUNCE_DELAY);

const searchClear = document.getElementById('search-clear');
const searchBox = searchInput.closest('.search-box');

// 검색 아이콘 클릭 → 검색창 열기 (모바일에서 오버레이)
searchBox.addEventListener('click', e => {
  if (!searchBox.classList.contains('active') && !e.target.closest('input')) {
    searchBox.classList.add('active');
    requestAnimationFrame(() => searchInput.focus());
  }
});

// 입력 시 X 버튼 표시 + 검색 실행
searchInput.addEventListener('input', () => {
  searchClear.classList.toggle('visible', !!searchInput.value);
  debouncedSearch(searchInput.value);
});

// X 버튼 → 검색 닫기
searchClear.addEventListener('click', e => {
  e.stopPropagation();
  searchInput.value = '';
  searchClear.classList.remove('visible');
  searchBox.classList.remove('active');
  activeView = viewBeforeSearch || VIEWS.DASHBOARD;
  renderAll();
  saveState();
});

// 모바일 프로젝트 추가 버튼
document.getElementById('mobile-add-btn').addEventListener('click', showCreateProjectModal);

// ══════════════════════════════════════
//  Init
// ══════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // 상단 오늘 날짜 표시
  const navbarDate = document.getElementById('navbar-date');
  if (navbarDate) {
    navbarDate.textContent = formatDateKR(new Date().toISOString());
  }

  // localStorage에서 즉시 로드 (빠른 첫 렌더링)
  loadState();
  renderAll();

  // Auth + Sync 버튼 이벤트 바인딩
  document.getElementById('login-btn').addEventListener('click', signInWithGoogle);
  document.getElementById('logout-btn').addEventListener('click', signOutUser);
  document.getElementById('sync-btn').addEventListener('click', syncFromCloud);

  // Auth 상태 리스너
  auth.onAuthStateChanged(async (user) => {
    console.log('[Auth] 상태 변경:', user ? user.email : '로그아웃');
    currentUser = user || null;
    updateAuthUI(user);
    if (user) {
      // 로그인 시 무조건 Firestore 데이터 우선 적용
      await loadFromFirestore(true);
    } else {
      // 로그아웃 시 localStorage에서 다시 로드
      loadState();
      renderAll();
    }
  });

  // 페이지 닫기 전 미저장 데이터 즉시 Firestore에 저장
  window.addEventListener('beforeunload', flushFirestoreSave);
});
