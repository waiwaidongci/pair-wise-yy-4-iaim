/* 业务规则层：基准校验、标记状态判定、坐标重算与统计。
   纯函数，不接触 DOM 与存储。 */
window.SurveyRules = (() => {
  "use strict";

  const ERROR_LIMIT = 5;      // 误差上限（%）：超过该值标记只能待校正
  const STANDARD_SCALE = 100; // 标准图幅比例尺（1:100），重算时以此为参照

  const STATUS = {
    PENDING_CORRECTION: "pending_correction", // 待校正
    PENDING_REVIEW: "pending_review",         // 待复核
    REVIEWED: "reviewed",                     // 已复核
  };

  const STATUS_NAMES = {
    [STATUS.PENDING_CORRECTION]: "待校正",
    [STATUS.PENDING_REVIEW]: "待复核",
    [STATUS.REVIEWED]: "已复核",
  };

  const round2 = n => Math.round(n * 100) / 100;
  const clampPct = n => Math.min(100, Math.max(0, n));

  // 比例尺是否已登记（缺失时标记只能待校正）
  function hasScale(baseline) {
    if (!baseline || baseline.scale === "" || baseline.scale == null) return false;
    const scale = Number(baseline.scale);
    return Number.isFinite(scale) && scale > 0;
  }

  // 基准存在的问题；空数组表示基准可用于校正
  function baselineProblems(baseline) {
    if (!baseline) return ["未登记生效基准"];
    const problems = [];
    if (!hasScale(baseline)) problems.push("比例尺缺失");
    if (!(Number(baseline.error) <= ERROR_LIMIT)) problems.push("误差超过 " + ERROR_LIMIT + "%");
    return problems;
  }

  function baselineUsable(baseline) {
    return baselineProblems(baseline).length === 0;
  }

  // 按基准重算坐标：以图幅中心为原点，先按方位角旋转，再按 100÷比例尺分母 缩放
  function applyBaseline(point, baseline) {
    const angle = (Number(baseline.azimuth) || 0) * Math.PI / 180;
    const factor = STANDARD_SCALE / Number(baseline.scale);
    const dx = point.x - 50;
    const dy = point.y - 50;
    return {
      x: clampPct(round2(50 + (dx * Math.cos(angle) - dy * Math.sin(angle)) * factor)),
      y: clampPct(round2(50 + (dx * Math.sin(angle) + dy * Math.cos(angle)) * factor)),
    };
  }

  // 重算单个标记：旧坐标留档（不计入统计），按生效基准得出新坐标并回到待复核；
  // 基准不可用（误差超限或比例尺缺失）时回退实测坐标，只能待校正。
  function recalcMark(mark, baseline, reason) {
    const measured = mark.measured || { x: mark.x, y: mark.y };
    const next = { ...mark, measured };
    if (mark.x != null && mark.y != null) {
      next.archive = (mark.archive || []).concat({
        x: mark.x,
        y: mark.y,
        baselineId: mark.baselineId || null,
        reason,
        archivedAt: new Date().toISOString(),
      });
    }
    if (baselineUsable(baseline)) {
      const corrected = applyBaseline(measured, baseline);
      next.x = corrected.x;
      next.y = corrected.y;
      next.baselineId = baseline.id;
      next.status = STATUS.PENDING_REVIEW;
    } else {
      next.x = measured.x;
      next.y = measured.y;
      next.baselineId = baseline ? baseline.id : null;
      next.status = STATUS.PENDING_CORRECTION;
    }
    return next;
  }

  // 刷新后同步状态：基准失效一律待校正；基准有效时仅保留“基准未变且已复核”的标记
  function syncStatus(mark, baseline) {
    if (!baselineUsable(baseline)) return STATUS.PENDING_CORRECTION;
    if (mark.status === STATUS.REVIEWED && mark.baselineId === baseline.id) return STATUS.REVIEWED;
    return STATUS.PENDING_REVIEW;
  }

  // 是否可进入时间线与导出（待校正一律排除）
  function canPublish(mark) {
    return mark.status !== STATUS.PENDING_CORRECTION;
  }

  // 统计：只按标记当前坐标与状态计数，留档旧坐标不计入
  function stats(marks) {
    const byStatus = {
      [STATUS.PENDING_CORRECTION]: 0,
      [STATUS.PENDING_REVIEW]: 0,
      [STATUS.REVIEWED]: 0,
    };
    for (const mark of marks) byStatus[mark.status] = (byStatus[mark.status] || 0) + 1;
    return { total: marks.length, byStatus, publishable: marks.filter(canPublish).length };
  }

  return {
    ERROR_LIMIT,
    STATUS,
    STATUS_NAMES,
    hasScale,
    baselineProblems,
    baselineUsable,
    applyBaseline,
    recalcMark,
    syncStatus,
    canPublish,
    stats,
  };
})();
