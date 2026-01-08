/*
  EduNotas — Avisos (HTML5 + localStorage)
  - 12 clases (configurable)
  - Click en alumno: suma +1 aviso negativo
  - Botón +Pos: suma +1 aviso positivo
  - Importación local por texto/archivo
*/

const APP_KEY = "edunotas_asistencia_v1";

/** @typedef {{ id: string, name: string, marked?: boolean, count: number, positiveCount?: number }} Student */
/** @typedef {{ classes: Record<string, { name: string, students: Student[] }>, ui?: { minCountByClass?: Record<string, number>, minPositiveByClass?: Record<string, number> } }} AppState */

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
  return { classes, ui: { minCountByClass: {} } };
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

    for (const classId of Object.keys(migrated.classes)) {
      const cls = migrated.classes[classId];
      if (!cls || !Array.isArray(cls.students)) continue;
      for (const s of cls.students) {
        if (typeof s.count !== "number") s.count = 0;
        if (typeof s.positiveCount !== "number") s.positiveCount = 0;
        if (typeof s.marked !== "boolean") s.marked = false;
      }
    }

    return migrated;
  } catch {
    return defaultState();
  }
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
      student.count = (student.count ?? 0) + 1;
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
      student.count = (student.count ?? 0) + 1;
      saveState(state);
      renderStudents();
    });

    // Orden: botón +☹︎ junto al contador ☹︎ (a la izquierda)
    counts.appendChild(negBtn);
    counts.appendChild(negCount);
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

function resetMarksForSelectedClass() {
  const cls = getSelectedClass();
  for (const s of cls.students) {
    s.count = 0;
    s.positiveCount = 0;
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
    cls.students.push({ id: uid(), name, count: 0, positiveCount: 0 });
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
renderStudents();
