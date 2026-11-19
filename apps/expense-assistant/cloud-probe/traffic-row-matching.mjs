export const cents = value => String(value ?? '').trim() ? Math.round(Number(String(value).replace(/,/g, '')) * 100) : NaN;

export function matchTrafficRows(rows, matches) {
  if (rows.length !== matches.length) throw new Error('交通费用行数与票据数不同。');
  const choices = rows.map(row => {
    const sameAmount = matches.filter(match => cents(match.invoice.total) === cents(row.amount));
    const byNumber = sameAmount.filter(match => row.numbers.includes(match.invoice.invoiceNumber));
    return byNumber.length ? byNumber : sameAmount;
  });
  const ordered = choices.map(items => items.length === 1 ? items[0] : null);
  if (ordered.includes(null) || new Set(ordered).size !== matches.length) {
    throw new Error('无法唯一匹配交通费用行与发票。');
  }
  return ordered;
}
