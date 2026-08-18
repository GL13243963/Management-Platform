/** Format a number as work hours with exactly 2 decimal places. */
export function fmtHours(v) {
  return (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
}

/** Format a number as currency (yuan) with thousands separators. */
export function fmtMoney(v) {
  return (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
