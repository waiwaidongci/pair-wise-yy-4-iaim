/* 存取层：基准与标记的读写、留档、重算编排、界面状态持久化。依赖 SurveyRules。 */
const SurveyStore = (() => {
  const KEY = "uwSurvey.v1";
  let state = load() || seed();

  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  function seed() {
    const s = {
      benchmarks: {
        "DIVE-01": { id: crypto.randomUUID(), dive: "DIVE-01", bearing: 32, scale: 0.4, error: 3.1, updatedAt: new Date().toISOString() },
        "DIVE-02": { id: crypto.randomUUID(), dive: "DIVE-02", bearing: 275, scale: "", error: 6.4, updatedAt: new Date().toISOString() }
      },
      marks: [
        { id: crypto.randomUUID(), code: "A-017", type: "ceramic", dive: "DIVE-01", x: 42, y: 46, depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋", reviewed: false, corrected: null, archive: [] },
        { id: crypto.randomUUID(), code: "W-003", type: "wood", dive: "DIVE-02", x: 58, y: 39, depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁", reviewed: false, corrected: null, archive: [] }
      ],
      ui: { filter: "", status: "", view: "list", dive: "DIVE-01" }
    };
    s.marks.forEach(m => { m.corrected = SurveyRules.recalcPoint(m.x, m.y, s.benchmarks[m.dive]); });
    localStorage.setItem(KEY, JSON.stringify(s));
    return s;
  }

  /* ---- 基准：每个潜次只能有一个生效基准 ---- */
  function activeBenchmark(dive) { return state.benchmarks[dive] || null; }
  function allBenchmarks() { return Object.values(state.benchmarks); }

  function upsertBenchmark(input) {
    const dive = String(input.dive || "").trim();
    if (!dive) throw new Error("潜次不能为空");
    const prev = state.benchmarks[dive];
    const bench = {
      id: prev ? prev.id : crypto.randomUUID(),
      dive,
      bearing: input.bearing === "" ? "" : Number(input.bearing),
      scale: input.scale === "" ? "" : Number(input.scale),
      error: input.error === "" ? "" : Number(input.error),
      updatedAt: new Date().toISOString()
    };
    state.benchmarks[dive] = bench; // 同潜次覆盖，保证唯一生效
    recomputeDive(dive);            // 基准变更 → 关联标记重算并回到待复核
    save();
    return bench;
  }

  /* 关联标记按新基准重算：旧坐标留档，状态回到待复核（基准不可用则规则层判为待校正） */
  function recomputeDive(dive) {
    const bench = activeBenchmark(dive);
    state.marks.filter(m => m.dive === dive).forEach(m => {
      archiveCurrent(m);
      m.corrected = SurveyRules.recalcPoint(m.x, m.y, bench);
      m.reviewed = false;
    });
  }

  /* 旧坐标留档：只存历史，不计入统计 */
  function archiveCurrent(m) {
    m.archive = m.archive || [];
    m.archive.push({ x: m.x, y: m.y, corrected: m.corrected || null, at: new Date().toISOString() });
  }

  /* ---- 标记 ---- */
  function saveMark(data, pos) {
    if (data.id) {
      const m = state.marks.find(x => x.id === data.id);
      if (!m) return null;
      const diveChanged = m.dive !== data.dive;
      if (diveChanged) archiveCurrent(m); // 更换潜次：旧坐标留档
      Object.assign(m, data, pos);
      if (diveChanged) m.reviewed = false; // 回到待复核
      m.corrected = SurveyRules.recalcPoint(m.x, m.y, activeBenchmark(m.dive));
      save();
      return m;
    }
    const m = { ...data, id: crypto.randomUUID(), ...pos, reviewed: false, corrected: null, archive: [] };
    m.corrected = SurveyRules.recalcPoint(m.x, m.y, activeBenchmark(m.dive));
    state.marks.push(m);
    save();
    return m;
  }

  function removeMark(id) {
    state.marks = state.marks.filter(m => m.id !== id);
    save();
  }

  function setReviewed(id, reviewed) {
    const m = state.marks.find(x => x.id === id);
    if (!m) return;
    if (SurveyRules.statusFor(m, activeBenchmark(m.dive)) === SurveyRules.STATUS.PENDING_CORRECT) return; // 待校正不可复核
    m.reviewed = reviewed;
    save();
  }

  function withStatus(m) { return { ...m, status: SurveyRules.statusFor(m, activeBenchmark(m.dive)) }; }
  function listMarks() { return state.marks.map(withStatus); }

  function visibleMarks(filterType, filterStatus) {
    return listMarks().filter(m =>
      (!filterType || m.type === filterType) &&
      (!filterStatus || m.status === filterStatus));
  }

  /* 时间线：只收可进入时间线的标记，按潜次分组 */
  function timeline(filterType, filterStatus) {
    const eligible = visibleMarks(filterType, filterStatus)
      .filter(m => SurveyRules.canEnterTimeline(m, activeBenchmark(m.dive)));
    return eligible.reduce((g, m) => ((g[m.dive] ||= []).push(m), g), {});
  }

  /* 导出：排除待校正 */
  function exportData() {
    const marks = listMarks()
      .filter(m => SurveyRules.canExport(m, activeBenchmark(m.dive)))
      .map(m => ({ ...m, archive: (state.marks.find(x => x.id === m.id) || {}).archive || [] }));
    return { exportedAt: new Date().toISOString(), benchmarks: allBenchmarks(), marks };
  }

  /* 统计：只计当前坐标，留档不计入 */
  function stats() {
    const all = listMarks();
    const c = { total: all.length, [SurveyRules.STATUS.PENDING_CORRECT]: 0, [SurveyRules.STATUS.PENDING_REVIEW]: 0, [SurveyRules.STATUS.REVIEWED]: 0, exportable: 0, archived: 0 };
    all.forEach(m => {
      c[m.status]++;
      if (SurveyRules.canExport(m, activeBenchmark(m.dive))) c.exportable++;
    });
    state.marks.forEach(m => { c.archived += (m.archive || []).length; });
    return c;
  }

  /* ---- 界面状态：筛选、视图、当前潜次持久化，刷新后一致 ---- */
  function getUI() { return state.ui; }
  function setUI(patch) { Object.assign(state.ui, patch); save(); }

  return { activeBenchmark, allBenchmarks, upsertBenchmark, saveMark, removeMark, setReviewed, listMarks, visibleMarks, timeline, exportData, stats, getUI, setUI };
})();
