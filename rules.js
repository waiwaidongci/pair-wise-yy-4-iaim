/* 规则层：基准校验、标记状态判定、坐标重算。纯函数，不碰存储和DOM。 */
const SurveyRules = (() => {
  const ERROR_LIMIT = 5; // 误差上限（百分比），超过即不可生效
  const STATUS = { PENDING_CORRECT: "待校正", PENDING_REVIEW: "待复核", REVIEWED: "已复核" };

  function isBlank(v) { return v === null || v === undefined || v === "" || Number.isNaN(Number(v)); }

  /* 基准必须登记方位、比例尺、误差；误差超5%或比例尺缺失即不可用 */
  function benchmarkIssues(b) {
    if (!b) return ["未登记基准"];
    const issues = [];
    if (isBlank(b.bearing)) issues.push("方位缺失");
    if (isBlank(b.scale) || Number(b.scale) <= 0) issues.push("比例尺缺失");
    if (isBlank(b.error) || Number(b.error) < 0) issues.push("误差缺失");
    else if (Number(b.error) > ERROR_LIMIT) issues.push("误差超过" + ERROR_LIMIT + "%");
    return issues;
  }

  function isBenchmarkUsable(b) { return benchmarkIssues(b).length === 0; }

  /* 以图幅中心为原点，按方位角旋转、比例尺换算为实地坐标（米）；基准不可用返回null */
  function recalcPoint(x, y, b) {
    if (!isBenchmarkUsable(b)) return null;
    const rad = Number(b.bearing) * Math.PI / 180;
    const dx = Number(x) - 50, dy = Number(y) - 50;
    const s = Number(b.scale);
    return {
      cx: +((dx * Math.cos(rad) - dy * Math.sin(rad)) * s).toFixed(3),
      cy: +((dx * Math.sin(rad) + dy * Math.cos(rad)) * s).toFixed(3)
    };
  }

  /* 状态机：基准不可用只能待校正；可用时按复核标记分待复核/已复核 */
  function statusFor(mark, benchmark) {
    if (!isBenchmarkUsable(benchmark)) return STATUS.PENDING_CORRECT;
    return mark.reviewed ? STATUS.REVIEWED : STATUS.PENDING_REVIEW;
  }

  /* 待校正不得进入时间线和导出 */
  function canEnterTimeline(mark, benchmark) { return statusFor(mark, benchmark) !== STATUS.PENDING_CORRECT; }
  function canExport(mark, benchmark) { return canEnterTimeline(mark, benchmark); }

  return { ERROR_LIMIT, STATUS, benchmarkIssues, isBenchmarkUsable, recalcPoint, statusFor, canEnterTimeline, canExport };
})();
