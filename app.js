/* 交互层：DOM渲染与事件。依赖 SurveyRules 与 SurveyStore。 */
const map = document.querySelector("#map");
const form = document.querySelector("#form");
const benchForm = document.querySelector("#benchForm");
const benchIssues = document.querySelector("#benchIssues");
const list = document.querySelector("#list");
const filter = document.querySelector("#filter");
const statusFilter = document.querySelector("#statusFilter");
const view = document.querySelector("#view");
const listTitle = document.querySelector("#listTitle");
const statsBar = document.querySelector("#stats");
const typeNames = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };
const statusClass = { "待校正": "st-correct", "待复核": "st-review", "已复核": "st-done" };
let pending = null;

for (let i = 0; i < 7; i++) {
  const rib = document.createElement("div");
  rib.className = "rib";
  rib.style.left = 28 + i * 7 + "%";
  map.appendChild(rib);
}

/* ---- 界面状态恢复：刷新后筛选、列表视图、当前潜次一致 ---- */
function restoreUI() {
  const ui = SurveyStore.getUI();
  filter.value = ui.filter || "";
  statusFilter.value = ui.status || "";
  view.value = ui.view || "list";
  benchForm.dive.value = ui.dive || "DIVE-01";
  fillBenchForm();
}

function fillBenchForm() {
  const b = SurveyStore.activeBenchmark(benchForm.dive.value.trim());
  benchForm.bearing.value = b ? b.bearing : "";
  benchForm.scale.value = b ? b.scale : "";
  benchForm.error.value = b ? b.error : "";
  renderBenchIssues();
}

function renderBenchIssues() {
  const b = SurveyStore.activeBenchmark(benchForm.dive.value.trim());
  const issues = SurveyRules.benchmarkIssues(b);
  benchIssues.innerHTML = issues.length
    ? issues.map(t => '<span class="pill bad">' + t + "</span>").join("")
    : '<span class="pill ok">基准有效，标记可复核/导出</span>';
}

function statusPill(m) {
  return '<span class="pill ' + statusClass[m.status] + '">' + m.status + "</span>";
}

function render() {
  const data = SurveyStore.visibleMarks(filter.value, statusFilter.value);
  map.querySelectorAll(".marker").forEach(el => el.remove());
  data.forEach(mark => {
    const el = document.createElement("button");
    el.className = "marker " + mark.type + (mark.id === form.id.value ? " selected" : "");
    el.style.left = mark.x + "%";
    el.style.top = mark.y + "%";
    el.textContent = mark.code.slice(0, 2);
    el.title = mark.code + " · " + mark.status;
    el.onclick = event => { event.stopPropagation(); edit(mark.id); };
    map.appendChild(el);
  });
  if (view.value === "timeline") renderTimeline();
  else renderList(data);
  renderStats();
}

function coordText(m) {
  return m.corrected ? "实测(" + m.corrected.cx + "m, " + m.corrected.cy + "m)" : "未换算";
}

function renderList(data) {
  listTitle.textContent = "标记列表";
  list.className = "list";
  list.innerHTML = data.map(m =>
    '<div class="item ' + (m.id === form.id.value ? "active" : "") + '" data-id="' + m.id + '">' +
    "<b>" + m.code + "</b> " + '<span class="pill">' + typeNames[m.type] + "</span> " + statusPill(m) +
    '<div class="muted">' + m.dive + " · " + m.depth + " · " + coordText(m) +
    ((m.archive && m.archive.length) ? " · 留档" + m.archive.length + "组(不计入统计)" : "") + "</div>" +
    "<div>" + (m.condition || "") + "</div>" +
    (m.status === SurveyRules.STATUS.PENDING_REVIEW ? '<button class="mini" data-review="' + m.id + '">复核通过</button>' : "") +
    "</div>").join("");
  list.querySelectorAll("[data-id]").forEach(el => el.onclick = () => edit(el.dataset.id));
  list.querySelectorAll("[data-review]").forEach(el => el.onclick = event => {
    event.stopPropagation();
    SurveyStore.setReviewed(el.dataset.review, true);
    render();
  });
}

function renderTimeline() {
  listTitle.textContent = "潜次时间线";
  list.className = "timeline";
  const groups = SurveyStore.timeline(filter.value, statusFilter.value);
  const excluded = SurveyStore.visibleMarks(filter.value, statusFilter.value)
    .filter(m => !SurveyRules.canEnterTimeline(m, SurveyStore.activeBenchmark(m.dive))).length;
  const entries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  list.innerHTML = entries.map(([dive, items]) =>
    '<div class="item"><b>' + dive + '</b><div class="muted">有效标记' + items.length + "个</div>" +
    items.map(i => "<div>" + i.code + " · " + typeNames[i.type] + " · " + i.status + "</div>").join("") + "</div>").join("") +
    (excluded ? '<div class="muted">另有' + excluded + "个待校正标记被排除，需先校正基准</div>" : "");
  if (!entries.length && !excluded) list.innerHTML = '<div class="muted">暂无标记</div>';
}

function renderStats() {
  const c = SurveyStore.stats();
  statsBar.textContent = "共" + c.total + "个标记 · 待校正" + c[SurveyRules.STATUS.PENDING_CORRECT] +
    " · 待复核" + c[SurveyRules.STATUS.PENDING_REVIEW] + " · 已复核" + c[SurveyRules.STATUS.REVIEWED] +
    " · 可导出" + c.exportable + " · 留档" + c.archived + "组(不计入统计)";
}

function edit(id) {
  const mark = SurveyStore.listMarks().find(m => m.id === id);
  if (!mark) return;
  for (const key of ["id", "code", "type", "dive", "depth", "orientation", "condition", "note"])
    if (form[key]) form[key].value = mark[key] ?? "";
  pending = { x: mark.x, y: mark.y };
  render();
}

/* ---- 事件 ---- */
map.addEventListener("click", event => {
  const rect = map.getBoundingClientRect();
  pending = {
    x: Number(((event.clientX - rect.left) / rect.width * 100).toFixed(2)),
    y: Number(((event.clientY - rect.top) / rect.height * 100).toFixed(2))
  };
  form.reset();
  form.id.value = "";
  form.code.value = "M-" + String(SurveyStore.stats().total + 1).padStart(3, "0");
  form.dive.value = benchForm.dive.value.trim() || "DIVE-01";
  render();
});

form.onsubmit = event => {
  event.preventDefault();
  if (!pending) pending = { x: 50, y: 50 };
  const data = Object.fromEntries(new FormData(form).entries());
  SurveyStore.saveMark(data, pending);
  render();
};

document.querySelector("#deleteBtn").onclick = () => {
  if (!form.id.value) return;
  SurveyStore.removeMark(form.id.value);
  form.reset();
  pending = null;
  render();
};

benchForm.onsubmit = event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(benchForm).entries());
  SurveyStore.upsertBenchmark(data); // 同潜次覆盖旧基准，关联标记自动重算并回到待复核
  SurveyStore.setUI({ dive: data.dive.trim() });
  renderBenchIssues();
  render();
};

benchForm.dive.addEventListener("change", () => {
  SurveyStore.setUI({ dive: benchForm.dive.value.trim() });
  fillBenchForm();
});

document.querySelector("#exportBtn").onclick = () => {
  const data = SurveyStore.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "survey-export.json";
  a.click();
  URL.revokeObjectURL(a.href);
};

filter.onchange = () => { SurveyStore.setUI({ filter: filter.value }); render(); };
statusFilter.onchange = () => { SurveyStore.setUI({ status: statusFilter.value }); render(); };
view.onchange = () => { SurveyStore.setUI({ view: view.value }); render(); };

restoreUI();
render();
