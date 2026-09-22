/* 记录存取层：标记、测绘基准与界面状态的本地持久化。 */
window.SurveyStore = (() => {
  "use strict";

  const Rules = window.SurveyRules;
  const KEYS = { marks: "uwSurvey.marks", baselines: "uwSurvey.baselines", ui: "uwSurvey.ui" };

  function read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function persist() {
    localStorage.setItem(KEYS.marks, JSON.stringify(marks));
    localStorage.setItem(KEYS.baselines, JSON.stringify(baselines));
  }

  // 首次使用时的演示数据：DIVE-01 基准可用，DIVE-02 误差超限，DIVE-03 未登记基准
  function seed() {
    const baselines = [
      { id: crypto.randomUUID(), dive: "DIVE-01", azimuth: 12, scale: 50, error: 2.4, active: true, updatedAt: new Date().toISOString() },
      { id: crypto.randomUUID(), dive: "DIVE-02", azimuth: 347, scale: 80, error: 6.8, active: true, updatedAt: new Date().toISOString() },
    ];
    const mk = (code, type, dive, x, y, extra) => ({
      id: crypto.randomUUID(), code, type, dive,
      measured: { x, y }, archive: [], baselineId: null,
      status: Rules.STATUS.PENDING_REVIEW,
      depth: "", orientation: "", condition: "", note: "",
      ...extra,
    });
    let marks = [
      mk("A-017", "ceramic", "DIVE-01", 42, 46, { depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋" }),
      mk("W-003", "wood", "DIVE-01", 58, 39, { depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁" }),
      mk("X-011", "metal", "DIVE-02", 35, 60, { depth: "19.1m", orientation: "南", condition: "锈蚀", note: "误差超限，待校正" }),
      mk("U-002", "unknown", "DIVE-03", 66, 55, { depth: "18.6m", orientation: "东北", condition: "待鉴定", note: "该潜次未登记基准" }),
    ];
    marks = marks.map(m => Rules.recalcMark(m, baselines.find(b => b.active && b.dive === m.dive) || null, "初始登记"));
    // A-017 作为已复核样例
    marks[0] = { ...marks[0], status: Rules.STATUS.REVIEWED };
    return { marks, baselines };
  }

  let marks = read(KEYS.marks);
  let baselines = read(KEYS.baselines);
  if (!Array.isArray(marks) || !Array.isArray(baselines)) {
    ({ marks, baselines } = seed());
    persist();
  }

  return {
    listMarks: () => marks.map(m => ({ ...m })),
    getMark(id) {
      const mark = marks.find(m => m.id === id);
      return mark ? { ...mark } : null;
    },
    addMark(mark) { marks = marks.concat(mark); persist(); return mark; },
    replaceMarks(next) { marks = next; persist(); },
    removeMark(id) { marks = marks.filter(m => m.id !== id); persist(); },

    listBaselines: () => baselines.map(b => ({ ...b })),
    activeBaseline(dive) {
      const baseline = baselines.find(b => b.active && b.dive === dive);
      return baseline ? { ...baseline } : null;
    },
    // 登记或更新基准：同一潜次只保留一个生效基准，旧基准转为历史留档
    upsertBaseline(data) {
      const baseline = { ...data, id: crypto.randomUUID(), active: true, updatedAt: new Date().toISOString() };
      baselines = baselines.map(b => (b.dive === baseline.dive ? { ...b, active: false } : b)).concat(baseline);
      persist();
      return { ...baseline };
    },

    loadUi: () => read(KEYS.ui) || {},
    saveUi(ui) { localStorage.setItem(KEYS.ui, JSON.stringify(ui)); },
  };
})();
