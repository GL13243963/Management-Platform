const isText = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const isPdfName = value => isText(value, 120) && !/[\\/:]/.test(value) && /\.pdf$/i.test(value);

function materialNames(task) {
  return [...new Set(task.matches.flatMap(item => [item.invoice.fileName, item.itinerary.fileName]))];
}

function parseExpenseTask(value) {
  if (!isText(value?.reason, 50) || !isText(value.employeeName, 30) ||
      !Array.isArray(value.matches) || value.matches.length < 1 || value.matches.length > 10) return null;
  const seen = new Set();
  const matches = [];
  for (const item of value.matches) {
    const invoiceNumber = item?.invoice?.invoiceNumber;
    const total = item?.invoice?.total;
    if (typeof invoiceNumber !== 'string' || !/^\d{8,32}$/.test(invoiceNumber) ||
        seen.has(invoiceNumber) || !Number.isFinite(total) || total <= 0 ||
        !isPdfName(item.invoice.fileName) || !isPdfName(item.itinerary?.fileName) ||
        !isText(item.origin, 30) || !isText(item.destination, 30) ||
        !isDate(item.dateFrom) || !isDate(item.dateTo) || item.dateFrom > item.dateTo || !isText(item.remark, 60)) return null;
    seen.add(invoiceNumber);
    matches.push({
      invoice: { invoiceNumber, total, fileName: item.invoice.fileName },
      itinerary: { fileName: item.itinerary.fileName }, origin: item.origin, destination: item.destination,
      dateFrom: item.dateFrom, dateTo: item.dateTo, remark: item.remark,
    });
  }
  return { reason: value.reason, employeeName: value.employeeName, matches };
}

module.exports = { parseExpenseTask, materialNames };
