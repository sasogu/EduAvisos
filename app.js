/*
  EduNotas — Avisos (HTML5 + localStorage)
  - 12 clases (configurable)
  - Click en alumno: suma +1 aviso negativo
  - Botón +Pos: suma +1 aviso positivo
  - Importación local por texto/archivo
*/

const APP_KEY = "edunotas_asistencia_v1";

/** @typedef {{ ts: number, type: "neg"|"pos", delta: number }} StudentEvent */
/** @typedef {{ id: string, name: string, marked?: boolean, count: number, positiveCount?: number, negExpiresAt?: number, negSpentMs?: number, history?: StudentEvent[] }} Student */
/** @typedef {{ classes: Record<string, { name: string, students: Student[] }>, ui?: { minCountByClass?: Record<string, number>, minPositiveByClass?: Record<string, number>, timerRunning?: boolean, timerFrozenAt?: number, negMinutesPerPoint?: number, posMinutesPerPoint?: number, lastTickNow?: number } }} AppState */

const DEFAULT_NEG_MINUTES_PER_POINT = 5;
const DEFAULT_POS_MINUTES_PER_POINT = 5;

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** @returns {AppState} */
function defaultState() {
  /** @type {Record<string, { name: string, students: Student[] }>} */
  const classes = {};
  for (let i = 1; i <= 12; i++) {
    const id = `clase_${String(i).padStart(2, "0")}`;
    classes[id] = { name: `Clase ${i}`, students: [] };
  }
  return {
    classes,
    ui: {
      minCountByClass: {},
      minPositiveByClass: {},
      timerRunning: false,
      timerFrozenAt: Date.now(),
      negMinutesPerPoint: DEFAULT_NEG_MINUTES_PER_POINT,
      posMinutesPerPoint: DEFAULT_POS_MINUTES_PER_POINT,
      lastTickNow: Date.now(),
    },
  };
}

/** @returns {AppState} */
function loadState() {
  const raw = localStorage.getItem(APP_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultState();
    if (!parsed.classes || typeof parsed.classes !== "object") return defaultState();
    // Migración suave: añade campos nuevos si faltan.
    /** @type {AppState} */
    const migrated = parsed;
    if (!migrated.ui) migrated.ui = { minCountByClass: {} };
    if (!migrated.ui.minCountByClass) migrated.ui.minCountByClass = {};
    if (!migrated.ui.minPositiveByClass) migrated.ui.minPositiveByClass = {};
    if (typeof migrated.ui.timerRunning !== "boolean") migrated.ui.timerRunning = false;
    if (typeof migrated.ui.timerFrozenAt !== "number" || !Number.isFinite(migrated.ui.timerFrozenAt)) {
      migrated.ui.timerFrozenAt = Date.now();
    }
    if (typeof migrated.ui.negMinutesPerPoint !== "number" || !Number.isFinite(migrated.ui.negMinutesPerPoint)) {
      migrated.ui.negMinutesPerPoint = DEFAULT_NEG_MINUTES_PER_POINT;
    }
    if (typeof migrated.ui.posMinutesPerPoint !== "number" || !Number.isFinite(migrated.ui.posMinutesPerPoint)) {
      migrated.ui.posMinutesPerPoint = DEFAULT_POS_MINUTES_PER_POINT;
    }
    if (typeof migrated.ui.lastTickNow !== "number" || !Number.isFinite(migrated.ui.lastTickNow)) {
      migrated.ui.lastTickNow = Date.now();
    }

    for (const classId of Object.keys(migrated.classes)) {
      const cls = migrated.classes[classId];
      if (!cls || !Array.isArray(cls.students)) continue;
      for (const s of cls.students) {
        if (typeof s.count !== "number") s.count = 0;
        if (typeof s.positiveCount !== "number") s.positiveCount = 0;
        if (typeof s.marked !== "boolean") s.marked = false;
        if (typeof s.negSpentMs !== "number" || !Number.isFinite(s.negSpentMs) || s.negSpentMs < 0) s.negSpentMs = 0;
        if (!Array.isArray(s.history)) s.history = [];

        // Migración: si existe negExpiresAt (modelo antiguo), conviértelo a negSpentMs aproximado.
        if (typeof s.negExpiresAt === "number" && Number.isFinite(s.negExpiresAt) && (s.count ?? 0) > 0) {
          const now = Date.now();
          const remaining = Math.max(0, s.negExpiresAt - now);
          const negMsPerPoint = Math.max(0, Math.floor(migrated.ui.negMinutesPerPoint) || 0) * 60 * 1000;
          const total = Math.max(0, (s.count ?? 0) * negMsPerPoint);
          s.negSpentMs = Math.max(0, total - remaining);
        }
        // Deja el campo antiguo sin uso.
        if (typeof s.negExpiresAt !== "number") s.negExpiresAt = undefined;
      }
    }

    return migrated;
  } catch {
    return defaultState();
  }
}

/** @param {Student} student @param {StudentEvent["type"]} type */
function pushHistory(student, type) {
  if (!Array.isArray(student.history)) student.history = [];
  student.history.push({ ts: Date.now(), type, delta: 1 });
}

function getNegMsPerPoint() {
  const minutes = Number(state.ui?.negMinutesPerPoint);
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : DEFAULT_NEG_MINUTES_PER_POINT;
  return m * 60 * 1000;
}

function getPosMsPerPoint() {
  const minutes = Number(state.ui?.posMinutesPerPoint);
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : DEFAULT_POS_MINUTES_PER_POINT;
  return m * 60 * 1000;
}

function getEffectiveNow() {
  const running = Boolean(state?.ui?.timerRunning);
  if (running) return Date.now();
  const frozen = state?.ui?.timerFrozenAt;
  return typeof frozen === "number" && Number.isFinite(frozen) ? frozen : Date.now();
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Expiración efectiva del temporizador negativo.
 * - Base: cada ☹︎ suma 5 min (negExpiresAt)
 * - Si el alumno tiene ☹︎, cada 🙂 resta 5 min
 * - Nunca puede quedar por debajo de 0 (se considera expirado)
 * @param {Student} student
 */
function getEffectiveNegExpiresAt(student) {
  if (typeof student.negExpiresAt !== "number") return undefined;

  const hasNeg = (student.count ?? 0) > 0;
  if (!hasNeg) return student.negExpiresAt;

  const pos = Math.max(0, Math.floor(student.positiveCount ?? 0));
  const adjusted = student.negExpiresAt - pos * NEG_MS_PER_POINT;
  return adjusted;
}

/** @param {Student} student */
function addNegativePoint(student) {
  const now = getEffectiveNow();
  const prev = student.count ?? 0;
  student.count = prev + 1;

  pushHistory(student, "neg");

  // Si empieza una "racha" nueva de negativos, reinicia el tiempo consumido.
  if (prev <= 0) {
    student.negSpentMs = 0;
  }

  // El tiempo restante se calcula con: count*negMs - spent - pos*posMs.
  // No necesitamos tocar negExpiresAt aquí.
  void now;
}

/** @param {Student} student */
function getNegativeRemainingMs(student) {
  const neg = Math.max(0, Math.floor(student.count ?? 0));
  if (neg <= 0) return 0;

  const spent = Math.max(0, Number(student.negSpentMs) || 0);
  const totalNegMs = neg * getNegMsPerPoint();

  const pos = Math.max(0, Math.floor(student.positiveCount ?? 0));
  const totalPosMs = pos * getPosMsPerPoint();

  return Math.max(0, totalNegMs - spent - totalPosMs);
}

/** @param {{ students: Student[] }} cls */
function expireNegativesIfNeeded(cls) {
  const now = getEffectiveNow();
  let changed = false;

  for (const s of cls.students) {
    const remaining = getNegativeRemainingMs(s);
    if (remaining > 0) continue;

    if ((s.count ?? 0) !== 0) {
      s.count = 0;
      s.negSpentMs = 0;
      changed = true;
    }

    // Nota: no tocamos positiveCount; solo limpia el efecto de negativos.
  }

  return changed;
}

/** @param {AppState} state */
function saveState(state) {
  localStorage.setItem(APP_KEY, JSON.stringify(state));
}

/**
 * Normaliza texto importado.
 * Acepta:
 * - 1 alumno por línea
 * - CSV simple: usa la primera columna antes de ';' o ','
 */
function parseNames(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // CSV simple
      const first = line.split(/[;,]/)[0].trim();
      return first;
    })
    .filter(Boolean);
}

/**
 * Carga pdf.js (CDN o local) y lo deja listo para usar.
 * @returns {Promise<any>}
 */
async function ensurePdfJsLoaded() {
  // @ts-ignore
  if (window.pdfjsLib) return window.pdfjsLib;

  const sources = [
    {
      name: "cdnjs",
      script: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    },
    {
      name: "local",
      script: "vendor/pdf.min.js",
      worker: "vendor/pdf.worker.min.js",
    },
  ];

  /** @param {string} url */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`No se pudo cargar pdf.js: ${url}`));
      document.head.appendChild(s);
    });
  }

  let lastError;
  for (const src of sources) {
    try {
      await loadScript(src.script);
      // @ts-ignore
      const pdfjsLib = window.pdfjsLib;
      if (!pdfjsLib) throw new Error("pdf.js cargo pero no expuso pdfjsLib");
      pdfjsLib.GlobalWorkerOptions.workerSrc = src.worker;
      return pdfjsLib;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    "No se pudo cargar pdf.js. Revisa la conexion o coloca pdf.min.js y pdf.worker.min.js en /vendor."
  );
}

/** @param {File} file */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("No se pudo leer el archivo"));
    r.onload = () => resolve(r.result);
    r.readAsArrayBuffer(file);
  });
}

/**
 * Extrae texto de un PDF (todas las páginas).
 * @param {File} file
 * @returns {Promise<string>}
 */
async function extractTextFromPdf(file) {
  const pdfjsLib = await ensurePdfJsLoaded();
  const buf = /** @type {ArrayBuffer} */ (await readFileAsArrayBuffer(file));
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdf = await loadingTask.promise;

  const parts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items
      .map((it) => (typeof it?.str === "string" ? it.str : ""))
      .filter(Boolean);
    parts.push(strings.join("\n"));
  }
  return parts.join("\n");
}

/**
 * Extracción de nombres desde el texto del PDF.
 * @param {string} text
 */
function parseNamesFromPdfText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  /** @type {string[]} */
  const candidates = [];

  // 1) "Apellido, Nombre" -> "Nombre Apellido"
  for (const l of lines) {
    if (!l.includes(",")) continue;
    const parts = l.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const name = `${parts[1]} ${parts[0]}`.replace(/\s+/g, " ").trim();
    if (name) candidates.push(name);
  }

  // 2) "Nombre Apellido" (2-4 palabras con inicial mayúscula)
  const nameWord = "[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+";
  const re = new RegExp(`^${nameWord}(?:[ \\-]${nameWord}){1,3}$`);
  for (let l of lines) {
    l = l.replace(/[•·\t]+/g, " ");
    l = l.replace(/\s*[-–—].*$/, "");
    l = l.replace(/\(.*?\)$/, "").trim();
    if (re.test(l)) candidates.push(l);
  }

  return dedupeNames(candidates);
}

function dedupeNames(names) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const n of names) {
    const key = n.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node;
}

const classSelect = /** @type {HTMLSelectElement} */ (el("classSelect"));
const classNameInput = /** @type {HTMLInputElement} */ (el("className"));
const saveClassNameBtn = /** @type {HTMLButtonElement} */ (el("saveClassNameBtn"));
const resetClassBtn = /** @type {HTMLButtonElement} */ (el("resetClassBtn"));
const timerPlayBtn = /** @type {HTMLButtonElement} */ (el("timerPlayBtn"));
const timerPauseBtn = /** @type {HTMLButtonElement} */ (el("timerPauseBtn"));
const importTextarea = /** @type {HTMLTextAreaElement} */ (el("importTextarea"));
const importFile = /** @type {HTMLInputElement} */ (el("importFile"));
const importPdf = /** @type {HTMLInputElement} */ (el("importPdf"));
const importApplyBtn = /** @type {HTMLButtonElement} */ (el("importApplyBtn"));
const importClearBtn = /** @type {HTMLButtonElement} */ (el("importClearBtn"));
const openImportBtn = /** @type {HTMLButtonElement} */ (el("openImportBtn"));
const importDialog = /** @type {HTMLDialogElement} */ (el("importDialog"));
const closeImportBtn = /** @type {HTMLButtonElement} */ (el("closeImportBtn"));
const exportBackupBtn = /** @type {HTMLButtonElement} */ (el("exportBackupBtn"));
const importBackupFile = /** @type {HTMLInputElement} */ (el("importBackupFile"));
const importBackupBtn = /** @type {HTMLButtonElement} */ (el("importBackupBtn"));
const timerDialog = /** @type {HTMLDialogElement} */ (el("timerDialog"));
const closeTimerBtn = /** @type {HTMLButtonElement} */ (el("closeTimerBtn"));
const timerStudentList = /** @type {HTMLUListElement} */ (el("timerStudentList"));
const timerEmpty = /** @type {HTMLDivElement} */ (el("timerEmpty"));
const historyDialog = /** @type {HTMLDialogElement} */ (el("historyDialog"));
const closeHistoryBtn = /** @type {HTMLButtonElement} */ (el("closeHistoryBtn"));
const historySubtitle = /** @type {HTMLParagraphElement} */ (el("historySubtitle"));
const historyList = /** @type {HTMLUListElement} */ (el("historyList"));
const historyEmpty = /** @type {HTMLDivElement} */ (el("historyEmpty"));
const openClassHistoryBtn = /** @type {HTMLButtonElement} */ (el("openClassHistoryBtn"));
const classHistoryDialog = /** @type {HTMLDialogElement} */ (el("classHistoryDialog"));
const closeClassHistoryBtn = /** @type {HTMLButtonElement} */ (el("closeClassHistoryBtn"));
const classHistorySubtitle = /** @type {HTMLParagraphElement} */ (el("classHistorySubtitle"));
const classHistoryList = /** @type {HTMLUListElement} */ (el("classHistoryList"));
const classHistoryEmpty = /** @type {HTMLDivElement} */ (el("classHistoryEmpty"));
const studentList = /** @type {HTMLUListElement} */ (el("studentList"));
const emptyState = /** @type {HTMLDivElement} */ (el("emptyState"));
const status = /** @type {HTMLDivElement} */ (el("status"));
const minCountInput = /** @type {HTMLInputElement} */ (el("minCount"));
const minPositiveInput = /** @type {HTMLInputElement} */ (el("minPositive"));
const clearFilterBtn = /** @type {HTMLButtonElement} */ (el("clearFilterBtn"));
const negMinutesPerPointInput = /** @type {HTMLInputElement} */ (el("negMinutesPerPoint"));
const posMinutesPerPointInput = /** @type {HTMLInputElement} */ (el("posMinutesPerPoint"));

let state = loadState();
let selectedClassId = Object.keys(state.classes)[0] ?? "clase_01";

function getMinCountForSelectedClass() {
  const n = state.ui?.minCountByClass?.[selectedClassId];
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function getMinPositiveForSelectedClass() {
  const n = state.ui?.minPositiveByClass?.[selectedClassId];
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function setMinCountForSelectedClass(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (!state.ui) state.ui = { minCountByClass: {} };
  if (!state.ui.minCountByClass) state.ui.minCountByClass = {};
  state.ui.minCountByClass[selectedClassId] = n;
  saveState(state);
}

function setMinPositiveForSelectedClass(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (!state.ui) state.ui = { minCountByClass: {}, minPositiveByClass: {} };
  if (!state.ui.minPositiveByClass) state.ui.minPositiveByClass = {};
  state.ui.minPositiveByClass[selectedClassId] = n;
  saveState(state);
}

function setStatus(text) {
  status.textContent = text;
}

/**
 * Descarga un texto como archivo desde el navegador.
 * @param {string} filename
 * @param {string} content
 * @param {string} mime
 */
function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportBackup() {
  const raw = localStorage.getItem(APP_KEY);
  const payload = {
    app: "EduAvisos",
    version: 1,
    exportedAt: new Date().toISOString(),
    appKey: APP_KEY,
    state: raw ? JSON.parse(raw) : defaultState(),
  };
  const json = JSON.stringify(payload, null, 2);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  downloadTextFile(`eduavisos-backup-${ts}.json`, json, "application/json;charset=utf-8");
  setTransientStatus("Copia exportada");
}

/** @param {any} payload */
function extractStateFromBackupPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  // Formato recomendado: { state: AppState }
  if (payload.state && typeof payload.state === "object") return payload.state;
  // Compatibilidad: si el usuario importa directamente el AppState
  if (payload.classes && typeof payload.classes === "object") return payload;
  return null;
}

async function importBackupFromUi() {
  const file = importBackupFile.files?.[0];
  if (!file) {
    setTransientStatus("Selecciona un .json primero");
    return;
  }

  const ok = confirm(
    "Esto reemplazará TODOS tus datos (todas las clases) por la copia importada. ¿Continuar?"
  );
  if (!ok) return;

  const text = await readFileAsText(file);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    setTransientStatus("El archivo no es JSON válido", 4000);
    return;
  }

  const nextState = extractStateFromBackupPayload(parsed);
  if (!nextState) {
    setTransientStatus("Formato de copia no reconocido", 4000);
    return;
  }

  // Guardar y recargar UI
  localStorage.setItem(APP_KEY, JSON.stringify(nextState));
  state = loadState();
  selectedClassId = Object.keys(state.classes)[0] ?? "clase_01";
  renderClassSelect();
  renderClassNameInput();
  syncTimerControls();
  negMinutesPerPointInput.value = String(getNegMinutesPerPoint());
  posMinutesPerPointInput.value = String(getPosMinutesPerPoint());
  minCountInput.value = String(getMinCountForSelectedClass());
  minPositiveInput.value = String(getMinPositiveForSelectedClass());
  renderStudents();

  importBackupFile.value = "";
  setTransientStatus("Copia importada");
}

function setTransientStatus(text, ms = 2500) {
  setStatus(text);
  window.clearTimeout(setTransientStatus._t);
  setTransientStatus._t = window.setTimeout(() => setStatus(""), ms);
}
setTransientStatus._t = 0;

function clampMinutes(value, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function getNegMinutesPerPoint() {
  const v = state.ui?.negMinutesPerPoint;
  return clampMinutes(v, DEFAULT_NEG_MINUTES_PER_POINT);
}

function getPosMinutesPerPoint() {
  const v = state.ui?.posMinutesPerPoint;
  return clampMinutes(v, DEFAULT_POS_MINUTES_PER_POINT);
}

function setNegMinutesPerPoint(value) {
  if (!state.ui) state.ui = defaultState().ui;
  state.ui.negMinutesPerPoint = clampMinutes(value, DEFAULT_NEG_MINUTES_PER_POINT);
  saveState(state);
}

function setPosMinutesPerPoint(value) {
  if (!state.ui) state.ui = defaultState().ui;
  state.ui.posMinutesPerPoint = clampMinutes(value, DEFAULT_POS_MINUTES_PER_POINT);
  saveState(state);
}

function syncTimerControls() {
  const running = Boolean(state.ui?.timerRunning);
  timerPlayBtn.disabled = running;
  timerPauseBtn.disabled = !running;
}

function startGlobalTimer() {
  if (!state.ui) {
    state.ui = {
      minCountByClass: {},
      minPositiveByClass: {},
      timerRunning: false,
      timerFrozenAt: Date.now(),
      negMinutesPerPoint: DEFAULT_NEG_MINUTES_PER_POINT,
      posMinutesPerPoint: DEFAULT_POS_MINUTES_PER_POINT,
      lastTickNow: Date.now(),
    };
  }

  if (state.ui.timerRunning) return;

  const now = Date.now();
  const frozen =
    typeof state.ui.timerFrozenAt === "number" && Number.isFinite(state.ui.timerFrozenAt)
      ? state.ui.timerFrozenAt
      : now;

  const delta = now - frozen;
  if (delta > 0) {
    for (const classId of Object.keys(state.classes)) {
      const cls = state.classes[classId];
      if (!cls || !Array.isArray(cls.students)) continue;
      for (const s of cls.students) {
        if (typeof s.negExpiresAt !== "number") continue;
        s.negExpiresAt = s.negExpiresAt + delta;
      }
    }
  }

  state.ui.timerRunning = true;
  state.ui.timerFrozenAt = now;
  state.ui.lastTickNow = now;
  saveState(state);
  syncTimerControls();
  renderStudents();
  openTimerModalIfNeeded();
  setTransientStatus("Temporizador iniciado");
}

function pauseGlobalTimer() {
  if (!state.ui) {
    state.ui = {
      minCountByClass: {},
      minPositiveByClass: {},
      timerRunning: false,
      timerFrozenAt: Date.now(),
      negMinutesPerPoint: DEFAULT_NEG_MINUTES_PER_POINT,
      posMinutesPerPoint: DEFAULT_POS_MINUTES_PER_POINT,
      lastTickNow: Date.now(),
    };
  }
  if (!state.ui.timerRunning) return;

  state.ui.timerRunning = false;
  state.ui.timerFrozenAt = Date.now();
  state.ui.lastTickNow = state.ui.timerFrozenAt;
  saveState(state);
  syncTimerControls();
  renderStudents();
  setTransientStatus("Tiempo en pausa");
}

function renderTimerModal() {
  const cls = getSelectedClass();
  const withTime = cls.students
    .map((s) => ({ s, remainingMs: getNegativeRemainingMs(s) }))
    .filter((x) => x.remainingMs > 0)
    .sort((a, b) => b.remainingMs - a.remainingMs);

  timerStudentList.innerHTML = "";
  timerEmpty.hidden = withTime.length !== 0;

  for (const { s, remainingMs } of withTime) {
    const li = document.createElement("li");
    li.className = "item";

    const left = document.createElement("span");
    left.className = "left";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.name;
    left.appendChild(name);

    const right = document.createElement("span");
    right.className = "right";
    const t = document.createElement("span");
    t.className = "count";
    t.dataset.studentId = s.id;
    t.dataset.role = "timer-modal";
    t.textContent = `⏱ ${formatRemaining(remainingMs)}`;
    right.appendChild(t);

    li.appendChild(left);
    li.appendChild(right);
    timerStudentList.appendChild(li);
  }
}

function openTimerModalIfNeeded() {
  const cls = getSelectedClass();
  const hasAny = cls.students.some((s) => getNegativeRemainingMs(s) > 0);
  if (!hasAny) return;

  renderTimerModal();
  if (typeof timerDialog.showModal === "function") {
    timerDialog.showModal();
  } else {
    timerDialog.setAttribute("open", "");
  }
}


function getSelectedClass() {
  const cls = state.classes[selectedClassId];
  if (!cls) {
    // Si cambió la estructura, vuelve al default.
    state = defaultState();
    saveState(state);
    selectedClassId = Object.keys(state.classes)[0] ?? "clase_01";
    return state.classes[selectedClassId];
  }
  return cls;
}

function renderClassSelect() {
  const ids = Object.keys(state.classes);
  classSelect.innerHTML = "";
  for (const id of ids) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = state.classes[id].name;
    classSelect.appendChild(opt);
  }
  classSelect.value = selectedClassId;
}

function renderClassNameInput() {
  const cls = getSelectedClass();
  classNameInput.value = cls.name;
}

function saveClassName() {
  const cls = getSelectedClass();
  const next = (classNameInput.value ?? "").trim();
  if (!next) {
    alert("El nombre de la clase no puede estar vacío.");
    classNameInput.value = cls.name;
    return;
  }
  cls.name = next;
  saveState(state);
  renderClassSelect();
  renderClassNameInput();
  setStatus("Nombre de clase guardado");
}

function renderStudents() {
  const cls = getSelectedClass();

  // Primero expira lo que toque (para que el filtro/contadores sean correctos)
  if (expireNegativesIfNeeded(cls)) {
    saveState(state);
  }

  const total = cls.students.length;
  const minNeg = getMinCountForSelectedClass();
  const minPos = getMinPositiveForSelectedClass();
  const visibleStudents = cls.students.filter(
    (s) => (s.count ?? 0) >= minNeg && (s.positiveCount ?? 0) >= minPos
  );
  const visibleTotal = visibleStudents.length;

  if (!total) {
    setStatus("");
  } else if (minNeg > 0 || minPos > 0) {
    const parts = [];
    if (minNeg > 0) parts.push(`☹︎≥${minNeg}`);
    if (minPos > 0) parts.push(`🙂≥${minPos}`);
    setStatus(`Mostrando ${visibleTotal}/${total} (${parts.join(" · ")})`);
  } else {
    setStatus(`${total} alumnos`);
  }

  studentList.innerHTML = "";
  emptyState.hidden = total !== 0;

  if (total !== 0 && visibleTotal === 0) {
    // Estado vacío por filtro
    emptyState.hidden = false;
    const parts = [];
    if (minNeg > 0) parts.push(`☹︎ ≥ ${minNeg}`);
    if (minPos > 0) parts.push(`🙂 ≥ ${minPos}`);
    emptyState.textContent = `No hay alumnos que cumplan el filtro (${parts.join(" y ")}). Baja el filtro o suma avisos.`;
  } else {
    emptyState.textContent = "Aún no hay alumnos en esta clase. Importa una lista arriba.";
  }

  for (const student of visibleStudents) {
    const li = document.createElement("li");
    li.className = "item";

    const left = document.createElement("span");
    left.className = "left";

    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "nameBtn";
    nameBtn.setAttribute("aria-label", `Sumar +1 a ${student.name}`);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = student.name;

    nameBtn.addEventListener("click", () => {
      // Un click en el nombre siempre suma +1 aviso negativo.
      addNegativePoint(student);
      saveState(state);
      renderStudents();
    });

    nameBtn.appendChild(name);
    left.appendChild(nameBtn);

    const right = document.createElement("span");
    right.className = "right";

    const counts = document.createElement("span");
    counts.className = "countGroup";

    const negCount = document.createElement("span");
    negCount.className = "count";
    negCount.textContent = `☹︎ ${student.count ?? 0}`;
    negCount.setAttribute("aria-label", `Avisos negativos: ${student.count ?? 0}`);

    const timer = document.createElement("span");
    timer.className = "timer";

    const running = Boolean(state.ui?.timerRunning);
    const remainingMs = getNegativeRemainingMs(student);
    const icon = running ? "⏱" : "⏸";
    timer.textContent = `${icon} ${remainingMs > 0 ? formatRemaining(remainingMs) : "--:--"}`;
    timer.setAttribute("aria-label", "Tiempo restante por avisos negativos");

    timer.dataset.studentId = student.id;

    const posCount = document.createElement("span");
    posCount.className = "count";
    posCount.textContent = `🙂 ${student.positiveCount ?? 0}`;
    posCount.setAttribute("aria-label", `Avisos positivos: ${student.positiveCount ?? 0}`);

    const negBtn = document.createElement("button");
    negBtn.type = "button";
    negBtn.className = "miniBtn";
    negBtn.textContent = "+☹︎";
    negBtn.setAttribute("aria-label", `Sumar aviso negativo a ${student.name}`);

    negBtn.addEventListener("click", () => {
      addNegativePoint(student);
      saveState(state);
      renderStudents();
    });

    // Orden: botón +☹︎ junto al contador ☹︎ (a la izquierda)
    counts.appendChild(negBtn);
    counts.appendChild(negCount);
    counts.appendChild(timer);
    counts.appendChild(posCount);

    const posBtn = document.createElement("button");
    posBtn.type = "button";
    posBtn.className = "miniBtn";
    posBtn.textContent = "+🙂";
    posBtn.setAttribute("aria-label", `Sumar aviso positivo a ${student.name}`);

    posBtn.addEventListener("click", () => {
      student.positiveCount = (student.positiveCount ?? 0) + 1;
      pushHistory(student, "pos");
      saveState(state);
      renderStudents();
    });

    const historyBtn = document.createElement("button");
    historyBtn.type = "button";
    historyBtn.className = "miniBtn";
    historyBtn.textContent = "🕘";
    historyBtn.title = "Histórico";
    historyBtn.setAttribute("aria-label", `Ver histórico de ${student.name}`);
    historyBtn.addEventListener("click", () => {
      openHistoryModal(student);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "miniBtn";
    editBtn.textContent = "✏️";
    editBtn.title = "Editar";
    editBtn.setAttribute("aria-label", `Editar nombre: ${student.name}`);

    editBtn.addEventListener("click", () => {
      const cls = getSelectedClass();
      const next = prompt(`Nuevo nombre para ${student.name}:`, student.name);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) {
        alert("El nombre no puede estar vacío.");
        return;
      }

      const key = trimmed.toLocaleLowerCase();
      const clash = cls.students.some(
        (s) => s.id !== student.id && (s.name ?? "").toLocaleLowerCase() === key
      );
      if (clash) {
        alert("Ya existe un alumno con ese nombre en esta clase.");
        return;
      }

      student.name = trimmed;
      saveState(state);
      renderStudents();
      setTransientStatus("Nombre actualizado");
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "miniBtn miniBtn--danger";
    deleteBtn.textContent = "🗑️";
    deleteBtn.title = "Eliminar";
    deleteBtn.setAttribute("aria-label", `Eliminar alumno: ${student.name}`);

    deleteBtn.addEventListener("click", () => {
      const cls = getSelectedClass();
      const ok = confirm(`¿Eliminar a ${student.name} de ${cls.name}?`);
      if (!ok) return;
      cls.students = cls.students.filter((s) => s.id !== student.id);
      saveState(state);
      renderStudents();
    });

    right.appendChild(counts);
    right.appendChild(posBtn);
    right.appendChild(historyBtn);
    right.appendChild(editBtn);
    right.appendChild(deleteBtn);

    li.appendChild(left);
    li.appendChild(right);
    studentList.appendChild(li);
  }
}

function formatEventTs(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/** @param {Student} student */
function openHistoryModal(student) {
  historySubtitle.textContent = `${student.name} · ${getSelectedClass().name}`;
  const events = Array.isArray(student.history) ? student.history.slice() : [];
  events.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));

  historyList.innerHTML = "";
  historyEmpty.hidden = events.length !== 0;

  for (const ev of events) {
    const li = document.createElement("li");
    li.className = "item";

    const left = document.createElement("span");
    left.className = "left";
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = ev.type === "neg" ? "☹︎ +1" : "🙂 +1";
    left.appendChild(label);

    const right = document.createElement("span");
    right.className = "right";
    const when = document.createElement("span");
    when.className = "count";
    when.textContent = formatEventTs(ev.ts);
    right.appendChild(when);

    li.appendChild(left);
    li.appendChild(right);
    historyList.appendChild(li);
  }

  if (typeof historyDialog.showModal === "function") {
    historyDialog.showModal();
  } else {
    historyDialog.setAttribute("open", "");
  }
}

function openClassHistoryModal() {
  const cls = getSelectedClass();
  classHistorySubtitle.textContent = `Resumen por alumno (totales de ☹︎ y 🙂) · ${cls.name}`;

  const rows = cls.students
    .map((s) => {
      const h = Array.isArray(s.history) ? s.history : [];
      let neg = 0;
      let pos = 0;
      for (const ev of h) {
        if (!ev) continue;
        const d = Math.max(0, Math.floor(Number(ev.delta ?? 1)));
        if (ev.type === "neg") neg += d;
        else if (ev.type === "pos") pos += d;
      }
      return { name: s.name, neg, pos };
    })
    .filter((r) => r.neg > 0 || r.pos > 0)
    .sort((a, b) => (b.neg - a.neg) || (b.pos - a.pos) || a.name.localeCompare(b.name));

  classHistoryList.innerHTML = "";
  classHistoryEmpty.hidden = rows.length !== 0;

  for (const r of rows) {
    const li = document.createElement("li");
    li.className = "item";

    const left = document.createElement("span");
    left.className = "left";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.name;
    left.appendChild(name);

    const right = document.createElement("span");
    right.className = "right";

    const neg = document.createElement("span");
    neg.className = "count";
    neg.textContent = `☹︎ ${r.neg}`;

    const pos = document.createElement("span");
    pos.className = "count";
    pos.textContent = `🙂 ${r.pos}`;

    right.appendChild(neg);
    right.appendChild(pos);

    li.appendChild(left);
    li.appendChild(right);
    classHistoryList.appendChild(li);
  }

  if (typeof classHistoryDialog.showModal === "function") {
    classHistoryDialog.showModal();
  } else {
    classHistoryDialog.setAttribute("open", "");
  }
}

function tickTimers() {
  const cls = getSelectedClass();
  const running = Boolean(state.ui?.timerRunning);
  const now = getEffectiveNow();
  if (!state.ui) return;

  const prev = typeof state.ui.lastTickNow === "number" && Number.isFinite(state.ui.lastTickNow)
    ? state.ui.lastTickNow
    : now;
  const delta = Math.max(0, now - prev);
  state.ui.lastTickNow = now;

  let anyChanged = false;

  if (running && delta > 0) {
    for (const s of cls.students) {
      if ((s.count ?? 0) <= 0) continue;
      s.negSpentMs = Math.max(0, (Number(s.negSpentMs) || 0) + delta);
      anyChanged = true;
    }
  }

  const expired = expireNegativesIfNeeded(cls);
  if (expired) anyChanged = true;

  if (anyChanged) saveState(state);

  // Actualiza solo los textos de los timers; si hubo expiraciones, rerender para que el filtro se aplique.
  if (expired) {
    renderStudents();
    return;
  }

  /** @type {NodeListOf<HTMLSpanElement>} */
  const timers = document.querySelectorAll(".timer[data-student-id]");
  for (const node of timers) {
    const studentId = node.dataset.studentId;
    if (!studentId) continue;
    const student = cls.students.find((s) => s.id === studentId);
    if (!student) continue;
    const remainingMs = getNegativeRemainingMs(student);
    const icon = running ? "⏱" : "⏸";
    node.textContent = `${icon} ${remainingMs > 0 ? formatRemaining(remainingMs) : "00:00"}`;
  }

  // Actualiza también el modal de tiempos si está abierto.
  if (timerDialog.hasAttribute("open") || timerDialog.open) {
    /** @type {NodeListOf<HTMLSpanElement>} */
    const modalTimers = document.querySelectorAll("[data-role='timer-modal'][data-student-id]");
    for (const node of modalTimers) {
      const id = node.dataset.studentId;
      const s = cls.students.find((x) => x.id === id);
      if (!s) continue;
      const remainingMs = getNegativeRemainingMs(s);
      node.textContent = `⏱ ${remainingMs > 0 ? formatRemaining(remainingMs) : "00:00"}`;
    }
  }
}

function resetMarksForSelectedClass() {
  const cls = getSelectedClass();
  for (const s of cls.students) {
    s.count = 0;
    s.positiveCount = 0;
    s.negSpentMs = 0;
    s.negExpiresAt = undefined;
  }
  saveState(state);
  renderStudents();
}

function applyImportToSelectedClass(names) {
  const cls = getSelectedClass();
  const cleaned = dedupeNames(names.map((n) => n.trim()).filter(Boolean));

  const existingByName = new Map(
    cls.students.map((s) => [s.name.toLocaleLowerCase(), s])
  );

  let added = 0;
  let skipped = 0;

  for (const name of cleaned) {
    const key = name.toLocaleLowerCase();
    if (existingByName.has(key)) {
      skipped++;
      continue;
    }
    cls.students.push({ id: uid(), name, count: 0, positiveCount: 0, negExpiresAt: undefined, negSpentMs: 0 });
    existingByName.set(key, cls.students[cls.students.length - 1]);
    added++;
  }

  saveState(state);
  renderStudents();

  return { cleanedCount: cleaned.length, added, skipped };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

// Eventos
openImportBtn.addEventListener("click", () => {
  // Sincroniza valores de configuración al abrir
  negMinutesPerPointInput.value = String(getNegMinutesPerPoint());
  posMinutesPerPointInput.value = String(getPosMinutesPerPoint());

  if (typeof importDialog.showModal === "function") {
    importDialog.showModal();
  } else {
    // Fallback muy simple si el navegador no soporta <dialog>
    importDialog.setAttribute("open", "");
  }
});

closeImportBtn.addEventListener("click", () => {
  importDialog.close?.();
  importDialog.removeAttribute("open");
});

importDialog.addEventListener("click", (e) => {
  // Cerrar al pinchar fuera del cuadro (backdrop)
  if (e.target === importDialog) {
    importDialog.close?.();
    importDialog.removeAttribute("open");
  }
});

classSelect.addEventListener("change", () => {
  selectedClassId = classSelect.value;
  minCountInput.value = String(getMinCountForSelectedClass());
  minPositiveInput.value = String(getMinPositiveForSelectedClass());
  renderClassNameInput();
  renderStudents();
});

saveClassNameBtn.addEventListener("click", () => {
  saveClassName();
});

classNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveClassName();
  }
});

classNameInput.addEventListener("blur", () => {
  // Guardado suave al salir del campo (solo si cambia).
  const cls = getSelectedClass();
  const next = (classNameInput.value ?? "").trim();
  if (next && next !== cls.name) saveClassName();
});

minCountInput.addEventListener("input", () => {
  setMinCountForSelectedClass(minCountInput.value);
  renderStudents();
});

minPositiveInput.addEventListener("input", () => {
  setMinPositiveForSelectedClass(minPositiveInput.value);
  renderStudents();
});

clearFilterBtn.addEventListener("click", () => {
  minCountInput.value = "0";
  setMinCountForSelectedClass(0);
  minPositiveInput.value = "0";
  setMinPositiveForSelectedClass(0);
  renderStudents();
});

negMinutesPerPointInput.addEventListener("input", () => {
  setNegMinutesPerPoint(negMinutesPerPointInput.value);
  renderStudents();
});

posMinutesPerPointInput.addEventListener("input", () => {
  setPosMinutesPerPoint(posMinutesPerPointInput.value);
  renderStudents();
});

timerPlayBtn.addEventListener("click", () => {
  startGlobalTimer();
});

timerPauseBtn.addEventListener("click", () => {
  pauseGlobalTimer();
});

closeTimerBtn.addEventListener("click", () => {
  timerDialog.close?.();
  timerDialog.removeAttribute("open");
});

timerDialog.addEventListener("click", (e) => {
  if (e.target === timerDialog) {
    timerDialog.close?.();
    timerDialog.removeAttribute("open");
  }
});

closeHistoryBtn.addEventListener("click", () => {
  historyDialog.close?.();
  historyDialog.removeAttribute("open");
});

historyDialog.addEventListener("click", (e) => {
  if (e.target === historyDialog) {
    historyDialog.close?.();
    historyDialog.removeAttribute("open");
  }
});

openClassHistoryBtn.addEventListener("click", () => {
  try {
    openClassHistoryModal();
  } catch (e) {
    setTransientStatus(e instanceof Error ? e.message : "Error al abrir histórico", 4000);
  }
});

closeClassHistoryBtn.addEventListener("click", () => {
  classHistoryDialog.close?.();
  classHistoryDialog.removeAttribute("open");
});

classHistoryDialog.addEventListener("click", (e) => {
  if (e.target === classHistoryDialog) {
    classHistoryDialog.close?.();
    classHistoryDialog.removeAttribute("open");
  }
});

resetClassBtn.addEventListener("click", () => {
  const cls = getSelectedClass();
  if (!cls.students.length) return;
  const ok = confirm(`¿Reiniciar contadores de ${cls.name}?`);
  if (!ok) return;
  resetMarksForSelectedClass();
});

importClearBtn.addEventListener("click", () => {
  importTextarea.value = "";
  importFile.value = "";
  importPdf.value = "";
});

importApplyBtn.addEventListener("click", async () => {
  try {
    let text = importTextarea.value ?? "";
    const file = importFile.files?.[0];
    const pdf = importPdf.files?.[0];
    if (!text.trim() && file) {
      text = await readFileAsText(file);
    }

    /** @type {string[]} */
    let names = [];
    if (pdf) {
      // Prioridad al PDF si se ha seleccionado.
      setTransientStatus("Leyendo PDF…", 5000);
      const pdfText = await extractTextFromPdf(pdf);
      names = parseNamesFromPdfText(pdfText);
    } else {
      names = parseNames(text);
    }
    if (!names.length) {
      setTransientStatus("No se detectaron nombres para importar");
      return;
    }

    const cls = getSelectedClass();
    const result = applyImportToSelectedClass(names);
    setTransientStatus(
      `Importados: ${result.added} nuevos · ${result.skipped} duplicados · ${cls.name}`
    );

    // Cierra el modal tras importar
    importDialog.close?.();
    importDialog.removeAttribute("open");
  } catch (e) {
    setTransientStatus(e instanceof Error ? e.message : "Error al importar", 4000);
  }
});

exportBackupBtn.addEventListener("click", () => {
  try {
    exportBackup();
  } catch (e) {
    setTransientStatus(e instanceof Error ? e.message : "Error al exportar", 4000);
  }
});

importBackupBtn.addEventListener("click", async () => {
  try {
    await importBackupFromUi();
    // Cierra el modal tras importar
    importDialog.close?.();
    importDialog.removeAttribute("open");
  } catch (e) {
    setTransientStatus(e instanceof Error ? e.message : "Error al importar", 4000);
  }
});

// Init
renderClassSelect();
minCountInput.value = String(getMinCountForSelectedClass());
minPositiveInput.value = String(getMinPositiveForSelectedClass());
renderClassNameInput();
syncTimerControls();
negMinutesPerPointInput.value = String(getNegMinutesPerPoint());
posMinutesPerPointInput.value = String(getPosMinutesPerPoint());
renderStudents();

// ------------------------------
// Semáforo de sonido (micrófono)
// ------------------------------

const SOUND_KEY = "edunotas_sound_v1";

const SOUND_PRESETS = {
  // Nota: valores en dBFS (negativos). Más cerca de 0 => más fuerte.
  // Calibrado para que en silencio quede en VERDE y en aula sea fácil ver ÁMBAR/ROJO.
  strict: { greenMaxDb: -25, redMinDb: -15 },
  normal: { greenMaxDb: -20, redMinDb: -10 },
  permissive: { greenMaxDb: -16, redMinDb: -7 },
};

/** @typedef {{ preset?: "strict"|"normal"|"permissive", greenMaxDb?: number, redMinDb?: number }} SoundUiState */

const SOUND_COLOR_DEFAULTS = {
  green: "#00d26a",
  amber: "#ffb000",
  red: "#ff3b3b",
};

/** @typedef {{ preset?: "strict"|"normal"|"permissive"|"custom", greenMaxDb?: number, redMinDb?: number, greenColor?: string, amberColor?: string, redColor?: string, hideConfig?: boolean, hideDb?: boolean, silenceDb?: number, talkDb?: number, gain?: number }} SoundUiState */

/** @returns {SoundUiState} */
function loadSoundUiState() {
  const raw = localStorage.getItem(SOUND_KEY);
  if (!raw) {
    return {
      preset: "normal",
      greenMaxDb: SOUND_PRESETS.normal.greenMaxDb,
      redMinDb: SOUND_PRESETS.normal.redMinDb,
      greenColor: SOUND_COLOR_DEFAULTS.green,
      amberColor: SOUND_COLOR_DEFAULTS.amber,
      redColor: SOUND_COLOR_DEFAULTS.red,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {
        preset: "normal",
        greenMaxDb: SOUND_PRESETS.normal.greenMaxDb,
        redMinDb: SOUND_PRESETS.normal.redMinDb,
        greenColor: SOUND_COLOR_DEFAULTS.green,
        amberColor: SOUND_COLOR_DEFAULTS.amber,
        redColor: SOUND_COLOR_DEFAULTS.red,
      };
    }

    const preset = parsed.preset;
    const okPreset =
      preset === "strict" || preset === "normal" || preset === "permissive" || preset === "custom" ? preset : "normal";

    const g = Number(parsed.greenMaxDb);
    const r = Number(parsed.redMinDb);
    const greenMaxDb = Number.isFinite(g) ? g : SOUND_PRESETS[okPreset].greenMaxDb;
    const redMinDb = Number.isFinite(r) ? r : SOUND_PRESETS[okPreset].redMinDb;

    const greenColor = typeof parsed.greenColor === "string" ? parsed.greenColor : SOUND_COLOR_DEFAULTS.green;
    const amberColor = typeof parsed.amberColor === "string" ? parsed.amberColor : SOUND_COLOR_DEFAULTS.amber;
    const redColor = typeof parsed.redColor === "string" ? parsed.redColor : SOUND_COLOR_DEFAULTS.red;
    // Compatibilidad: antes existía hideDb (ocultar dB). Ahora usamos hideConfig.
    const hideConfig =
      typeof parsed.hideConfig === "boolean"
        ? parsed.hideConfig
        : typeof parsed.hideDb === "boolean"
          ? parsed.hideDb
          : false;
    const silenceDb = Number.isFinite(Number(parsed.silenceDb)) ? Number(parsed.silenceDb) : undefined;
    const talkDb = Number.isFinite(Number(parsed.talkDb)) ? Number(parsed.talkDb) : undefined;
    const gain = Number.isFinite(Number(parsed.gain)) ? Number(parsed.gain) : 1;

    return { preset: okPreset, greenMaxDb, redMinDb, greenColor, amberColor, redColor, hideConfig, silenceDb, talkDb, gain };
  } catch {
    return {
      preset: "normal",
      greenMaxDb: SOUND_PRESETS.normal.greenMaxDb,
      redMinDb: SOUND_PRESETS.normal.redMinDb,
      greenColor: SOUND_COLOR_DEFAULTS.green,
      amberColor: SOUND_COLOR_DEFAULTS.amber,
      redColor: SOUND_COLOR_DEFAULTS.red,
    };
  }
}

/** @param {SoundUiState} s */
function saveSoundUiState(s) {
  localStorage.setItem(SOUND_KEY, JSON.stringify(s));
}

function initSoundSemaphore() {
  const soundPanel = document.getElementById("soundPanel");
  if (!soundPanel) return;

  const enableBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("soundEnableBtn"));
  const toggleConfigBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("soundToggleConfigBtn"));
  const statusText = /** @type {HTMLParagraphElement|null} */ (document.getElementById("soundStatusText"));
  const soundDb = /** @type {HTMLSpanElement|null} */ (document.getElementById("soundDb"));
  const greenTh = /** @type {HTMLSpanElement|null} */ (document.getElementById("soundGreenTh"));
  const redTh = /** @type {HTMLSpanElement|null} */ (document.getElementById("soundRedTh"));

  const greenSlider = /** @type {HTMLInputElement|null} */ (document.getElementById("soundGreenSlider"));
  const redSlider = /** @type {HTMLInputElement|null} */ (document.getElementById("soundRedSlider"));
  const greenSliderValue = /** @type {HTMLSpanElement|null} */ (document.getElementById("soundGreenSliderValue"));
  const redSliderValue = /** @type {HTMLSpanElement|null} */ (document.getElementById("soundRedSliderValue"));

  const greenColorInput = /** @type {HTMLInputElement|null} */ (document.getElementById("soundGreenColor"));
  const amberColorInput = /** @type {HTMLInputElement|null} */ (document.getElementById("soundAmberColor"));
  const redColorInput = /** @type {HTMLInputElement|null} */ (document.getElementById("soundRedColor"));
  const resetColorsBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("soundResetColorsBtn"));

  const greenNumber = /** @type {HTMLInputElement|null} */ (document.getElementById("soundGreenNumber"));
  const redNumber = /** @type {HTMLInputElement|null} */ (document.getElementById("soundRedNumber"));
  const captureGreenBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("soundCaptureGreenBtn"));
  const captureRedBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("soundCaptureRedBtn"));

  const calibrateSilenceBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("soundCalibrateSilenceBtn"));
  const calibrateTalkBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("soundCalibrateTalkBtn"));

  const gainSlider = /** @type {HTMLInputElement|null} */ (document.getElementById("soundGainSlider"));
  const gainValue = /** @type {HTMLSpanElement|null} */ (document.getElementById("soundGainValue"));

  if (
    !enableBtn ||
    !toggleConfigBtn ||
    !statusText ||
    !soundDb ||
    !greenTh ||
    !redTh ||
    !greenSlider ||
    !redSlider ||
    !greenSliderValue ||
    !redSliderValue ||
    !greenColorInput ||
    !amberColorInput ||
    !redColorInput ||
    !resetColorsBtn ||
    !greenNumber ||
    !redNumber ||
    !captureGreenBtn ||
    !captureRedBtn ||
    !calibrateSilenceBtn ||
    !calibrateTalkBtn ||
    !gainSlider ||
    !gainValue
  ) {
    return;
  }

  /** @type {SoundUiState} */
  let ui = loadSoundUiState();

  /** @type {"green"|"amber"|"red"|"off"} */
  let currentState = "off";

  /** @type {AudioContext|null} */
  let audioCtx = null;
  /** @type {MediaStream|null} */
  let stream = null;
  /** @type {GainNode|null} */
  let gainNode = null;
  /** @type {AnalyserNode|null} */
  let analyser = null;
  /** @type {Float32Array|null} */
  let floatBuf = null;
  /** @type {Uint8Array|null} */
  let byteBuf = null;
  let rafId = 0;

  // Suavizado simple para evitar parpadeo.
  let smoothedDb = -100;
  let lastDisplayedDb = -100;

  // Escala visual del "nivel" (0..100). Aumentarla amplía los puntos entre dos dB.
  // Ej: si entre silencio y habla hay ~10 dB, con x2 se verán ~20 puntos.
  const LEVEL_SCALE = 1.4;

  function dbToLevel(db) {
    const n = Number(db);
    if (!Number.isFinite(n)) return 0;
    // db en [-100..0] -> nivel base en [0..100] y luego escalado
    const base = 100 + n;
    return Math.max(0, Math.min(100, Math.round(base * LEVEL_SCALE)));
  }

  function levelToDb(level) {
    const n = Number(level);
    if (!Number.isFinite(n)) return -100;
    const clamped = Math.max(0, Math.min(100, Math.round(n)));
    return clamped / LEVEL_SCALE - 100;
  }

  function getThresholds() {
    const g = Number(ui.greenMaxDb);
    const r = Number(ui.redMinDb);

    const fallback = SOUND_PRESETS[ui.preset || "normal"];
    const greenMaxDb = Number.isFinite(g) ? g : fallback.greenMaxDb;
    const redMinDb = Number.isFinite(r) ? r : fallback.redMinDb;

    // Asegura una zona ámbar mínima.
    const minGap = 3;
    if (redMinDb <= greenMaxDb + minGap) {
      return { greenMaxDb, redMinDb: greenMaxDb + minGap };
    }

    return { greenMaxDb, redMinDb };
  }

  function setPanelState(next) {
    currentState = next;
    if (next === "off") {
      soundPanel.removeAttribute("data-sound-state");
    } else {
      soundPanel.setAttribute("data-sound-state", next);
    }
  }

  function applyColorsToPanel() {
    const green = typeof ui.greenColor === "string" ? ui.greenColor : SOUND_COLOR_DEFAULTS.green;
    const amber = typeof ui.amberColor === "string" ? ui.amberColor : SOUND_COLOR_DEFAULTS.amber;
    const red = typeof ui.redColor === "string" ? ui.redColor : SOUND_COLOR_DEFAULTS.red;

    soundPanel.style.setProperty("--sound-green", green);
    soundPanel.style.setProperty("--sound-amber", amber);
    soundPanel.style.setProperty("--sound-red", red);

    // También las ponemos a nivel global para que otros paneles (modo de trabajo) las reutilicen.
    document.documentElement.style.setProperty("--sound-green", green);
    document.documentElement.style.setProperty("--sound-amber", amber);
    document.documentElement.style.setProperty("--sound-red", red);

    greenColorInput.value = green;
    amberColorInput.value = amber;
    redColorInput.value = red;
  }

  function applyHideConfigToPanel() {
    const hide = Boolean(ui.hideConfig);
    soundPanel.setAttribute("data-hide-config", hide ? "1" : "0");
    toggleConfigBtn.textContent = hide ? "Mostrar configuración" : "Ocultar configuración";
  }

  function clampGain(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0.25, Math.min(4, n));
  }

  function applyGainUi() {
    const g = clampGain(ui.gain ?? 1);
    ui.gain = g;
    gainSlider.value = String(g);
    gainValue.textContent = g.toFixed(2);
    if (gainNode) gainNode.gain.value = g;
  }

  function updatePresetButtons() {
    const { greenMaxDb, redMinDb } = getThresholds();
    greenTh.textContent = `${dbToLevel(greenMaxDb)}`;
    redTh.textContent = `${dbToLevel(redMinDb)}`;

    greenSlider.value = String(dbToLevel(greenMaxDb));
    redSlider.value = String(dbToLevel(redMinDb));
    greenSliderValue.textContent = String(dbToLevel(greenMaxDb));
    redSliderValue.textContent = String(dbToLevel(redMinDb));

    greenNumber.value = String(dbToLevel(greenMaxDb));
    redNumber.value = String(dbToLevel(redMinDb));

    applyColorsToPanel();
    applyHideConfigToPanel();
    applyGainUi();
  }

  function clampLevel(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  /**
   * Aplica umbrales en nivel (0..100).
   * Mantiene una zona ámbar mínima moviendo el otro umbral según el origen.
   * @param {number|string} nextGreen
   * @param {number|string} nextRed
   * @param {"green"|"red"|"both"} [source]
   */
  function setManualThresholds(nextGreen, nextRed, source = "both") {
    const minGap = 3;
    let gLevel = clampLevel(nextGreen);
    let rLevel = clampLevel(nextRed);

    if (source === "green") {
      if (rLevel < gLevel + minGap) rLevel = Math.min(100, gLevel + minGap);
      if (rLevel < gLevel + minGap) gLevel = Math.max(0, rLevel - minGap);
    } else if (source === "red") {
      if (rLevel < gLevel + minGap) gLevel = Math.max(0, rLevel - minGap);
      if (rLevel < gLevel + minGap) rLevel = Math.min(100, gLevel + minGap);
    } else {
      if (rLevel < gLevel + minGap) rLevel = Math.min(100, gLevel + minGap);
      if (rLevel < gLevel + minGap) gLevel = Math.max(0, rLevel - minGap);
    }

    ui.greenMaxDb = levelToDb(gLevel);
    ui.redMinDb = levelToDb(rLevel);
    saveSoundUiState(ui);
    updatePresetButtons();
  }

  function ensureMicOrExplain() {
    if (!analyser) {
      statusText.textContent = "Activa el micrófono primero (botón Activar).";
      return false;
    }
    return true;
  }

  function calibrateSilence() {
    if (!ensureMicOrExplain()) return;
    ui.preset = "custom";
    ui.silenceDb = Math.round(lastDisplayedDb);
    ui.talkDb = undefined;
    saveSoundUiState(ui);
    statusText.textContent = `Silencio calibrado: nivel ${dbToLevel(lastDisplayedDb)}. Ahora pulsa “Calibrar aula (hablando normal)”.`;
    updatePresetButtons();
  }

  function calibrateTalk() {
    if (!ensureMicOrExplain()) return;
    const silence = Number(ui.silenceDb);
    if (!Number.isFinite(silence)) {
      statusText.textContent = "Primero pulsa “Calibrar silencio (verde)”.";
      return;
    }

    const talk = Math.round(lastDisplayedDb);
    ui.preset = "custom";
    ui.talkDb = talk;

    const silenceLevel = dbToLevel(silence);
    const talkLevel = dbToLevel(talk);

    // Umbrales derivados en escala nivel (0..100):
    // - Verde hasta: punto medio entre silencio y habla.
    // - Rojo desde: habla + margen (para que gritos disparen rojo).
    const greenMaxLevel = Math.round((silenceLevel + talkLevel) / 2);
    const redMinLevel = Math.round(talkLevel + 6);

    setManualThresholds(greenMaxLevel, redMinLevel);
    statusText.textContent = `Calibrado. Verde < ${greenMaxLevel} · Rojo ≥ ${Math.round(Math.max(redMinLevel, greenMaxLevel + 3))} (nivel).`;
  }

  function setSoundColors(nextGreen, nextAmber, nextRed) {
    ui.greenColor = String(nextGreen || SOUND_COLOR_DEFAULTS.green);
    ui.amberColor = String(nextAmber || SOUND_COLOR_DEFAULTS.amber);
    ui.redColor = String(nextRed || SOUND_COLOR_DEFAULTS.red);
    saveSoundUiState(ui);
    applyColorsToPanel();
  }

  async function enableMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      statusText.textContent = "Este navegador no soporta acceso al micrófono.";
      return;
    }

    // Si ya está activo, no re-abrimos.
    if (analyser || stream || audioCtx) return;

    try {
      enableBtn.disabled = true;
      enableBtn.textContent = "Activando…";

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const source = audioCtx.createMediaStreamSource(stream);
      gainNode = audioCtx.createGain();
      gainNode.gain.value = clampGain(ui.gain ?? 1);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.0;

      source.connect(gainNode);
      gainNode.connect(analyser);

      // Buffers
      try {
        floatBuf = new Float32Array(analyser.fftSize);
      } catch {
        floatBuf = null;
      }
      byteBuf = new Uint8Array(analyser.fftSize);

      await audioCtx.resume?.();

      statusText.textContent = "Sensor activo. Ajusta el umbral según necesites.";
      enableBtn.textContent = "Desactivar";
      enableBtn.disabled = false;
      setPanelState("green");

      applyGainUi();

      tick();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo activar el micrófono";
      statusText.textContent = `No se pudo activar: ${msg}`;
      enableBtn.disabled = false;
      enableBtn.textContent = "Activar";
      setPanelState("off");
    }
  }

  async function disableMic() {
    // Parar animación
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;

    // Parar stream
    try {
      stream?.getTracks?.().forEach((t) => t.stop());
    } catch {
      // noop
    }
    stream = null;

    // Cerrar contexto
    try {
      await audioCtx?.close?.();
    } catch {
      // noop
    }
    audioCtx = null;

    analyser = null;
    gainNode = null;
    floatBuf = null;
    byteBuf = null;

    smoothedDb = -100;
    lastDisplayedDb = -100;

    setPanelState("off");
    statusText.textContent = "Sensor desactivado.";
    enableBtn.textContent = "Activar";
    enableBtn.disabled = false;
  }

  function computeDbFromAnalyser() {
    if (!analyser) return -100;

    // Preferimos float por precisión.
    if (floatBuf && typeof analyser.getFloatTimeDomainData === "function") {
      analyser.getFloatTimeDomainData(floatBuf);
      let sum = 0;
      for (let i = 0; i < floatBuf.length; i++) {
        const x = floatBuf[i];
        sum += x * x;
      }
      const rms = Math.sqrt(sum / floatBuf.length);
      if (!Number.isFinite(rms) || rms <= 0) return -100;
      const db = 20 * Math.log10(rms);
      return Math.max(-100, Math.min(0, db));
    }

    // Fallback: uint8 0..255, centrado 128.
    if (byteBuf) {
      analyser.getByteTimeDomainData(byteBuf);
      let sum = 0;
      for (let i = 0; i < byteBuf.length; i++) {
        const x = (byteBuf[i] - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / byteBuf.length);
      if (!Number.isFinite(rms) || rms <= 0) return -100;
      const db = 20 * Math.log10(rms);
      return Math.max(-100, Math.min(0, db));
    }

    return -100;
  }

  function tick() {
    rafId = window.requestAnimationFrame(tick);
    const rawDb = computeDbFromAnalyser();
    // EMA (más bajo = más estable)
    const alpha = 0.18;
    smoothedDb = smoothedDb + alpha * (rawDb - smoothedDb);

    lastDisplayedDb = smoothedDb;

    soundDb.textContent = `${dbToLevel(smoothedDb)}`;

    const { greenMaxDb, redMinDb } = getThresholds();
    /** @type {"green"|"amber"|"red"} */
    const next = smoothedDb >= redMinDb ? "red" : smoothedDb >= greenMaxDb ? "amber" : "green";

    if (next !== currentState) {
      setPanelState(next);
      if (next === "green") statusText.textContent = "VERDE: el ruido está en el umbral correcto.";
      if (next === "amber") statusText.textContent = "ÁMBAR: el ruido es aceptable, pero cerca del límite.";
      if (next === "red") statusText.textContent = "ROJO: nos hemos pasado con el ruido.";
    }
  }

  // Listeners
  enableBtn.addEventListener("click", () => {
    if (analyser || stream || audioCtx) {
      void disableMic();
    } else {
      void enableMic();
    }
  });

  toggleConfigBtn.addEventListener("click", () => {
    ui.hideConfig = !ui.hideConfig;
    saveSoundUiState(ui);
    applyHideConfigToPanel();
  });

  greenSlider.addEventListener("input", () => {
    // Mantiene el preset como referencia visual, pero permite ajuste manual.
    ui.preset = ui.preset || "normal";
    setManualThresholds(greenSlider.value, redSlider.value, "green");
  });

  redSlider.addEventListener("input", () => {
    ui.preset = ui.preset || "normal";
    setManualThresholds(greenSlider.value, redSlider.value, "red");
  });

  greenNumber.addEventListener("input", () => {
    ui.preset = ui.preset || "normal";
    setManualThresholds(greenNumber.value, redNumber.value, "green");
  });

  redNumber.addEventListener("input", () => {
    ui.preset = ui.preset || "normal";
    setManualThresholds(greenNumber.value, redNumber.value, "red");
  });

  captureGreenBtn.addEventListener("click", () => {
    // Captura el nivel actual como límite de VERDE.
    ui.preset = ui.preset || "normal";
    setManualThresholds(dbToLevel(lastDisplayedDb), redNumber.value);
  });

  captureRedBtn.addEventListener("click", () => {
    // Captura el nivel actual como inicio de ROJO.
    ui.preset = ui.preset || "normal";
    setManualThresholds(greenNumber.value, dbToLevel(lastDisplayedDb));
  });

  greenColorInput.addEventListener("input", () => {
    setSoundColors(greenColorInput.value, amberColorInput.value, redColorInput.value);
  });

  amberColorInput.addEventListener("input", () => {
    setSoundColors(greenColorInput.value, amberColorInput.value, redColorInput.value);
  });

  redColorInput.addEventListener("input", () => {
    setSoundColors(greenColorInput.value, amberColorInput.value, redColorInput.value);
  });

  resetColorsBtn.addEventListener("click", () => {
    setSoundColors(SOUND_COLOR_DEFAULTS.green, SOUND_COLOR_DEFAULTS.amber, SOUND_COLOR_DEFAULTS.red);
  });

  calibrateSilenceBtn.addEventListener("click", () => {
    calibrateSilence();
  });

  calibrateTalkBtn.addEventListener("click", () => {
    calibrateTalk();
  });

  gainSlider.addEventListener("input", () => {
    ui.gain = clampGain(gainSlider.value);
    saveSoundUiState(ui);
    applyGainUi();
  });

  // Estado inicial UI
  setPanelState("off");
  updatePresetButtons();
  statusText.textContent = "Pulsa “Activar” y permite el micrófono.";

  // Limpieza si la pestaña se oculta (evita consumo innecesario).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      if (analyser && !rafId) tick();
    }
  });
}

// ------------------------------
// Modo de trabajo (columna derecha)
// ------------------------------

const MODE_KEY = "edunotas_mode_v1";

function initWorkModePanel() {
  const panel = document.getElementById("modePanel");
  if (!panel) return;

  const emoji = /** @type {HTMLDivElement|null} */ (document.getElementById("modeEmoji"));
  const label = /** @type {HTMLDivElement|null} */ (document.getElementById("modeLabel"));
  const hint = /** @type {HTMLDivElement|null} */ (document.getElementById("modeHint"));

  const explainBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("modeExplainBtn"));
  const workBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("modeWorkBtn"));
  const debateBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("modeDebateBtn"));

  if (!emoji || !label || !hint || !explainBtn || !workBtn || !debateBtn) return;

  /** @type {"green"|"amber"|"red"} */
  let mode = "green";

  function loadMode() {
    const raw = localStorage.getItem(MODE_KEY);
    if (!raw) return "green";
    try {
      const parsed = JSON.parse(raw);
      return parsed === "green" || parsed === "amber" || parsed === "red" ? parsed : "green";
    } catch {
      return "green";
    }
  }

  function saveMode(next) {
    localStorage.setItem(MODE_KEY, JSON.stringify(next));
  }

  function applyMode(next) {
    mode = next;
    panel.setAttribute("data-mode", next);

    explainBtn.disabled = next === "green";
    workBtn.disabled = next === "amber";
    debateBtn.disabled = next === "red";

    if (next === "green") {
      emoji.textContent = "🤫";
      label.textContent = "Explicación";
      hint.textContent = "Objetivo: semáforo en VERDE (silencio).";
    } else if (next === "amber") {
      emoji.textContent = "🤝";
      label.textContent = "Trabajo";
      hint.textContent = "Objetivo: semáforo en ÁMBAR (voz baja).";
    } else {
      emoji.textContent = "🗣️";
      label.textContent = "Debate";
      hint.textContent = "Objetivo: semáforo en ROJO solo puntualmente (moderación).";
    }
  }

  explainBtn.addEventListener("click", () => {
    applyMode("green");
    saveMode("green");
  });
  workBtn.addEventListener("click", () => {
    applyMode("amber");
    saveMode("amber");
  });
  debateBtn.addEventListener("click", () => {
    applyMode("red");
    saveMode("red");
  });

  applyMode(loadMode());
}

// ------------------------------
// Visibilidad de columnas (3 columnas)
// ------------------------------

const COLVIS_KEY = "edunotas_columns_v1";
const COLW_KEY = "edunotas_colwidth_v1";

function initColumnVisibility() {
  const split = document.getElementById("splitLayout");
  if (!split) return;

  const leftBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("toggleLeftColBtn"));
  const midBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("toggleMidColBtn"));
  const rightBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("toggleRightColBtn"));
  if (!leftBtn || !midBtn || !rightBtn) return;

  /** @type {{ left: boolean, mid: boolean, right: boolean }} */
  let vis = { left: true, mid: true, right: true };

  function load() {
    const raw = localStorage.getItem(COLVIS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.left === "boolean") vis.left = parsed.left;
      if (typeof parsed.mid === "boolean") vis.mid = parsed.mid;
      if (typeof parsed.right === "boolean") vis.right = parsed.right;
    } catch {
      // ignore
    }
  }

  function save() {
    localStorage.setItem(COLVIS_KEY, JSON.stringify(vis));
  }

  function apply() {
    split.classList.toggle("split--hide-left", !vis.left);
    split.classList.toggle("split--hide-mid", !vis.mid);
    split.classList.toggle("split--hide-right", !vis.right);

    leftBtn.setAttribute("aria-pressed", String(vis.left));
    midBtn.setAttribute("aria-pressed", String(vis.mid));
    rightBtn.setAttribute("aria-pressed", String(vis.right));

    // Feedback visual reutilizando estilos existentes
    leftBtn.classList.toggle("btn--secondary", vis.left);
    midBtn.classList.toggle("btn--secondary", vis.mid);
    rightBtn.classList.toggle("btn--secondary", vis.right);
  }

  function ensureAtLeastOneVisible() {
    if (vis.left || vis.mid || vis.right) return true;
    // Evita dejar todo oculto.
    vis.mid = true;
    return false;
  }

  leftBtn.addEventListener("click", () => {
    vis.left = !vis.left;
    ensureAtLeastOneVisible();
    apply();
    save();
  });
  midBtn.addEventListener("click", () => {
    vis.mid = !vis.mid;
    ensureAtLeastOneVisible();
    apply();
    save();
  });
  rightBtn.addEventListener("click", () => {
    vis.right = !vis.right;
    ensureAtLeastOneVisible();
    apply();
    save();
  });

  load();
  ensureAtLeastOneVisible();
  apply();
}

function initColumnResizers() {
  const split = document.getElementById("splitLayout");
  if (!split) return;

  /** @type {{ left: number, mid: number, right: number }} */
  let weights = { left: 2, mid: 1, right: 1 };

  function load() {
    const raw = localStorage.getItem(COLW_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const l = Number(parsed.left);
      const m = Number(parsed.mid);
      const r = Number(parsed.right);
      if (Number.isFinite(l) && l > 0) weights.left = l;
      if (Number.isFinite(m) && m > 0) weights.mid = m;
      if (Number.isFinite(r) && r > 0) weights.right = r;
    } catch {
      // ignore
    }
  }

  function save() {
    localStorage.setItem(COLW_KEY, JSON.stringify(weights));
  }

  function apply() {
    split.style.setProperty("--col-left", `${weights.left}fr`);
    split.style.setProperty("--col-mid", `${weights.mid}fr`);
    split.style.setProperty("--col-right", `${weights.right}fr`);
  }

  function isNarrow() {
    return window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /**
   * Ajusta pesos con teclado. Delta se aplica al panel A y se resta a B.
   * @param {"lm"|"mr"} which
   * @param {number} delta
   */
  function nudge(which, delta) {
    if (isNarrow()) return;
    const hideLeft = split.classList.contains("split--hide-left");
    const hideMid = split.classList.contains("split--hide-mid");
    const hideRight = split.classList.contains("split--hide-right");

    if (which === "lm" && (hideLeft || hideMid)) return;
    if (which === "mr" && (hideMid || hideRight)) return;

    const sum = which === "lm" ? weights.left + weights.mid : weights.mid + weights.right;
    const minW = 0.5;
    const maxA = sum - minW;

    if (which === "lm") {
      const nextLeft = clamp(weights.left + delta, minW, maxA);
      const nextMid = Math.max(minW, sum - nextLeft);
      weights.left = nextLeft;
      weights.mid = nextMid;
    } else {
      const nextMid = clamp(weights.mid + delta, minW, maxA);
      const nextRight = Math.max(minW, sum - nextMid);
      weights.mid = nextMid;
      weights.right = nextRight;
    }
    apply();
    save();
  }

  /** @param {"lm"|"mr"} which */
  function startDrag(which, ev) {
    if (isNarrow()) return;

    const leftEl = /** @type {HTMLElement|null} */ (split.querySelector(".split__left"));
    const midEl = /** @type {HTMLElement|null} */ (split.querySelector(".split__mid"));
    const rightEl = /** @type {HTMLElement|null} */ (split.querySelector(".split__right"));
    if (!leftEl || !midEl || !rightEl) return;

    // Respeta columnas ocultas.
    const hideLeft = split.classList.contains("split--hide-left");
    const hideMid = split.classList.contains("split--hide-mid");
    const hideRight = split.classList.contains("split--hide-right");

    if (which === "lm" && (hideLeft || hideMid)) return;
    if (which === "mr" && (hideMid || hideRight)) return;

    const startX = ev.clientX;
    const start = { ...weights };

    const aEl = which === "lm" ? leftEl : midEl;
    const bEl = which === "lm" ? midEl : rightEl;

    const aStartW = aEl.getBoundingClientRect().width;
    const bStartW = bEl.getBoundingClientRect().width;
    const totalW = aStartW + bStartW;

    const aMin = which === "lm" ? 420 : 320;
    const bMin = 320;

    const sum = which === "lm" ? start.left + start.mid : start.mid + start.right;

    /** @param {PointerEvent} e */
    function onMove(e) {
      const dx = e.clientX - startX;
      let aW = aStartW + dx;
      let bW = bStartW - dx;

      // Clamps por mínimos.
      if (aW < aMin) {
        const diff = aMin - aW;
        aW = aMin;
        bW = Math.max(bMin, bW - diff);
      }
      if (bW < bMin) {
        const diff = bMin - bW;
        bW = bMin;
        aW = Math.max(aMin, aW - diff);
      }

      const ratio = totalW > 0 ? aW / totalW : 0.5;
      const aWgt = Math.max(0.25, ratio * sum);
      const bWgt = Math.max(0.25, (1 - ratio) * sum);

      if (which === "lm") {
        weights.left = aWgt;
        weights.mid = bWgt;
      } else {
        weights.mid = aWgt;
        weights.right = bWgt;
      }
      apply();
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      save();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const resLm = /** @type {HTMLElement|null} */ (split.querySelector('.split__resizer[data-resizer="lm"]'));
  const resMr = /** @type {HTMLElement|null} */ (split.querySelector('.split__resizer[data-resizer="mr"]'));
  if (resLm) {
    resLm.addEventListener("pointerdown", (e) => {
      resLm.setPointerCapture?.(e.pointerId);
      startDrag("lm", e);
    });
    resLm.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.25 : 0.1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudge("lm", -step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudge("lm", step);
      }
    });
  }
  if (resMr) {
    resMr.addEventListener("pointerdown", (e) => {
      resMr.setPointerCapture?.(e.pointerId);
      startDrag("mr", e);
    });
    resMr.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.25 : 0.1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudge("mr", -step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudge("mr", step);
      }
    });
  }

  load();
  apply();
}

// Inicializa el semáforo si existe el panel en la página.
initSoundSemaphore();
initWorkModePanel();
initColumnVisibility();
initColumnResizers();

// Actualiza contadores de tiempo una vez por segundo
window.setInterval(tickTimers, 1000);
