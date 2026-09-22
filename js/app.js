/* 页面交互层：渲染与事件。业务判定委托 SurveyRules，数据读写委托 SurveyStore。 */
(() => {
  "use strict";

  const Rules = window.SurveyRules;
  const Store = window.SurveyStore;
  const STATUS = Rules.STATUS;
  const STATUS_NAMES = Rules.STATUS_NAMES;

  const $ = selector => document.querySelector(selector);
  const map = $("#map");
  const form = $("#form");
  const fields = form.elements;
  const baselineForm = $("#baselineForm");
  const baselineFields = baselineForm.elements;
  const list = $("#list");
  const filter = $("#filter");
  const statusFilter = $("#statusFilter");
  const view = $("#view");
  const listTitle = $("#listTitle");
  const statsBox = $("#stats");
  const baselineInfo = $("#baselineInfo");
  const markStatus = $("#markStatus");
  const reviewBtn = $("#reviewBtn");

  const typeNames = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };
  let pending = null; // 新标记的图上实测坐标

  // 船肋装饰
  for (let i = 0; i < 7; i++) {
    const rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    map.appendChild(rib);
  }

  // 恢复上次的筛选与视图，刷新后状态一致
  const ui = { filter: "", statusFilter: "", view: "list", ...Store.loadUi() };
  filter.value = ui.filter;
  statusFilter.value = ui.statusFilter;
  view.value = ui.view;

  // 启动时按当前生效基准同步全部标记状态，保证刷新后一致
  Store.replaceMarks(Store.listMarks().map(m => ({ ...m, status: Rules.syncStatus(m, Store.activeBaseline(m.dive)) })));

  function persistUi() {
    Store.saveUi({ filter: filter.value, statusFilter: statusFilter.value, view: view.value });
  }

  function currentMarks() {
    let data = Store.listMarks();
    if (filter.value) data = data.filter(m => m.type === filter.value);
    if (statusFilter.value) data = data.filter(m => m.status === statusFilter.value);
    return data;
  }

  function render() {
    renderStats();
    renderBaselineInfo();
    renderMap();
    renderMarkStatus();
    if (view.value === "timeline") renderTimeline();
    else renderList();
    persistUi();
  }

  function renderStats() {
    const s = Rules.stats(Store.listMarks());
    statsBox.innerHTML =
      '<span class="pill">共 ' + s.total + "</span>" +
      '<span class="pill st-pending_correction">待校正 ' + s.byStatus[STATUS.PENDING_CORRECTION] + "</span>" +
      '<span class="pill st-pending_review">待复核 ' + s.byStatus[STATUS.PENDING_REVIEW] + "</span>" +
      '<span class="pill st-reviewed">已复核 ' + s.byStatus[STATUS.REVIEWED] + "</span>" +
      '<span class="pill">可导出 ' + s.publishable + "</span>";
  }

  function renderBaselineInfo() {
    const dive = baselineFields.dive.value.trim();
    if (!dive) {
      baselineInfo.innerHTML = '<div class="muted">输入潜次以查看生效基准。</div>';
      return;
    }
    const active = Store.activeBaseline(dive);
    const history = Store.listBaselines().filter(b => b.dive === dive && !b.active).length;
    const historyLine = history ? '<div class="muted">历史基准 ' + history + " 条（已留档）</div>" : "";
    if (!active) {
      baselineInfo.innerHTML = '<div class="problems">' + dive + " 未登记生效基准，标记只能待校正。</div>" + historyLine;
      return;
    }
    const problems = Rules.baselineProblems(active);
    const desc = "方位 " + active.azimuth + "° · 比例尺 " + (Rules.hasScale(active) ? "1:" + active.scale : "缺失") + " · 误差 " + active.error + "%";
    baselineInfo.innerHTML =
      '<div><span class="pill">生效基准</span> ' + desc + "</div>" +
      (problems.length
        ? '<div class="problems">' + problems.join("；") + "，该潜次标记只能待校正。</div>"
        : '<div class="ok">基准可用于校正。</div>') +
      historyLine;
  }

  function renderMap() {
    map.querySelectorAll(".marker").forEach(el => el.remove());
    currentMarks().forEach(mark => {
      const el = document.createElement("button");
      el.className = "marker " + mark.type + " st-" + mark.status + (mark.id === fields.id.value ? " selected" : "");
      el.style.left = mark.x + "%";
      el.style.top = mark.y + "%";
      el.textContent = mark.code.slice(0, 2);
      el.title = mark.code + " · " + STATUS_NAMES[mark.status];
      el.onclick = event => { event.stopPropagation(); edit(mark.id); };
      map.appendChild(el);
    });
  }

  function renderList() {
    listTitle.textContent = "标记列表";
    list.className = "list";
    const data = currentMarks();
    list.innerHTML = data.map(m =>
      '<div class="item' + (m.id === fields.id.value ? " active" : "") + '" data-id="' + m.id + '">' +
      "<b>" + m.code + '</b> <span class="pill">' + typeNames[m.type] + '</span> <span class="pill st-' + m.status + '">' + STATUS_NAMES[m.status] + "</span>" +
      '<div class="muted">' + m.dive + " · " + m.depth + " · " + m.orientation + "</div>" +
      "<div>" + m.condition + "</div>" +
      ((m.archive || []).length ? '<div class="muted">旧坐标留档 ' + m.archive.length + " 条（不计入统计）</div>" : "") +
      "</div>"
    ).join("") || '<div class="muted">无匹配标记。</div>';
    list.querySelectorAll("[data-id]").forEach(el => el.onclick = () => edit(el.dataset.id));
  }

  function renderTimeline() {
    listTitle.textContent = "潜次时间线";
    list.className = "timeline";
    const data = currentMarks();
    const eligible = data.filter(Rules.canPublish);
    const blocked = data.length - eligible.length;
    const groups = eligible.reduce((acc, item) => ((acc[item.dive] ||= []).push(item), acc), {});
    const dives = Object.keys(groups).sort();
    list.innerHTML =
      (blocked ? '<div class="muted">' + blocked + " 个待校正标记未进入时间线。</div>" : "") +
      (dives.map(dive =>
        '<div class="item"><b>' + dive + '</b><div class="muted">新增 ' + groups[dive].length + " 个标记</div>" +
        groups[dive].map(i =>
          "<div>" + i.code + " · " + typeNames[i.type] + ' · <span class="pill st-' + i.status + '">' + STATUS_NAMES[i.status] + "</span></div>"
        ).join("") +
        "</div>"
      ).join("") || '<div class="muted">暂无可进入时间线的标记。</div>');
  }

  function renderMarkStatus() {
    const id = fields.id.value;
    const mark = id && Store.getMark(id);
    if (!mark) {
      markStatus.textContent = "";
      reviewBtn.disabled = true;
      return;
    }
    const archived = (mark.archive || []).length;
    markStatus.innerHTML =
      '当前状态：<span class="pill st-' + mark.status + '">' + STATUS_NAMES[mark.status] + "</span>" +
      (archived ? ' <span class="muted">旧坐标留档 ' + archived + " 条</span>" : "");
    reviewBtn.disabled = mark.status !== STATUS.PENDING_REVIEW;
  }

  function edit(id) {
    const mark = Store.getMark(id);
    if (!mark) return;
    ["id", "code", "type", "dive", "depth", "orientation", "condition", "note"].forEach(key => {
      fields[key].value = mark[key] == null ? "" : mark[key];
    });
    baselineFields.dive.value = mark.dive;
    pending = null;
    render();
  }

  map.addEventListener("click", event => {
    const rect = map.getBoundingClientRect();
    pending = {
      x: Number(((event.clientX - rect.left) / rect.width * 100).toFixed(2)),
      y: Number(((event.clientY - rect.top) / rect.height * 100).toFixed(2)),
    };
    form.reset();
    fields.id.value = "";
    fields.code.value = "M-" + String(Store.listMarks().length + 1).padStart(3, "0");
    fields.dive.value = baselineFields.dive.value.trim() || "DIVE-01";
    render();
  });

  form.onsubmit = event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.dive = (data.dive || "").trim();
    if (data.id) {
      const old = Store.getMark(data.id);
      if (!old) return;
      let next = { ...old, ...data };
      if (data.dive !== old.dive) {
        // 更换潜次：按新潜次的生效基准重算，旧坐标留档，回到待复核/待校正
        next = Rules.recalcMark(next, Store.activeBaseline(data.dive), "更换潜次");
      }
      Store.replaceMarks(Store.listMarks().map(m => (m.id === next.id ? next : m)));
    } else {
      const measured = pending || { x: 50, y: 50 };
      let mark = {
        ...data,
        id: crypto.randomUUID(),
        measured,
        archive: [],
        baselineId: null,
        status: STATUS.PENDING_REVIEW,
      };
      mark = Rules.recalcMark(mark, Store.activeBaseline(mark.dive), "初始登记");
      Store.addMark(mark);
      fields.id.value = mark.id;
    }
    pending = null;
    render();
  };

  baselineFields.dive.addEventListener("input", renderBaselineInfo);

  baselineForm.onsubmit = event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(baselineForm).entries());
    const dive = (data.dive || "").trim();
    if (!dive) return;
    const baseline = Store.upsertBaseline({
      dive,
      azimuth: ((Number(data.azimuth) % 360) + 360) % 360,
      scale: data.scale === "" ? "" : Number(data.scale),
      error: Number(data.error),
    });
    // 修改基准后：该潜次关联标记按新基准重算，旧坐标留档，回到待复核/待校正
    Store.replaceMarks(Store.listMarks().map(m => (m.dive === dive ? Rules.recalcMark(m, baseline, "基准变更") : m)));
    render();
  };

  reviewBtn.onclick = () => {
    const id = fields.id.value;
    const mark = id && Store.getMark(id);
    if (!mark) return;
    const baseline = Store.activeBaseline(mark.dive);
    if (!Rules.baselineUsable(baseline)) return; // 待校正不能复核
    Store.replaceMarks(Store.listMarks().map(m => (m.id === id ? { ...m, status: STATUS.REVIEWED, baselineId: baseline.id } : m)));
    render();
  };

  $("#deleteBtn").onclick = () => {
    if (!fields.id.value) return;
    Store.removeMark(fields.id.value);
    form.reset();
    fields.id.value = "";
    pending = null;
    render();
  };

  $("#exportBtn").onclick = () => {
    const all = Store.listMarks();
    const eligible = all.filter(Rules.canPublish);
    const blocked = all.length - eligible.length;
    const payload = { exportedAt: new Date().toISOString(), excludedPendingCorrection: blocked, marks: eligible };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dive-marks.json";
    a.click();
    URL.revokeObjectURL(a.href);
    if (blocked) alert("已排除 " + blocked + " 个待校正标记（误差超限或比例尺缺失）。");
  };

  filter.onchange = render;
  statusFilter.onchange = render;
  view.onchange = render;
  render();
})();
