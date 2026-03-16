/*
  EduNotas — Avisos (HTML5 + localStorage)
  - 12 clases (configurable)
  - Click en alumno: suma +1 aviso negativo
  - Botón +Pos: suma +1 aviso positivo
  - Importación local por texto/archivo
*/

const APP_KEY = "edunotas_asistencia_v1";

/** @typedef {{ ts: number, type: "neg"|"pos", delta: number }} StudentEvent */
/** @typedef {{ id: string, name: string, marked?: boolean, count: number, positiveCount?: number, negExpiresAt?: number, negSpentMs?: number, history?: StudentEvent[], evaluation?: { periods?: Record<string, { selections?: Record<string, string>, observation?: string, comment?: string, lastAutoComment?: string }> } }} Student */
/** @typedef {{ classes: Record<string, { name: string, students: Student[] }>, ui?: { minCountByClass?: Record<string, number>, minPositiveByClass?: Record<string, number>, timerRunning?: boolean, timerFrozenAt?: number, negMinutesPerPoint?: number, posMinutesPerPoint?: number, lastTickNow?: number } }} AppState */

const DEFAULT_NEG_MINUTES_PER_POINT = 5;
const DEFAULT_POS_MINUTES_PER_POINT = 5;
const i18n = window.EduI18n;
if (!i18n) throw new Error("Missing i18n bundle");
const { SUPPORTED_LANGUAGES, t, getResolvedLanguage, setLanguagePreferenceGetter } = i18n;

// ------------------------------
// Configuracion de evaluacion
// ------------------------------

const COMMENT_LANGUAGE_MODES = ["val", "es", "bilingual"];
const DEFAULT_COMMENT_CATEGORY_ORDER = ["actitud", "trabajo", "progreso"];
const EVALUATION_PERIODS = ["eval1", "eval2", "eval3", "final"];
const DEFAULT_COMMENT_CATEGORIES = {
  actitud: {
    label: "Actitud",
    options: [
      { id: "A1", val: "Manté una actitud respectuosa i participativa a classe.", es: "Mantiene una actitud respetuosa y participativa en clase." },
      { id: "A2", val: "Participa de manera adequada en les activitats proposades.", es: "Participa de forma adecuada en las actividades propuestas." },
      { id: "A3", val: "Escolta amb atenció i respecta els torns de paraula.", es: "Escucha con atención y respeta los turnos de palabra." },
      { id: "A4", val: "Mostra una actitud positiva davant l'aprenentatge.", es: "Muestra una actitud positiva ante el aprendizaje." },
      { id: "A5", val: "Necessita millorar la seua implicació i constància a l'aula.", es: "Necesita mejorar su implicación y constancia en el aula." },
    ],
  },
  trabajo: {
    label: "Trabajo",
    options: [
      { id: "T1", val: "Realitza les tasques amb responsabilitat i autonomia.", es: "Realiza las tareas con responsabilidad y autonomía." },
      { id: "T2", val: "Completa les activitats en el temps previst amb bona presentació.", es: "Completa las actividades en el tiempo previsto y con buena presentación." },
      { id: "T3", val: "Treballa amb ordre i segueix adequadament les indicacions.", es: "Trabaja con orden y sigue adecuadamente las indicaciones." },
      { id: "T4", val: "Mostra constància en el treball diari i una bona disposició.", es: "Muestra constancia en el trabajo diario y una buena disposición." },
      { id: "T5", val: "Necessita reforçar l'hàbit de treball i acabar les tasques proposades.", es: "Necesita reforzar el hábito de trabajo y terminar las tareas propuestas." },
    ],
  },
  progreso: {
    label: "Progreso",
    options: [
      { id: "P1", val: "Progressa adequadament en els continguts treballats.", es: "Progresa adecuadamente en los contenidos trabajados." },
      { id: "P2", val: "Ha mostrat una evolució positiva al llarg del trimestre.", es: "Ha mostrado una evolución positiva a lo largo del trimestre." },
      { id: "P3", val: "Consolida progressivament els aprenentatges bàsics.", es: "Consolida progresivamente los aprendizajes básicos." },
      { id: "P4", val: "Avança amb seguretat quan treballa amb atenció i constància.", es: "Avanza con seguridad cuando trabaja con atención y constancia." },
      { id: "P5", val: "Encara necessita suport per consolidar alguns aprenentatges.", es: "Todavía necesita apoyo para consolidar algunos aprendizajes." },
    ],
  },
};

function cloneCommentCategories(categories) {
  const ids = Object.keys(categories || {});
  return Object.fromEntries(
    ids.map((categoryId) => {
      const category = categories[categoryId] || DEFAULT_COMMENT_CATEGORIES[categoryId];
      return [categoryId, {
        label: category?.label || categoryId,
        options: (category.options || []).map((option) => ({
          id: option.id,
          val: option.val,
          es: option.es,
        })),
      }];
    })
  );
}

function getDefaultCommentCategories() {
  return cloneCommentCategories(DEFAULT_COMMENT_CATEGORIES);
}

let state;
setLanguagePreferenceGetter(() => {
  const pref = state?.ui?.language;
  return typeof pref === "string" ? pref : "auto";
});

function getLanguagePreference() {
  const pref = state?.ui?.language;
  return typeof pref === "string" ? pref : "auto";
}

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getDefaultCommentCategoryOrder() {
  return [...DEFAULT_COMMENT_CATEGORY_ORDER];
}

function getCommentCategoryOrder() {
  const evalUi = ensureEvaluationUi();
  const ids = Array.isArray(evalUi.categoryOrder) ? evalUi.categoryOrder : [];
  return ids.length ? [...ids] : getDefaultCommentCategoryOrder();
}

function makeBlankEvaluationPeriod(categoryIds = getDefaultCommentCategoryOrder()) {
  return {
    selections: Object.fromEntries(categoryIds.map((categoryId) => [categoryId, ""])),
    observation: "",
    comment: "",
    lastAutoComment: "",
  };
}

function defaultStudentEvaluation() {
  return {
    periods: Object.fromEntries(EVALUATION_PERIODS.map((periodId) => [periodId, makeBlankEvaluationPeriod()])),
  };
}

function defaultEvaluationUi() {
  return {
    selectedStudentByClass: {},
    completionFilterByClass: {},
    activeCategoryByClass: {},
    commentLanguageMode: "bilingual",
    activePeriodByClass: {},
    bulkCopyTargetByClass: {},
    phraseCatalog: getDefaultCommentCategories(),
    categoryOrder: getDefaultCommentCategoryOrder(),
  };
}

/** @returns {AppState} */
function defaultState() {
  /** @type {Record<string, { name: string, students: Student[] }>} */
  const classes = {};
  for (let i = 1; i <= 12; i++) {
    const id = `clase_${String(i).padStart(2, "0")}`;
    classes[id] = { name: t("class.default", { index: i }), students: [] };
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
      language: "auto",
      evaluation: defaultEvaluationUi(),
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
    if (!migrated.ui) migrated.ui = { minCountByClass: {}, language: "auto" };
    if (!migrated.ui.minCountByClass) migrated.ui.minCountByClass = {};
    if (!migrated.ui.minPositiveByClass) migrated.ui.minPositiveByClass = {};
    if (typeof migrated.ui.language !== "string") migrated.ui.language = "auto";
    if (!SUPPORTED_LANGUAGES.includes(migrated.ui.language) && migrated.ui.language !== "auto") {
      migrated.ui.language = "auto";
    }
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
    if (!migrated.ui.evaluation || typeof migrated.ui.evaluation !== "object") {
      migrated.ui.evaluation = defaultEvaluationUi();
    }
    if (!migrated.ui.evaluation.selectedStudentByClass || typeof migrated.ui.evaluation.selectedStudentByClass !== "object") {
      migrated.ui.evaluation.selectedStudentByClass = {};
    }
    if (!migrated.ui.evaluation.completionFilterByClass || typeof migrated.ui.evaluation.completionFilterByClass !== "object") {
      migrated.ui.evaluation.completionFilterByClass = {};
    }
    if (!migrated.ui.evaluation.activeCategoryByClass || typeof migrated.ui.evaluation.activeCategoryByClass !== "object") {
      migrated.ui.evaluation.activeCategoryByClass = {};
    }
    if (!migrated.ui.evaluation.activePeriodByClass || typeof migrated.ui.evaluation.activePeriodByClass !== "object") {
      migrated.ui.evaluation.activePeriodByClass = {};
    }
    if (!migrated.ui.evaluation.bulkCopyTargetByClass || typeof migrated.ui.evaluation.bulkCopyTargetByClass !== "object") {
      migrated.ui.evaluation.bulkCopyTargetByClass = {};
    }
    if (!migrated.ui.evaluation.phraseCatalog || typeof migrated.ui.evaluation.phraseCatalog !== "object") {
      migrated.ui.evaluation.phraseCatalog = getDefaultCommentCategories();
    }
    if (!Array.isArray(migrated.ui.evaluation.categoryOrder)) {
      migrated.ui.evaluation.categoryOrder = Object.keys(migrated.ui.evaluation.phraseCatalog || {});
    }
    if (!COMMENT_LANGUAGE_MODES.includes(migrated.ui.evaluation.commentLanguageMode)) {
      migrated.ui.evaluation.commentLanguageMode = "bilingual";
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
        if (!s.evaluation || typeof s.evaluation !== "object") s.evaluation = defaultStudentEvaluation();
        if (!s.evaluation.periods || typeof s.evaluation.periods !== "object") {
          const legacy = {
            selections: s.evaluation.selections,
            observation: s.evaluation.observation,
            comment: s.evaluation.comment,
            lastAutoComment: s.evaluation.lastAutoComment,
          };
          s.evaluation = defaultStudentEvaluation();
          if (legacy && typeof legacy === "object") {
            const target = s.evaluation.periods.eval1;
            if (legacy.selections && typeof legacy.selections === "object") {
              for (const categoryId of getDefaultCommentCategoryOrder()) {
                if (typeof legacy.selections[categoryId] === "string") target.selections[categoryId] = legacy.selections[categoryId];
              }
            }
            if (typeof legacy.observation === "string") target.observation = legacy.observation;
            if (typeof legacy.comment === "string") target.comment = legacy.comment;
            if (typeof legacy.lastAutoComment === "string") target.lastAutoComment = legacy.lastAutoComment;
          }
        }
        for (const periodId of EVALUATION_PERIODS) {
          if (!s.evaluation.periods[periodId] || typeof s.evaluation.periods[periodId] !== "object") {
            s.evaluation.periods[periodId] = makeBlankEvaluationPeriod();
          }
          const period = s.evaluation.periods[periodId];
          if (!period.selections || typeof period.selections !== "object") {
            period.selections = makeBlankEvaluationPeriod().selections;
          }
          for (const categoryId of Object.keys(migrated.ui.evaluation.phraseCatalog || DEFAULT_COMMENT_CATEGORIES)) {
            if (typeof period.selections[categoryId] !== "string") period.selections[categoryId] = "";
          }
          if (typeof period.observation !== "string") period.observation = "";
          if (typeof period.comment !== "string") period.comment = "";
          if (typeof period.lastAutoComment !== "string") period.lastAutoComment = "";
        }

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

// ------------------------------
// Estado y helpers de evaluacion
// ------------------------------

function ensureEvaluationUi() {
  if (!state.ui) state.ui = defaultState().ui;
  if (!state.ui.evaluation || typeof state.ui.evaluation !== "object") {
    state.ui.evaluation = defaultEvaluationUi();
  }
  const evalUi = state.ui.evaluation;
  if (!evalUi.selectedStudentByClass || typeof evalUi.selectedStudentByClass !== "object") {
    evalUi.selectedStudentByClass = {};
  }
  if (!evalUi.completionFilterByClass || typeof evalUi.completionFilterByClass !== "object") {
    evalUi.completionFilterByClass = {};
  }
  if (!evalUi.activeCategoryByClass || typeof evalUi.activeCategoryByClass !== "object") {
    evalUi.activeCategoryByClass = {};
  }
  if (!evalUi.activePeriodByClass || typeof evalUi.activePeriodByClass !== "object") {
    evalUi.activePeriodByClass = {};
  }
  if (!evalUi.bulkCopyTargetByClass || typeof evalUi.bulkCopyTargetByClass !== "object") {
    evalUi.bulkCopyTargetByClass = {};
  }
  if (!evalUi.phraseCatalog || typeof evalUi.phraseCatalog !== "object") {
    evalUi.phraseCatalog = getDefaultCommentCategories();
  }
  if (!Array.isArray(evalUi.categoryOrder)) {
    evalUi.categoryOrder = Object.keys(evalUi.phraseCatalog || {});
  }
  const validIds = new Set(Object.keys(evalUi.phraseCatalog || {}));
  evalUi.categoryOrder = evalUi.categoryOrder.filter((categoryId) => validIds.has(categoryId));
  for (const categoryId of validIds) {
    if (!evalUi.categoryOrder.includes(categoryId)) evalUi.categoryOrder.push(categoryId);
  }
  if (!COMMENT_LANGUAGE_MODES.includes(evalUi.commentLanguageMode)) {
    evalUi.commentLanguageMode = "bilingual";
  }
  return evalUi;
}

function getCommentCategories() {
  const phraseCatalog = ensureEvaluationUi().phraseCatalog;
  return cloneCommentCategories(phraseCatalog);
}

function ensureStudentEvaluation(student) {
  if (!student.evaluation || typeof student.evaluation !== "object") {
    student.evaluation = defaultStudentEvaluation();
  }
  const categoryIds = getCommentCategoryOrder();
  if (!student.evaluation.periods || typeof student.evaluation.periods !== "object") {
    student.evaluation.periods = defaultStudentEvaluation().periods;
  }
  for (const periodId of EVALUATION_PERIODS) {
    if (!student.evaluation.periods[periodId] || typeof student.evaluation.periods[periodId] !== "object") {
      student.evaluation.periods[periodId] = makeBlankEvaluationPeriod(categoryIds);
    }
    const period = student.evaluation.periods[periodId];
    if (!period.selections || typeof period.selections !== "object") {
      period.selections = makeBlankEvaluationPeriod(categoryIds).selections;
    }
    for (const categoryId of categoryIds) {
      if (typeof period.selections[categoryId] !== "string") {
        period.selections[categoryId] = "";
      }
    }
    if (typeof period.observation !== "string") period.observation = "";
    if (typeof period.comment !== "string") period.comment = "";
    if (typeof period.lastAutoComment !== "string") period.lastAutoComment = "";
  }
  return student.evaluation;
}

function getActiveEvaluationPeriodForSelectedClass() {
  const evalUi = ensureEvaluationUi();
  const current = evalUi.activePeriodByClass[selectedClassId];
  return EVALUATION_PERIODS.includes(current) ? current : "eval1";
}

function setActiveEvaluationPeriodForSelectedClass(periodId) {
  const evalUi = ensureEvaluationUi();
  evalUi.activePeriodByClass[selectedClassId] = EVALUATION_PERIODS.includes(periodId) ? periodId : "eval1";
  const target = getBulkCopyTargetPeriodForSelectedClass();
  if (target === evalUi.activePeriodByClass[selectedClassId]) {
    setBulkCopyTargetPeriodForSelectedClass(getDefaultBulkCopyTarget(evalUi.activePeriodByClass[selectedClassId]));
  }
  saveState(state);
}

function getDefaultBulkCopyTarget(sourcePeriodId) {
  const sourceIndex = EVALUATION_PERIODS.indexOf(sourcePeriodId);
  if (sourceIndex >= 0 && sourceIndex < EVALUATION_PERIODS.length - 1) {
    return EVALUATION_PERIODS[sourceIndex + 1];
  }
  return EVALUATION_PERIODS[Math.max(0, sourceIndex - 1)] || "eval1";
}

function getBulkCopyTargetPeriodForSelectedClass() {
  const evalUi = ensureEvaluationUi();
  const sourcePeriod = getActiveEvaluationPeriodForSelectedClass();
  const current = evalUi.bulkCopyTargetByClass[selectedClassId];
  if (current && current !== sourcePeriod && EVALUATION_PERIODS.includes(current)) return current;
  const fallback = getDefaultBulkCopyTarget(sourcePeriod);
  evalUi.bulkCopyTargetByClass[selectedClassId] = fallback;
  return fallback;
}

function setBulkCopyTargetPeriodForSelectedClass(periodId) {
  const evalUi = ensureEvaluationUi();
  const sourcePeriod = getActiveEvaluationPeriodForSelectedClass();
  const fallback = getDefaultBulkCopyTarget(sourcePeriod);
  evalUi.bulkCopyTargetByClass[selectedClassId] =
    periodId && periodId !== sourcePeriod && EVALUATION_PERIODS.includes(periodId) ? periodId : fallback;
  saveState(state);
}

function getEvaluationPeriodData(student, periodId = getActiveEvaluationPeriodForSelectedClass()) {
  const evaluation = ensureStudentEvaluation(student);
  if (!evaluation.periods[periodId]) {
    evaluation.periods[periodId] = defaultStudentEvaluation().periods[periodId];
  }
  return evaluation.periods[periodId];
}

function getCompletionFilterForSelectedClass() {
  const evalUi = ensureEvaluationUi();
  const value = evalUi.completionFilterByClass[selectedClassId];
  return value === "pending" || value === "completed" ? value : "all";
}

function setCompletionFilterForSelectedClass(value) {
  const evalUi = ensureEvaluationUi();
  evalUi.completionFilterByClass[selectedClassId] = value === "pending" || value === "completed" ? value : "all";
  saveState(state);
}

function getCommentLanguageMode() {
  return ensureEvaluationUi().commentLanguageMode;
}

function setCommentLanguageMode(value) {
  const evalUi = ensureEvaluationUi();
  evalUi.commentLanguageMode = COMMENT_LANGUAGE_MODES.includes(value) ? value : "bilingual";
  saveState(state);
}

function getActiveCategoryForSelectedClass() {
  const evalUi = ensureEvaluationUi();
  const current = evalUi.activeCategoryByClass[selectedClassId];
  const categoryIds = getCommentCategoryOrder();
  return categoryIds.includes(current) ? current : categoryIds[0];
}

function setActiveCategoryForSelectedClass(categoryId) {
  const evalUi = ensureEvaluationUi();
  const categoryIds = getCommentCategoryOrder();
  evalUi.activeCategoryByClass[selectedClassId] = categoryIds.includes(categoryId)
    ? categoryId
    : categoryIds[0];
}

function getSelectedStudentIdForSelectedClass() {
  return ensureEvaluationUi().selectedStudentByClass[selectedClassId] ?? "";
}

function setSelectedStudentIdForSelectedClass(studentId) {
  ensureEvaluationUi().selectedStudentByClass[selectedClassId] = studentId ?? "";
}

function normalizeCommentText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.?!])(?=[^\s])/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function findOptionById(categoryId, optionId) {
  return getCommentCategories()[categoryId]?.options.find((option) => option.id === optionId);
}

function getFormattedStudentFirstName(studentName) {
  const firstName = String(studentName ?? "").trim().split(/\s+/)[0] || "";
  if (!firstName) return "";
  const lower = firstName.toLocaleLowerCase();
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
}

function lowercaseSentenceStart(text) {
  return String(text ?? "").replace(/^([^A-Za-zÀ-ÖØ-Þà-öø-ÿ]*)([A-Za-zÀ-ÖØ-ÞÀ-ß])/u, (match, prefix, letter) => {
    void match;
    return `${prefix}${letter.toLocaleLowerCase()}`;
  });
}

function prependStudentFirstName(text, studentName) {
  const normalized = normalizeCommentText(text);
  if (!normalized) return "";
  const firstName = getFormattedStudentFirstName(studentName);
  if (!firstName) return normalized;
  return normalizeCommentText(`${firstName} ${lowercaseSentenceStart(normalized)}`);
}

function buildStudentComments(student, periodId = getActiveEvaluationPeriodForSelectedClass()) {
  const evaluation = getEvaluationPeriodData(student, periodId);
  const categoryIds = getCommentCategoryOrder();
  const valParts = [];
  const esParts = [];

  for (const categoryId of categoryIds) {
    const option = findOptionById(categoryId, evaluation.selections[categoryId]);
    if (!option) continue;
    valParts.push(option.val);
    esParts.push(option.es);
  }

  if (evaluation.observation.trim()) {
    valParts.push(evaluation.observation.trim());
    esParts.push(evaluation.observation.trim());
  }

  const valenciano = prependStudentFirstName(valParts.join(" "), student.name);
  const castellano = prependStudentFirstName(esParts.join(" "), student.name);
  const mode = getCommentLanguageMode();

  let finalComment = "";
  if (mode === "val") finalComment = valenciano;
  else if (mode === "es") finalComment = castellano;
  else {
    const sections = [];
    if (valenciano) sections.push(`Valencià:\n${valenciano}`);
    if (castellano) sections.push(`Castellano:\n${castellano}`);
    finalComment = sections.join("\n\n").trim();
  }

  return {
    valenciano,
    castellano,
    finalComment,
  };
}

function syncStudentEvaluationComment(student, forceOverwrite = false, periodId = getActiveEvaluationPeriodForSelectedClass()) {
  const evaluation = getEvaluationPeriodData(student, periodId);
  const generated = buildStudentComments(student, periodId).finalComment;
  if (forceOverwrite || !evaluation.comment || evaluation.comment === evaluation.lastAutoComment) {
    evaluation.comment = generated;
  }
  evaluation.lastAutoComment = generated;
}

function isStudentCompleted(student) {
  const periodId = getActiveEvaluationPeriodForSelectedClass();
  const evaluation = getEvaluationPeriodData(student, periodId);
  const hasSelection = getCommentCategoryOrder().some((categoryId) => Boolean(evaluation.selections[categoryId]));
  return hasSelection || Boolean(normalizeCommentText(evaluation.comment));
}

// ------------------------------
// Importacion y utilidades de archivo
// ------------------------------

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
      s.onerror = () => reject(new Error(t("pdf.error.load", { url })));
      document.head.appendChild(s);
    });
  }

  let lastError;
  for (const src of sources) {
    try {
      await loadScript(src.script);
      // @ts-ignore
      const pdfjsLib = window.pdfjsLib;
      if (!pdfjsLib) throw new Error(t("pdf.error.noExpose"));
      pdfjsLib.GlobalWorkerOptions.workerSrc = src.worker;
      return pdfjsLib;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(t("pdf.error.final"));
}

/** @param {File} file */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error(t("file.error.read")));
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

// ------------------------------
// Referencias DOM
// ------------------------------

const classSelect = /** @type {HTMLSelectElement} */ (el("classSelect"));
const classNameInput = /** @type {HTMLInputElement} */ (el("className"));
const saveClassNameBtn = /** @type {HTMLButtonElement} */ (el("saveClassNameBtn"));
const resetClassBtn = /** @type {HTMLButtonElement} */ (el("resetClassBtn"));
const quickExportBtn = /** @type {HTMLButtonElement} */ (el("quickExportBtn"));
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
const phraseEditors = /** @type {HTMLDivElement} */ (el("phraseEditors"));
const addCategoryBtn = /** @type {HTMLButtonElement} */ (el("addCategoryBtn"));
const savePhrasesBtn = /** @type {HTMLButtonElement} */ (el("savePhrasesBtn"));
const resetPhrasesBtn = /** @type {HTMLButtonElement} */ (el("resetPhrasesBtn"));
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
const completionFilterSelect = /** @type {HTMLSelectElement} */ (el("completionFilter"));
const minCountInput = /** @type {HTMLInputElement} */ (el("minCount"));
const minPositiveInput = /** @type {HTMLInputElement} */ (el("minPositive"));
const clearFilterBtn = /** @type {HTMLButtonElement} */ (el("clearFilterBtn"));
const negMinutesPerPointInput = /** @type {HTMLInputElement} */ (el("negMinutesPerPoint"));
const posMinutesPerPointInput = /** @type {HTMLInputElement} */ (el("posMinutesPerPoint"));
const languageSelect = /** @type {HTMLSelectElement} */ (el("languageSelect"));
const evalCurrentName = /** @type {HTMLElement} */ (el("evalCurrentName"));
const evalCurrentMeta = /** @type {HTMLElement} */ (el("evalCurrentMeta"));
const evalProgressText = /** @type {HTMLElement} */ (el("evalProgressText"));
const evalPendingCount = /** @type {HTMLElement} */ (el("evalPendingCount"));
const evalCurrentState = /** @type {HTMLElement} */ (el("evalCurrentState"));
const evalEmpty = /** @type {HTMLDivElement} */ (el("evalEmpty"));
const evalWorkspace = /** @type {HTMLDivElement} */ (el("evalWorkspace"));
const evalCategories = /** @type {HTMLDivElement} */ (el("evalCategories"));
const evaluationPeriodSelect = /** @type {HTMLSelectElement} */ (el("evaluationPeriod"));
const evalObservation = /** @type {HTMLTextAreaElement} */ (el("evalObservation"));
const evalComment = /** @type {HTMLTextAreaElement} */ (el("evalComment"));
const openEvalHelpBtn = /** @type {HTMLButtonElement} */ (el("openEvalHelpBtn"));
const evalHelpDialog = /** @type {HTMLDialogElement} */ (el("evalHelpDialog"));
const closeEvalHelpBtn = /** @type {HTMLButtonElement} */ (el("closeEvalHelpBtn"));
const commentLanguageModeSelect = /** @type {HTMLSelectElement} */ (el("commentLanguageMode"));
const bulkCopyTargetPeriodSelect = /** @type {HTMLSelectElement} */ (el("bulkCopyTargetPeriod"));
const copyPeriodToPeriodBtn = /** @type {HTMLButtonElement} */ (el("copyPeriodToPeriodBtn"));
const copyFromPreviousBtn = /** @type {HTMLButtonElement} */ (el("copyFromPreviousBtn"));
const copyToAllBtn = /** @type {HTMLButtonElement} */ (el("copyToAllBtn"));
const copyCommentBtn = /** @type {HTMLButtonElement} */ (el("copyCommentBtn"));
const copyNextBtn = /** @type {HTMLButtonElement} */ (el("copyNextBtn"));
const saveEvaluationBtn = /** @type {HTMLButtonElement} */ (el("saveEvaluationBtn"));
const resetEvaluationBtn = /** @type {HTMLButtonElement} */ (el("resetEvaluationBtn"));
const exportCsvBtn = /** @type {HTMLButtonElement} */ (el("exportCsvBtn"));

state = loadState();
let selectedClassId = Object.keys(state.classes)[0] ?? "clase_01";
let lastHistoryStudentId = null;

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
  if (!state.ui) state.ui = defaultState().ui;
  if (!state.ui.minCountByClass) state.ui.minCountByClass = {};
  state.ui.minCountByClass[selectedClassId] = n;
  saveState(state);
}

function setMinPositiveForSelectedClass(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (!state.ui) state.ui = defaultState().ui;
  if (!state.ui.minPositiveByClass) state.ui.minPositiveByClass = {};
  state.ui.minPositiveByClass[selectedClassId] = n;
  saveState(state);
}

function setStatus(text) {
  status.textContent = text;
}

function setLanguagePreference(value) {
  if (!state.ui) state.ui = defaultState().ui;
  const next = typeof value === "string" && value ? value : "auto";
  state.ui.language = next;
  saveState(state);
  applyI18n();
}

function applyI18n() {
  const lang = getResolvedLanguage();
  document.documentElement.lang = lang;

  const nodes = document.querySelectorAll("[data-i18n]");
  for (const node of nodes) {
    const key = node.getAttribute("data-i18n");
    if (key) node.textContent = t(key);
  }

  const attrNodes = document.querySelectorAll("[data-i18n-attr]");
  for (const node of attrNodes) {
    const raw = node.getAttribute("data-i18n-attr");
    if (!raw) continue;
    const pairs = raw.split("|");
    for (const pair of pairs) {
      const [attr, key] = pair.split(":");
      if (!attr || !key) continue;
      node.setAttribute(attr, t(key));
    }
  }

  if (languageSelect) {
    const pref = getLanguagePreference();
    languageSelect.value = SUPPORTED_LANGUAGES.includes(pref) || pref === "auto" ? pref : "auto";
  }

  renderStudents();
  if (timerDialog.hasAttribute("open") || timerDialog.open) {
    renderTimerModal();
  }
  if ((historyDialog.hasAttribute("open") || historyDialog.open) && lastHistoryStudentId) {
    const cls = getSelectedClass();
    const student = cls.students.find((s) => s.id === lastHistoryStudentId);
    if (student) renderHistoryModal(student);
  }
  if (classHistoryDialog.hasAttribute("open") || classHistoryDialog.open) {
    renderClassHistoryModal();
  }
  renderPhraseEditors();

  document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang } }));
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

function serializePhraseLines(categoryId) {
  const category = getCommentCategories()[categoryId];
  return (category?.options || [])
    .map((option) => `${option.id} | ${option.val} | ${option.es}`)
    .join("\n");
}

function renderPhraseEditors() {
  const categories = getCommentCategories();
  const categoryIds = getCommentCategoryOrder();
  phraseEditors.innerHTML = "";

  for (const categoryId of categoryIds) {
    const category = categories[categoryId];
    const card = document.createElement("div");
    card.className = "configCard";
    card.dataset.categoryId = categoryId;

    const header = document.createElement("div");
    header.className = "configCard__header";

    const nameField = document.createElement("label");
    nameField.className = "field field--grow";

    const nameLabel = document.createElement("span");
    nameLabel.className = "field__label";
    nameLabel.textContent = t("config.phrases.categoryName");

    const nameInput = document.createElement("input");
    nameInput.className = "field__input";
    nameInput.type = "text";
    nameInput.value = category.label || categoryId;
    nameInput.dataset.role = "category-label";

    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);

    const idField = document.createElement("label");
    idField.className = "field";

    const idLabel = document.createElement("span");
    idLabel.className = "field__label";
    idLabel.textContent = t("config.phrases.categoryId");

    const idInput = document.createElement("input");
    idInput.className = "field__input field__input--small";
    idInput.type = "text";
    idInput.value = categoryId;
    idInput.dataset.role = "category-id";
    idInput.disabled = true;

    idField.appendChild(idLabel);
    idField.appendChild(idInput);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn--secondary";
    removeBtn.textContent = t("config.phrases.removeCategory");
    removeBtn.disabled = categoryIds.length <= 1;
    removeBtn.addEventListener("click", () => {
      const nextCatalog = getCommentCategories();
      delete nextCatalog[categoryId];
      const evalUi = ensureEvaluationUi();
      evalUi.phraseCatalog = cloneCommentCategories(nextCatalog);
      evalUi.categoryOrder = getCommentCategoryOrder().filter((id) => id !== categoryId);
      saveState(state);
      renderPhraseEditors();
      renderStudents();
    });

    const moveUpBtn = document.createElement("button");
    moveUpBtn.type = "button";
    moveUpBtn.className = "btn btn--secondary";
    moveUpBtn.textContent = t("config.phrases.moveUp");
    moveUpBtn.disabled = categoryIds.indexOf(categoryId) === 0;
    moveUpBtn.addEventListener("click", () => {
      movePhraseCategory(categoryId, -1);
    });

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button";
    moveDownBtn.className = "btn btn--secondary";
    moveDownBtn.textContent = t("config.phrases.moveDown");
    moveDownBtn.disabled = categoryIds.indexOf(categoryId) === categoryIds.length - 1;
    moveDownBtn.addEventListener("click", () => {
      movePhraseCategory(categoryId, 1);
    });

    header.appendChild(nameField);
    header.appendChild(idField);
    header.appendChild(moveUpBtn);
    header.appendChild(moveDownBtn);
    header.appendChild(removeBtn);

    const textareaField = document.createElement("label");
    textareaField.className = "field";

    const textareaLabel = document.createElement("span");
    textareaLabel.className = "field__label";
    textareaLabel.textContent = t("config.phrases.lines");

    const textarea = document.createElement("textarea");
    textarea.className = "field__input field__textarea";
    textarea.rows = 7;
    textarea.value = serializePhraseLines(categoryId);
    textarea.placeholder = t("config.phrases.placeholder");
    textarea.dataset.role = "category-lines";

    textareaField.appendChild(textareaLabel);
    textareaField.appendChild(textarea);

    card.appendChild(header);
    card.appendChild(textareaField);
    phraseEditors.appendChild(card);
  }
}

function parsePhraseEditorValue(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 3) throw new Error(t("config.phrases.error.format"));
    const [id, val, es] = [parts[0], parts[1], parts.slice(2).join(" | ")];
    if (!id || !val || !es) throw new Error(t("config.phrases.error.empty"));
    return { id, val, es };
  });
}

function saveCustomPhrases() {
  const phraseCatalog = {};
  const cards = Array.from(phraseEditors.querySelectorAll(".configCard"));
  if (!cards.length) throw new Error(t("config.phrases.error.noCategories"));

  for (const card of cards) {
    if (!(card instanceof HTMLElement)) continue;
    const idInput = /** @type {HTMLInputElement|null} */ (card.querySelector('[data-role="category-id"]'));
    const labelInput = /** @type {HTMLInputElement|null} */ (card.querySelector('[data-role="category-label"]'));
    const linesInput = /** @type {HTMLTextAreaElement|null} */ (card.querySelector('[data-role="category-lines"]'));
    const categoryId = String(idInput?.value ?? "").trim();
    const label = String(labelInput?.value ?? "").trim();
    if (!categoryId || !label) throw new Error(t("config.phrases.error.categoryName"));
    phraseCatalog[categoryId] = {
      label,
      options: parsePhraseEditorValue(linesInput?.value ?? ""),
    };
  }

  const evalUi = ensureEvaluationUi();
  evalUi.phraseCatalog = cloneCommentCategories(phraseCatalog);
  evalUi.categoryOrder = cards
    .map((card) => /** @type {HTMLInputElement|null} */ (card.querySelector('[data-role="category-id"]'))?.value ?? "")
    .map((value) => String(value).trim())
    .filter(Boolean);
  saveState(state);
  renderPhraseEditors();
  renderStudents();
  setTransientStatus(t("config.phrases.saved"));
}

function resetCustomPhrases() {
  ensureEvaluationUi().phraseCatalog = getDefaultCommentCategories();
  ensureEvaluationUi().categoryOrder = getDefaultCommentCategoryOrder();
  saveState(state);
  renderPhraseEditors();
  renderStudents();
  setTransientStatus(t("config.phrases.resetDone"));
}

function movePhraseCategory(categoryId, delta) {
  const evalUi = ensureEvaluationUi();
  const order = [...getCommentCategoryOrder()];
  const index = order.indexOf(categoryId);
  if (index < 0) return;
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= order.length) return;
  const [moved] = order.splice(index, 1);
  order.splice(nextIndex, 0, moved);
  evalUi.categoryOrder = order;
  saveState(state);
  renderPhraseEditors();
  renderStudents();
}

function slugifyCategoryId(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function addPhraseCategory() {
  const label = prompt(t("config.phrases.promptCategory"));
  if (label === null) return;
  const trimmed = label.trim();
  if (!trimmed) {
    setTransientStatus(t("config.phrases.error.categoryName"), 4000);
    return;
  }

  let categoryId = slugifyCategoryId(trimmed);
  if (!categoryId) {
    setTransientStatus(t("config.phrases.error.categoryId"), 4000);
    return;
  }

  const catalog = getCommentCategories();
  let suffix = 2;
  const baseId = categoryId;
  while (catalog[categoryId]) {
    categoryId = `${baseId}_${suffix}`;
    suffix += 1;
  }

  catalog[categoryId] = {
    label: trimmed,
    options: [],
  };

  const evalUi = ensureEvaluationUi();
  evalUi.phraseCatalog = cloneCommentCategories(catalog);
  evalUi.categoryOrder = [...getCommentCategoryOrder(), categoryId];
  saveState(state);
  renderPhraseEditors();
  setTransientStatus(t("config.phrases.categoryAdded"));
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
  setTransientStatus(t("status.backup.exported"));
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
    setTransientStatus(t("status.backup.selectJson"));
    return;
  }

  const ok = confirm(t("confirm.backup.import"));
  if (!ok) return;

  const text = await readFileAsText(file);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    setTransientStatus(t("error.backup.invalidJson"), 4000);
    return;
  }

  const nextState = extractStateFromBackupPayload(parsed);
  if (!nextState) {
    setTransientStatus(t("error.backup.formatUnknown"), 4000);
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
  completionFilterSelect.value = getCompletionFilterForSelectedClass();
  evaluationPeriodSelect.value = getActiveEvaluationPeriodForSelectedClass();
  commentLanguageModeSelect.value = getCommentLanguageMode();
  minCountInput.value = String(getMinCountForSelectedClass());
  minPositiveInput.value = String(getMinPositiveForSelectedClass());
  renderStudents();

  importBackupFile.value = "";
  setTransientStatus(t("status.backup.imported"));
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
    state.ui = defaultState().ui;
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
  setTransientStatus(t("status.timerStarted"));
}

function pauseGlobalTimer() {
  if (!state.ui) {
    state.ui = defaultState().ui;
  }
  if (!state.ui.timerRunning) return;

  state.ui.timerRunning = false;
  state.ui.timerFrozenAt = Date.now();
  state.ui.lastTickNow = state.ui.timerFrozenAt;
  saveState(state);
  syncTimerControls();
  renderStudents();
  setTransientStatus(t("status.timerPaused"));
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
  openDialog(timerDialog);
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
    alert(t("alert.classNameEmpty"));
    classNameInput.value = cls.name;
    return;
  }
  cls.name = next;
  saveState(state);
  renderClassSelect();
  renderClassNameInput();
  setStatus(t("status.classNameSaved"));
}

// ------------------------------
// Render principal
// ------------------------------

function getFilteredStudentsForSelectedClass() {
  const cls = getSelectedClass();
  const minNeg = getMinCountForSelectedClass();
  const minPos = getMinPositiveForSelectedClass();
  const completionFilter = getCompletionFilterForSelectedClass();

  return cls.students.filter((student) => {
    ensureStudentEvaluation(student);
    if ((student.count ?? 0) < minNeg || (student.positiveCount ?? 0) < minPos) return false;
    if (completionFilter === "pending") return !isStudentCompleted(student);
    if (completionFilter === "completed") return isStudentCompleted(student);
    return true;
  });
}

function ensureSelectedStudent() {
  const cls = getSelectedClass();
  const selectedId = getSelectedStudentIdForSelectedClass();
  const visibleStudents = getFilteredStudentsForSelectedClass();
  const visibleIds = new Set(visibleStudents.map((student) => student.id));

  if (selectedId && visibleIds.has(selectedId)) return selectedId;

  const fallback = visibleStudents[0]?.id ?? cls.students[0]?.id ?? "";
  setSelectedStudentIdForSelectedClass(fallback);
  return fallback;
}

function getSelectedStudent() {
  const cls = getSelectedClass();
  const selectedId = ensureSelectedStudent();
  return cls.students.find((student) => student.id === selectedId) ?? null;
}

function getSelectedStudentPosition(studentId) {
  const cls = getSelectedClass();
  const allIndex = cls.students.findIndex((student) => student.id === studentId);
  return allIndex >= 0 ? allIndex + 1 : 0;
}

function focusActiveCategoryButton() {
  const categoryId = getActiveCategoryForSelectedClass();
  const button = evalCategories.querySelector(`.evalOption--active[data-category-id="${categoryId}"]`)
    || evalCategories.querySelector(`.evalOption[data-category-id="${categoryId}"]`);
  if (button instanceof HTMLElement) button.focus();
}

function renderEvaluationPanel() {
  const cls = getSelectedClass();
  const students = cls.students;
  const selectedStudent = getSelectedStudent();
  const activePeriod = getActiveEvaluationPeriodForSelectedClass();
  const categories = getCommentCategories();
  const categoryIds = Object.keys(categories);
  const completedCount = students.filter((student) => isStudentCompleted(student)).length;
  const pendingCount = Math.max(0, students.length - completedCount);
  const progress = students.length ? Math.round((completedCount / students.length) * 100) : 0;

  evalPendingCount.textContent = String(pendingCount);
  evalProgressText.textContent = `${progress}%`;
  completionFilterSelect.value = getCompletionFilterForSelectedClass();
  evaluationPeriodSelect.value = activePeriod;
  commentLanguageModeSelect.value = getCommentLanguageMode();
  const bulkTargetPeriod = getBulkCopyTargetPeriodForSelectedClass();
  bulkCopyTargetPeriodSelect.innerHTML = "";
  for (const periodId of EVALUATION_PERIODS) {
    if (periodId === activePeriod) continue;
    const option = document.createElement("option");
    option.value = periodId;
    option.textContent = t(`eval.period.${periodId}`);
    if (periodId === bulkTargetPeriod) option.selected = true;
    bulkCopyTargetPeriodSelect.appendChild(option);
  }
  copyPeriodToPeriodBtn.disabled = students.length === 0;

  if (!selectedStudent) {
    evalCurrentName.textContent = t("eval.noStudents");
    evalCurrentMeta.textContent = "0 de 0";
    evalCurrentState.textContent = "—";
    evalEmpty.hidden = false;
    evalWorkspace.hidden = true;
    evalCategories.innerHTML = "";
    evalObservation.value = "";
    evalComment.value = "";
    bulkCopyTargetPeriodSelect.disabled = true;
    return;
  }

  bulkCopyTargetPeriodSelect.disabled = false;

  syncStudentEvaluationComment(selectedStudent, false, activePeriod);
  const evaluation = getEvaluationPeriodData(selectedStudent, activePeriod);
  const currentPosition = getSelectedStudentPosition(selectedStudent.id);
  const stateKey = isStudentCompleted(selectedStudent) ? "eval.filter.completed" : "eval.filter.pending";
  const periodIndex = EVALUATION_PERIODS.indexOf(activePeriod);

  evalCurrentName.textContent = selectedStudent.name;
  evalCurrentMeta.textContent = `${currentPosition} de ${students.length} · ${t(`eval.period.${activePeriod}`)}`;
  evalCurrentState.textContent = t(stateKey);
  evalEmpty.hidden = students.length !== 0;
  evalWorkspace.hidden = false;
  evalObservation.value = evaluation.observation;
  evalComment.value = evaluation.comment;
  copyFromPreviousBtn.disabled = periodIndex <= 0;

  evalCategories.innerHTML = "";
  const activeCategory = getActiveCategoryForSelectedClass();

  for (const categoryId of categoryIds) {
    const category = categories[categoryId];
    const section = document.createElement("section");
    section.className = "evalCategory";
    section.dataset.categoryId = categoryId;
    if (categoryId === activeCategory) section.dataset.active = "true";

    const header = document.createElement("div");
    header.className = "evalCategory__header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "evalCategory__title";
    title.textContent = category.label;

    const hint = document.createElement("div");
    hint.className = "evalCategory__hint";
    hint.textContent = t("eval.categoryHint");

    titleWrap.appendChild(title);
    titleWrap.appendChild(hint);

    const badge = document.createElement("span");
    badge.className = "evalCategory__badge";
    badge.textContent = `${categoryIds.indexOf(categoryId) + 1}/${categoryIds.length}`;

    header.appendChild(titleWrap);
    header.appendChild(badge);
    section.appendChild(header);

    const options = document.createElement("div");
    options.className = "evalOptions";

    for (const [index, option] of category.options.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "evalOption";
      button.dataset.categoryId = categoryId;
      button.dataset.optionId = option.id;
      button.title = `${option.id} · ${option.es}`;
      if (evaluation.selections[categoryId] === option.id) button.dataset.selected = "true";
      if (categoryId === activeCategory) button.classList.add("evalOption--active");

      const code = document.createElement("span");
      code.className = "evalOption__code";
      code.textContent = `${index + 1}. ${option.id}`;

      const text = document.createElement("span");
      text.className = "evalOption__text";
      text.textContent = option.es;

      button.appendChild(code);
      button.appendChild(text);

      button.addEventListener("click", () => {
        setActiveCategoryForSelectedClass(categoryId);
        evaluation.selections[categoryId] = evaluation.selections[categoryId] === option.id ? "" : option.id;
        syncStudentEvaluationComment(selectedStudent, true, activePeriod);
        saveState(state);
        renderStudents();
      });

      button.addEventListener("focus", () => {
        setActiveCategoryForSelectedClass(categoryId);
        saveState(state);
      });

      options.appendChild(button);
    }

    section.appendChild(options);
    evalCategories.appendChild(section);
  }
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
  const completionFilter = getCompletionFilterForSelectedClass();
  const visibleStudents = getFilteredStudentsForSelectedClass();
  const visibleTotal = visibleStudents.length;
  const completedCount = cls.students.filter((student) => isStudentCompleted(student)).length;
  const pendingCount = Math.max(0, total - completedCount);
  const selectedStudentId = ensureSelectedStudent();

  if (!total) {
    setStatus("");
  } else if (minNeg > 0 || minPos > 0 || completionFilter !== "all") {
    const parts = [];
    if (minNeg > 0) parts.push(`☹︎≥${minNeg}`);
    if (minPos > 0) parts.push(`🙂≥${minPos}`);
    if (completionFilter === "pending") parts.push(t("eval.filter.pending"));
    if (completionFilter === "completed") parts.push(t("eval.filter.completed"));
    setStatus(t("status.showing", { visible: visibleTotal, total, filters: parts.join(" · ") }));
  } else {
    setStatus(t("status.total", { total }));
  }

  studentList.innerHTML = "";
  emptyState.hidden = total !== 0;

  if (total !== 0 && visibleTotal === 0) {
    // Estado vacío por filtro
    emptyState.hidden = false;
    const parts = [];
    if (minNeg > 0) parts.push(`☹︎ ≥ ${minNeg}`);
    if (minPos > 0) parts.push(`🙂 ≥ ${minPos}`);
    if (completionFilter === "pending") parts.push(t("eval.filter.pending"));
    if (completionFilter === "completed") parts.push(t("eval.filter.completed"));
    emptyState.textContent = t("empty.filter", { filters: parts.join(` ${t("join.and")} `) });
  } else {
    emptyState.textContent = t("empty.noStudents");
  }

  for (const student of visibleStudents) {
    const li = document.createElement("li");
    li.className = "item studentItem";
    if (student.id === selectedStudentId) li.dataset.selected = "true";
    if (isStudentCompleted(student)) li.dataset.completed = "true";

    const left = document.createElement("span");
    left.className = "left";

    const completionBadge = document.createElement("span");
    completionBadge.className = "badge";
    completionBadge.textContent = isStudentCompleted(student) ? "✓" : "•";
    if (isStudentCompleted(student)) completionBadge.classList.add("badge--marked");
    left.appendChild(completionBadge);

    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "nameBtn";
    nameBtn.setAttribute("aria-label", t("aria.selectStudent", { name: student.name }));

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = student.name;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = isStudentCompleted(student)
      ? t("eval.list.completedIndicator")
      : t("eval.list.pendingIndicator");

    const hint = document.createElement("span");
    hint.className = "meta meta--soft";
    hint.textContent = student.id === selectedStudentId
      ? t("eval.list.current")
      : t("eval.list.clickToEdit");

    nameBtn.addEventListener("click", () => {
      setSelectedStudentIdForSelectedClass(student.id);
      saveState(state);
      renderStudents();
    });

    nameBtn.appendChild(name);
    nameBtn.appendChild(meta);
    nameBtn.appendChild(hint);
    left.appendChild(nameBtn);

    const right = document.createElement("span");
    right.className = "right";

    const counts = document.createElement("span");
    counts.className = "countGroup";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "miniBtn miniBtn--select";
    selectBtn.textContent = student.id === selectedStudentId
      ? t("eval.list.current")
      : t("eval.list.select");
    selectBtn.setAttribute("aria-label", t("aria.selectStudent", { name: student.name }));
    selectBtn.disabled = student.id === selectedStudentId;
    selectBtn.addEventListener("click", () => {
      setSelectedStudentIdForSelectedClass(student.id);
      saveState(state);
      renderStudents();
    });

    const negCount = document.createElement("span");
    negCount.className = "count";
    negCount.textContent = `☹︎ ${student.count ?? 0}`;
    negCount.setAttribute("aria-label", t("aria.negCount", { count: student.count ?? 0 }));

    const timer = document.createElement("span");
    timer.className = "timer";

    const running = Boolean(state.ui?.timerRunning);
    const remainingMs = getNegativeRemainingMs(student);
    const icon = running ? "⏱" : "⏸";
    timer.textContent = `${icon} ${remainingMs > 0 ? formatRemaining(remainingMs) : "--:--"}`;
    timer.setAttribute("aria-label", t("aria.timerRemaining"));

    timer.dataset.studentId = student.id;

    const posCount = document.createElement("span");
    posCount.className = "count";
    posCount.textContent = `🙂 ${student.positiveCount ?? 0}`;
    posCount.setAttribute("aria-label", t("aria.posCount", { count: student.positiveCount ?? 0 }));

    const negBtn = document.createElement("button");
    negBtn.type = "button";
    negBtn.className = "miniBtn";
    negBtn.textContent = "+☹︎";
    negBtn.setAttribute("aria-label", t("aria.addNeg", { name: student.name }));

    negBtn.addEventListener("click", () => {
      addNegativePoint(student);
      saveState(state);
      renderStudents();
    });

    // Orden: botón +☹︎ junto al contador ☹︎ (a la izquierda)
    counts.appendChild(selectBtn);
    counts.appendChild(negBtn);
    counts.appendChild(negCount);
    counts.appendChild(timer);
    counts.appendChild(posCount);

    const posBtn = document.createElement("button");
    posBtn.type = "button";
    posBtn.className = "miniBtn";
    posBtn.textContent = "+🙂";
    posBtn.setAttribute("aria-label", t("aria.addPos", { name: student.name }));

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
    historyBtn.title = t("history.title");
    historyBtn.setAttribute("aria-label", t("aria.viewHistory", { name: student.name }));
    historyBtn.addEventListener("click", () => {
      openHistoryModal(student);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "miniBtn";
    editBtn.textContent = "✏️";
    editBtn.title = t("action.edit");
    editBtn.setAttribute("aria-label", t("aria.editName", { name: student.name }));

    editBtn.addEventListener("click", () => {
      const cls = getSelectedClass();
      const next = prompt(t("prompt.newName", { name: student.name }), student.name);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) {
        alert(t("alert.nameEmpty"));
        return;
      }

      const key = trimmed.toLocaleLowerCase();
      const clash = cls.students.some(
        (s) => s.id !== student.id && (s.name ?? "").toLocaleLowerCase() === key
      );
      if (clash) {
        alert(t("alert.nameExists"));
        return;
      }

      student.name = trimmed;
      saveState(state);
      renderStudents();
      setTransientStatus(t("status.nameUpdated"));
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "miniBtn miniBtn--danger";
    deleteBtn.textContent = "🗑️";
    deleteBtn.title = t("action.delete");
    deleteBtn.setAttribute("aria-label", t("aria.deleteStudent", { name: student.name }));

    deleteBtn.addEventListener("click", () => {
      const cls = getSelectedClass();
      const ok = confirm(t("confirm.deleteStudent", { student: student.name, className: cls.name }));
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
    li.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("button")) return;
      setSelectedStudentIdForSelectedClass(student.id);
      saveState(state);
      renderStudents();
    });
    studentList.appendChild(li);
  }

  renderEvaluationPanel();
  evalPendingCount.textContent = String(pendingCount);
}

function moveSelection(delta) {
  const visibleStudents = getFilteredStudentsForSelectedClass();
  if (!visibleStudents.length) return;

  const currentId = ensureSelectedStudent();
  const currentIndex = Math.max(0, visibleStudents.findIndex((student) => student.id === currentId));
  const nextIndex = Math.min(visibleStudents.length - 1, Math.max(0, currentIndex + delta));
  setSelectedStudentIdForSelectedClass(visibleStudents[nextIndex].id);
  saveState(state);
  renderStudents();
}

function persistEvaluationUi() {
  saveState(state);
  renderStudents();
}

function syncAndPersistStudentEvaluation(student, forceOverwrite = false, periodId = getActiveEvaluationPeriodForSelectedClass()) {
  syncStudentEvaluationComment(student, forceOverwrite, periodId);
  persistEvaluationUi();
}

function resetEvaluationForStudent(student) {
  const periodId = getActiveEvaluationPeriodForSelectedClass();
  ensureStudentEvaluation(student).periods[periodId] = defaultStudentEvaluation().periods[periodId];
  syncStudentEvaluationComment(student, true, periodId);
}

function cloneEvaluationPeriod(source) {
  return {
    selections: { ...source.selections },
    observation: source.observation,
    comment: source.comment,
    lastAutoComment: source.lastAutoComment,
  };
}

function copyPreviousEvaluationToCurrent(student) {
  const activePeriod = getActiveEvaluationPeriodForSelectedClass();
  const currentIndex = EVALUATION_PERIODS.indexOf(activePeriod);
  if (currentIndex <= 0) return false;
  const previousPeriod = EVALUATION_PERIODS[currentIndex - 1];
  const previousData = getEvaluationPeriodData(student, previousPeriod);
  const cloned = cloneEvaluationPeriod(previousData);
  ensureStudentEvaluation(student).periods[activePeriod] = cloned;
  syncStudentEvaluationComment(student, true, activePeriod);
  return true;
}

function copyCurrentEvaluationToAllVisible() {
  const sourceStudent = getSelectedStudent();
  if (!sourceStudent) return { copied: 0, skipped: 0 };

  const activePeriod = getActiveEvaluationPeriodForSelectedClass();
  const sourceData = cloneEvaluationPeriod(getEvaluationPeriodData(sourceStudent, activePeriod));
  const visibleStudents = getFilteredStudentsForSelectedClass();

  let copied = 0;
  let skipped = 0;
  for (const student of visibleStudents) {
    if (student.id === sourceStudent.id) {
      skipped += 1;
      continue;
    }
    ensureStudentEvaluation(student).periods[activePeriod] = cloneEvaluationPeriod(sourceData);
    syncStudentEvaluationComment(student, true, activePeriod);
    copied += 1;
  }

  persistEvaluationUi();
  return { copied, skipped };
}

function copyEvaluationPeriodForWholeClass(sourcePeriodId, targetPeriodId) {
  const cls = getSelectedClass();
  let copied = 0;
  for (const student of cls.students) {
    const sourceData = cloneEvaluationPeriod(getEvaluationPeriodData(student, sourcePeriodId));
    ensureStudentEvaluation(student).periods[targetPeriodId] = sourceData;
    syncStudentEvaluationComment(student, true, targetPeriodId);
    copied += 1;
  }
  persistEvaluationUi();
  return { copied };
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fallback below.
  }

  const helper = document.createElement("textarea");
  helper.value = value;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  const ok = document.execCommand("copy");
  helper.remove();
  return ok;
}

async function copyCurrentComment(moveNext = false) {
  const student = getSelectedStudent();
  if (!student) return;
  syncStudentEvaluationComment(student);
  saveState(state);
  const ok = await copyTextToClipboard(getEvaluationPeriodData(student).comment);
  setTransientStatus(ok ? t(moveNext ? "eval.status.copiedNext" : "eval.status.copied") : t("eval.status.copyError"), 3000);
  if (moveNext) moveSelection(1);
}

function exportEvaluationsToCsv() {
  const categoryIds = getCommentCategoryOrder();
  /** @type {string[][]} */
  const rows = [[
    "clase",
    "nombre",
    "evaluacion",
    ...categoryIds,
    "observacion_libre",
    "comentario_valenciano",
    "comentario_castellano",
    "comentario_final",
    "estado",
  ]];

  for (const [classId, cls] of Object.entries(state.classes)) {
    void classId;
    for (const student of cls.students) {
      ensureStudentEvaluation(student);
      for (const periodId of EVALUATION_PERIODS) {
        syncStudentEvaluationComment(student, false, periodId);
        const evaluation = getEvaluationPeriodData(student, periodId);
        const generated = buildStudentComments(student, periodId);
        const hasSelection = getCommentCategoryOrder().some((categoryId) => Boolean(evaluation.selections[categoryId]));
        const isCompleted = hasSelection || Boolean(normalizeCommentText(evaluation.comment));
        rows.push([
          cls.name,
          student.name,
          t(`eval.period.${periodId}`),
          ...categoryIds.map((categoryId) => evaluation.selections[categoryId] || ""),
          evaluation.observation || "",
          generated.valenciano,
          generated.castellano,
          evaluation.comment || generated.finalComment,
          isCompleted ? "completado" : "pendiente",
        ]);
      }
    }
  }

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, "\"\"")}"`).join(","))
    .join("\n");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  downloadTextFile(`eduavisos-evaluacion-${ts}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
  saveState(state);
  setTransientStatus(t("eval.status.exported"));
}

function formatEventTs(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/** @param {Student} student */
function renderHistoryModal(student) {
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
}

function openHistoryModal(student) {
  lastHistoryStudentId = student.id;
  renderHistoryModal(student);
  openDialog(historyDialog);
}

function renderClassHistoryModal() {
  const cls = getSelectedClass();
  classHistorySubtitle.textContent = `${t("classHistory.subtitle")} · ${cls.name}`;

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
}

function openClassHistoryModal() {
  renderClassHistoryModal();
  openDialog(classHistoryDialog);
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
    cls.students.push({
      id: uid(),
      name,
      count: 0,
      positiveCount: 0,
      negExpiresAt: undefined,
      negSpentMs: 0,
      evaluation: defaultStudentEvaluation(),
    });
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
    reader.onerror = () => reject(new Error(t("file.error.read")));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

/**
 * Helpers de dialogo reutilizables para mantener el flujo de UI consistente.
 * @param {HTMLDialogElement} dialog
 */
function openDialog(dialog) {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

/**
 * @param {HTMLDialogElement} dialog
 */
function closeDialog(dialog) {
  dialog.close?.();
  dialog.removeAttribute("open");
}

/**
 * @param {HTMLDialogElement} dialog
 */
function bindBackdropClose(dialog) {
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      closeDialog(dialog);
    }
  });
}

function openEvalHelpDialog() {
  openDialog(evalHelpDialog);
}

function closeEvalHelpDialog() {
  closeDialog(evalHelpDialog);
}

// ------------------------------
// Eventos de interfaz
// ------------------------------

// Eventos
openImportBtn.addEventListener("click", () => {
  // Sincroniza valores de configuración al abrir
  negMinutesPerPointInput.value = String(getNegMinutesPerPoint());
  posMinutesPerPointInput.value = String(getPosMinutesPerPoint());
  renderPhraseEditors();
  openDialog(importDialog);
});

closeImportBtn.addEventListener("click", () => {
  closeDialog(importDialog);
});

openEvalHelpBtn.addEventListener("click", () => {
  openEvalHelpDialog();
});

closeEvalHelpBtn.addEventListener("click", () => {
  closeEvalHelpDialog();
});

classSelect.addEventListener("change", () => {
  selectedClassId = classSelect.value;
  completionFilterSelect.value = getCompletionFilterForSelectedClass();
  evaluationPeriodSelect.value = getActiveEvaluationPeriodForSelectedClass();
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

completionFilterSelect.addEventListener("change", () => {
  setCompletionFilterForSelectedClass(completionFilterSelect.value);
  renderStudents();
});

evaluationPeriodSelect.addEventListener("change", () => {
  setActiveEvaluationPeriodForSelectedClass(evaluationPeriodSelect.value);
  renderStudents();
});

bulkCopyTargetPeriodSelect.addEventListener("change", () => {
  setBulkCopyTargetPeriodForSelectedClass(bulkCopyTargetPeriodSelect.value);
  renderEvaluationPanel();
});

clearFilterBtn.addEventListener("click", () => {
  minCountInput.value = "0";
  setMinCountForSelectedClass(0);
  minPositiveInput.value = "0";
  setMinPositiveForSelectedClass(0);
  completionFilterSelect.value = "all";
  setCompletionFilterForSelectedClass("all");
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

languageSelect.addEventListener("change", () => {
  setLanguagePreference(languageSelect.value);
});

commentLanguageModeSelect.addEventListener("change", () => {
  setCommentLanguageMode(commentLanguageModeSelect.value);
  const student = getSelectedStudent();
  if (student) {
    syncAndPersistStudentEvaluation(student, true);
    return;
  }
  persistEvaluationUi();
});

timerPlayBtn.addEventListener("click", () => {
  startGlobalTimer();
});

timerPauseBtn.addEventListener("click", () => {
  pauseGlobalTimer();
});

closeTimerBtn.addEventListener("click", () => {
  closeDialog(timerDialog);
});

closeHistoryBtn.addEventListener("click", () => {
  closeDialog(historyDialog);
});

openClassHistoryBtn.addEventListener("click", () => {
  try {
    openClassHistoryModal();
  } catch (e) {
    setTransientStatus(e instanceof Error ? e.message : t("error.history"), 4000);
  }
});

closeClassHistoryBtn.addEventListener("click", () => {
  closeDialog(classHistoryDialog);
});

bindBackdropClose(importDialog);
bindBackdropClose(evalHelpDialog);
bindBackdropClose(timerDialog);
bindBackdropClose(historyDialog);
bindBackdropClose(classHistoryDialog);

resetClassBtn.addEventListener("click", () => {
  const cls = getSelectedClass();
  if (!cls.students.length) return;
  const ok = confirm(t("confirm.resetCounters", { className: cls.name }));
  if (!ok) return;
  resetMarksForSelectedClass();
});

savePhrasesBtn.addEventListener("click", () => {
  try {
    saveCustomPhrases();
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : t("config.phrases.error.generic"), 4000);
  }
});

resetPhrasesBtn.addEventListener("click", () => {
  resetCustomPhrases();
});

addCategoryBtn.addEventListener("click", () => {
  addPhraseCategory();
});

evalObservation.addEventListener("input", () => {
  const student = getSelectedStudent();
  if (!student) return;
  const evaluation = getEvaluationPeriodData(student);
  evaluation.observation = evalObservation.value;
  syncStudentEvaluationComment(student, true);
  evalComment.value = evaluation.comment;
  saveState(state);
});

evalObservation.addEventListener("blur", () => {
  renderStudents();
});

evalComment.addEventListener("input", () => {
  const student = getSelectedStudent();
  if (!student) return;
  const evaluation = getEvaluationPeriodData(student);
  evaluation.comment = evalComment.value;
  saveState(state);
});

evalComment.addEventListener("blur", () => {
  renderStudents();
});

copyCommentBtn.addEventListener("click", async () => {
  await copyCurrentComment(false);
});

copyNextBtn.addEventListener("click", async () => {
  await copyCurrentComment(true);
});

copyFromPreviousBtn.addEventListener("click", () => {
  const student = getSelectedStudent();
  if (!student) return;
  const copied = copyPreviousEvaluationToCurrent(student);
  persistEvaluationUi();
  setTransientStatus(t(copied ? "eval.status.copiedPrevious" : "eval.status.noPrevious"));
});

copyPeriodToPeriodBtn.addEventListener("click", () => {
  const cls = getSelectedClass();
  if (!cls.students.length) return;
  const sourcePeriod = getActiveEvaluationPeriodForSelectedClass();
  const targetPeriod = getBulkCopyTargetPeriodForSelectedClass();
  if (!targetPeriod || targetPeriod === sourcePeriod) return;

  const ok = confirm(t("eval.confirm.copyPeriodToPeriod", {
    source: t(`eval.period.${sourcePeriod}`),
    target: t(`eval.period.${targetPeriod}`),
    className: cls.name,
    count: cls.students.length,
  }));
  if (!ok) return;

  const result = copyEvaluationPeriodForWholeClass(sourcePeriod, targetPeriod);
  setTransientStatus(t("eval.status.copiedPeriodToPeriod", {
    source: t(`eval.period.${sourcePeriod}`),
    target: t(`eval.period.${targetPeriod}`),
    count: result.copied,
  }), 3500);
});

copyToAllBtn.addEventListener("click", () => {
  const sourceStudent = getSelectedStudent();
  if (!sourceStudent) return;
  const activePeriod = getActiveEvaluationPeriodForSelectedClass();
  const visibleStudents = getFilteredStudentsForSelectedClass();
  const targets = Math.max(0, visibleStudents.length - 1);
  if (targets <= 0) {
    setTransientStatus(t("eval.status.noTargets"), 3000);
    return;
  }

  const ok = confirm(t("eval.confirm.copyToAll", {
    period: t(`eval.period.${activePeriod}`),
    source: sourceStudent.name,
    count: targets,
  }));
  if (!ok) return;

  const result = copyCurrentEvaluationToAllVisible();
  setTransientStatus(t("eval.status.copiedToAll", { count: result.copied }), 3500);
});

saveEvaluationBtn.addEventListener("click", () => {
  const student = getSelectedStudent();
  if (student) syncAndPersistStudentEvaluation(student);
  else persistEvaluationUi();
  setTransientStatus(t("eval.status.saved"));
});

resetEvaluationBtn.addEventListener("click", () => {
  const student = getSelectedStudent();
  if (!student) return;
  resetEvaluationForStudent(student);
  persistEvaluationUi();
});

quickExportBtn.addEventListener("click", () => {
  try {
    exportBackup();
  } catch (e) {
    setTransientStatus(e instanceof Error ? e.message : t("error.export"), 4000);
  }
});

exportCsvBtn.addEventListener("click", () => {
  try {
    exportEvaluationsToCsv();
  } catch (error) {
    setTransientStatus(error instanceof Error ? error.message : t("error.export"), 4000);
  }
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
      setTransientStatus(t("status.pdf.reading"), 5000);
      const pdfText = await extractTextFromPdf(pdf);
      names = parseNamesFromPdfText(pdfText);
    } else {
      names = parseNames(text);
    }
    if (!names.length) {
      setTransientStatus(t("status.import.noNames"));
      return;
    }

    const cls = getSelectedClass();
    const result = applyImportToSelectedClass(names);
    setTransientStatus(
      t("status.import.done", { added: result.added, skipped: result.skipped, className: cls.name })
    );

    // Cierra el modal tras importar
    closeDialog(importDialog);
  } catch (e) {
    setTransientStatus(e instanceof Error ? e.message : t("error.import"), 4000);
  }
});

exportBackupBtn.addEventListener("click", () => {
  try {
    exportBackup();
  } catch (e) {
    setTransientStatus(e instanceof Error ? e.message : t("error.export"), 4000);
  }
});

importBackupBtn.addEventListener("click", async () => {
  try {
    await importBackupFromUi();
    // Cierra el modal tras importar
    closeDialog(importDialog);
  } catch (e) {
    setTransientStatus(e instanceof Error ? e.message : t("error.import"), 4000);
  }
});

document.addEventListener("keydown", async (event) => {
  const target = event.target;
  const tagName = target instanceof HTMLElement ? target.tagName : "";
  const isEditableField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  const isCommentField = target === evalObservation || target === evalComment;

  if (event.key === "F1") {
    event.preventDefault();
    if (evalHelpDialog.open || evalHelpDialog.hasAttribute("open")) closeEvalHelpDialog();
    else openEvalHelpDialog();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveState(state);
    setTransientStatus(t("eval.status.saved"));
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !isEditableField) {
    event.preventDefault();
    await copyCurrentComment(false);
    return;
  }

  if (!getSelectedStudent()) return;
  if (isCommentField) return;

  if (event.key === "ArrowDown" && !isEditableField) {
    event.preventDefault();
    moveSelection(1);
    return;
  }

  if (event.key === "ArrowUp" && !isEditableField) {
    event.preventDefault();
    moveSelection(-1);
    return;
  }

  if (event.key === "Enter" && !isEditableField) {
    event.preventDefault();
    await copyCurrentComment(true);
    return;
  }

  if (event.key === "Tab" && !isEditableField) {
    event.preventDefault();
    const categoryIds = getCommentCategoryOrder();
    const currentIndex = categoryIds.indexOf(getActiveCategoryForSelectedClass());
    const delta = event.shiftKey ? -1 : 1;
    const nextIndex = (currentIndex + delta + categoryIds.length) % categoryIds.length;
    setActiveCategoryForSelectedClass(categoryIds[nextIndex]);
    saveState(state);
    renderEvaluationPanel();
    focusActiveCategoryButton();
    return;
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[1-9]$/.test(event.key) && !isEditableField) {
    const categoryId = getActiveCategoryForSelectedClass();
    const category = getCommentCategories()[categoryId];
    const optionIndex = Number(event.key) - 1;
    const option = category?.options[optionIndex];
    const student = getSelectedStudent();
    if (!option || !student) return;
    event.preventDefault();
    const evaluation = getEvaluationPeriodData(student);
    evaluation.selections[categoryId] = evaluation.selections[categoryId] === option.id ? "" : option.id;
    syncStudentEvaluationComment(student, true);
    saveState(state);
    renderStudents();
  }

  void tagName;
});

// ------------------------------
// Inicializacion
// ------------------------------

// Init
renderClassSelect();
completionFilterSelect.value = getCompletionFilterForSelectedClass();
evaluationPeriodSelect.value = getActiveEvaluationPeriodForSelectedClass();
minCountInput.value = String(getMinCountForSelectedClass());
minPositiveInput.value = String(getMinPositiveForSelectedClass());
renderClassNameInput();
syncTimerControls();
negMinutesPerPointInput.value = String(getNegMinutesPerPoint());
posMinutesPerPointInput.value = String(getPosMinutesPerPoint());
commentLanguageModeSelect.value = getCommentLanguageMode();
applyI18n();

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

  let statusKey = "sound.status.initial";
  let statusVars = undefined;

  function setSoundStatus(key, vars) {
    statusKey = key;
    statusVars = vars;
    statusText.textContent = t(key, vars);
  }

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
    toggleConfigBtn.textContent = hide ? t("sound.toggle.show") : t("sound.toggle.hide");
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
      setSoundStatus("sound.status.enableFirst");
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
    setSoundStatus("sound.status.silenceCalibrated", { level: dbToLevel(lastDisplayedDb) });
    updatePresetButtons();
  }

  function calibrateTalk() {
    if (!ensureMicOrExplain()) return;
    const silence = Number(ui.silenceDb);
    if (!Number.isFinite(silence)) {
      setSoundStatus("sound.status.pressSilence");
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
    setSoundStatus("sound.status.calibrated", {
      green: greenMaxLevel,
      red: Math.round(Math.max(redMinLevel, greenMaxLevel + 3)),
    });
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
      setSoundStatus("sound.error.noMicSupport");
      return;
    }

    // Si ya está activo, no re-abrimos.
    if (analyser || stream || audioCtx) return;

    try {
      enableBtn.disabled = true;
      enableBtn.textContent = t("sound.status.activating");

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

      setSoundStatus("sound.status.active");
      enableBtn.textContent = t("sound.button.disable");
      enableBtn.disabled = false;
      setPanelState("green");

      applyGainUi();

      tick();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("sound.error.activate");
      setSoundStatus("sound.error.activateWithMsg", { msg });
      enableBtn.disabled = false;
      enableBtn.textContent = t("sound.button.enable");
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
    setSoundStatus("sound.status.disabled");
    enableBtn.textContent = t("sound.button.enable");
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
      if (next === "green") setSoundStatus("sound.level.green");
      if (next === "amber") setSoundStatus("sound.level.amber");
      if (next === "red") setSoundStatus("sound.level.red");
    }
  }

  function refreshSoundI18n() {
    applyHideConfigToPanel();
    enableBtn.textContent = analyser || stream || audioCtx ? t("sound.button.disable") : t("sound.button.enable");
    statusText.textContent = t(statusKey, statusVars);
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
  setSoundStatus("sound.status.initial");

  // Limpieza si la pestaña se oculta (evita consumo innecesario).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      if (analyser && !rafId) tick();
    }
  });

  document.addEventListener("i18n:change", refreshSoundI18n);
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
      label.textContent = t("mode.label.explain");
      hint.textContent = t("mode.hint.explain");
    } else if (next === "amber") {
      emoji.textContent = "🤝";
      label.textContent = t("mode.label.work");
      hint.textContent = t("mode.hint.work");
    } else {
      emoji.textContent = "🗣️";
      label.textContent = t("mode.label.debate");
      hint.textContent = t("mode.hint.debate");
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

  document.addEventListener("i18n:change", () => {
    applyMode(mode);
  });
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
  const evalBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("toggleEvalPanelBtn"));
  const rightBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("toggleRightColBtn"));
  if (!leftBtn || !midBtn || !evalBtn || !rightBtn) return;

  /** @type {{ left: boolean, mid: boolean, eval: boolean, mode: boolean }} */
  let vis = { left: true, mid: true, eval: true, mode: true };

  function load() {
    const raw = localStorage.getItem(COLVIS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.left === "boolean") vis.left = parsed.left;
      if (typeof parsed.mid === "boolean") vis.mid = parsed.mid;
      if (typeof parsed.eval === "boolean") vis.eval = parsed.eval;
      if (typeof parsed.mode === "boolean") vis.mode = parsed.mode;
      if (typeof parsed.right === "boolean" && typeof parsed.eval !== "boolean" && typeof parsed.mode !== "boolean") {
        vis.eval = parsed.right;
        vis.mode = parsed.right;
      }
    } catch {
      // ignore
    }
  }

  function save() {
    localStorage.setItem(COLVIS_KEY, JSON.stringify(vis));
  }

  function apply() {
    const rightVisible = vis.eval || vis.mode;
    split.classList.toggle("split--hide-left", !vis.left);
    split.classList.toggle("split--hide-mid", !vis.mid);
    split.classList.toggle("split--hide-right", !rightVisible);
    split.classList.toggle("split--hide-eval", !vis.eval);
    split.classList.toggle("split--hide-mode", !vis.mode);

    leftBtn.setAttribute("aria-pressed", String(vis.left));
    midBtn.setAttribute("aria-pressed", String(vis.mid));
    evalBtn.setAttribute("aria-pressed", String(vis.eval));
    rightBtn.setAttribute("aria-pressed", String(vis.mode));

    // Feedback visual reutilizando estilos existentes
    leftBtn.classList.toggle("btn--secondary", vis.left);
    midBtn.classList.toggle("btn--secondary", vis.mid);
    evalBtn.classList.toggle("btn--secondary", vis.eval);
    rightBtn.classList.toggle("btn--secondary", vis.mode);
  }

  function ensureAtLeastOneVisible() {
    if (vis.left || vis.mid || vis.eval || vis.mode) return true;
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
  evalBtn.addEventListener("click", () => {
    vis.eval = !vis.eval;
    ensureAtLeastOneVisible();
    apply();
    save();
  });
  rightBtn.addEventListener("click", () => {
    vis.mode = !vis.mode;
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
