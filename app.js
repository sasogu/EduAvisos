/*
  EduNotas — Avisos (HTML5 + localStorage)
  - 12 clases (configurable)
  - Click en alumno: suma +1 aviso negativo
  - Botón +Pos: suma +1 aviso positivo
  - Importación local por texto/archivo
*/

const APP_KEY = "edunotas_asistencia_v1";

/** @typedef {{ id: string, name: string, marked?: boolean, count: number, positiveCount?: number, negExpiresAt?: number, negSpentMs?: number }} Student */
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
const importApplyBtn = /** @type {HTMLButtonElement} */ (el("importApplyBtn"));
const importClearBtn = /** @type {HTMLButtonElement} */ (el("importClearBtn"));
const openImportBtn = /** @type {HTMLButtonElement} */ (el("openImportBtn"));
const importDialog = /** @type {HTMLDialogElement} */ (el("importDialog"));
const closeImportBtn = /** @type {HTMLButtonElement} */ (el("closeImportBtn"));
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
      saveState(state);
      renderStudents();
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "miniBtn";
    editBtn.textContent = "Editar";
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
    deleteBtn.textContent = "Eliminar";
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
    right.appendChild(editBtn);
    right.appendChild(deleteBtn);

    li.appendChild(left);
    li.appendChild(right);
    studentList.appendChild(li);
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
});

importApplyBtn.addEventListener("click", async () => {
  try {
    let text = importTextarea.value ?? "";
    const file = importFile.files?.[0];
    if (!text.trim() && file) {
      text = await readFileAsText(file);
    }

    const names = parseNames(text);
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

// Init
renderClassSelect();
minCountInput.value = String(getMinCountForSelectedClass());
minPositiveInput.value = String(getMinPositiveForSelectedClass());
renderClassNameInput();
syncTimerControls();
negMinutesPerPointInput.value = String(getNegMinutesPerPoint());
posMinutesPerPointInput.value = String(getPosMinutesPerPoint());
renderStudents();

// Actualiza contadores de tiempo una vez por segundo
window.setInterval(tickTimers, 1000);
