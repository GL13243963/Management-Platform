import { AsyncLocalStorage } from 'node:async_hooks';
import { openScopedReimbursementHelp } from './reimbursement-picker.mjs';
import { waitForAttachmentInput } from './attachment-readiness.mjs';
import { cents, matchTrafficRows } from './traffic-row-matching.mjs';
import {
  inspectTrafficInvoicePool, openTrafficTicketPool, selectTrafficInvoices, fillTrafficRows, getTrafficRows,
  prepareBaseInformation, removeDefaultExpenseRow, verifyFormPrepared,
  openInvoiceImaging, uploadInvoiceImages, submitInvoiceImaging, returnToReimbursementForm,
  openAttachments, uploadItineraryAttachments, closeAttachments,
  inspectPaymentAccount, openPaymentAccountPicker, selectPaymentAccount, verifyInvoiceImaging, saveDraft,
} from 'expense-original';

const session = new AsyncLocalStorage();

async function atStage(stage, run) {
  session.getStore()?.onProgress?.(stage);
  try { return await run(); }
  catch (cause) {
    const error = new Error(stage, { cause });
    error.stage = stage;
    error.code = cause.code;
    error.portalDetail = cause.portalDetail;
    throw error;
  }
}

function imagingFailure(message, detail) {
  const error = new Error(message);
  if (typeof detail === 'string') {
    error.portalDetail = detail.replace(/\s+/g, ' ').replace(/\d{6,}/g, '[号码已遮盖]').trim().slice(0, 320);
  }
  return error;
}

function baseFieldDetail(error) {
  const message = String(error.message || '');
  if (/DataSetFieldComboBox6-input|勘察设计成本|帮助字典/.test(message)) {
    return '报销属性未能选定。请查看报销属性旁是否有企业系统提示。';
  }
  if (/含原始纸质附件|undefined-input/.test(message)) return '未能定位或操作「含原始纸质附件」选择框。';
  if (/FormTextInput4-input|报销事由/.test(message)) return '报销事由未能写入或读回一致。';
  if (/默认|费用事项/.test(message)) return '费用事项的默认行未能清理或核对。';
  return '基础信息控件操作未完成。请查看企业窗口是否有下拉框或帮助字典弹窗。';
}

export function getFormPage() {
  const { page, signal } = session.getStore();
  signal?.throwIfAborted();
  if (page.isClosed() || new URL(page.url()).origin !== 'https://fip.cscec.com') {
    throw new Error('报销表单已离开企业门户。');
  }
  return page;
}

export { getFormPage as getActivePage, getFormPage as getPortalPage };

export function reviewAccount(page, task, signal, { autoSelect = false } = {}) {
  return session.run({ page, signal }, async () => {
    try {
      const { maskedAccount } = await inspectPaymentAccount(task);
      return { maskedAccount };
    } catch {
      signal?.throwIfAborted();
      if (autoSelect) {
        try {
          await openPaymentAccountPicker();
          const { maskedAccount } = await selectPaymentAccount(task);
          return { maskedAccount };
        } catch {
          signal?.throwIfAborted();
        }
      }
      return { maskedAccount: null };
    }
  });
}

export function saveReviewedDraft(page, task, signal) {
  return session.run({ page, signal }, async () => {
    try {
      await verifyFormPrepared(task);
      const { maskedAccount } = await reviewAccount(page, task, signal);
      if (!maskedAccount) return { status: 'account-required' };
      await verifyInvoiceImaging(task);
      const existing = await checkDraftTotals(page, task);
      if (existing) return { status: 'saved', documentNumber: existing };
    } catch {
      return { status: 'save-blocked' };
    }
    signal?.throwIfAborted();
    const result = await saveDraft(task);
    if (!result.saved || !/^[A-Za-z0-9-]{5,64}$/.test(result.documentNumber)) {
      throw new Error('草稿单号未核实。');
    }
    return { status: 'saved', documentNumber: result.documentNumber };
  });
}

export async function checkDraftTotals(page, task) {
  const expected = task.matches.reduce((sum, match) => sum + Math.round(match.invoice.total * 100), 0);
  const snapshots = [];
  for (const frame of page.frames()) {
    if (new URL(frame.url()).origin !== 'https://fip.cscec.com') continue;
    snapshots.push(await frame.evaluate(() => {
      const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
      const text = element => (element?.innerText || '').trim();
      const value = (row, index) => text(row.querySelector(`td[cellindex="${index}"]`));
      const traffic = Array.from(document.querySelectorAll('tr')).filter(row =>
        visible(row) && row.querySelector('td[cellindex="18"]') && value(row, 8).includes('发票'));
      const tables = Array.from(document.querySelectorAll('table')).filter(visible);
      const paymentIndex = tables.findIndex(table => text(table).includes('客商(员工)编号') && text(table).includes('付款金额'));
      const payment = paymentIndex >= 0 ? tables[paymentIndex + 1]?.querySelector('tr:has(td[cellindex="5"])') : null;
      return {
        traffic: traffic.map(row => ({ name: value(row, 2), amount: value(row, 10), remark: value(row, 18) })),
        payment: payment ? { amount: value(payment, 9) } : null,
        documentNumber: text(document.body).match(/单据编号[：:]\s*(TBX[A-Za-z0-9-]{2,61})/)?.[1],
      };
    }));
  }
  const traffic = snapshots.flatMap(item => item.traffic);
  const payments = snapshots.map(item => item.payment).filter(Boolean);
  if (traffic.length !== task.matches.length || traffic.some(row => row.name !== task.employeeName || !row.remark) ||
      traffic.reduce((sum, row) => sum + cents(row.amount), 0) !== expected ||
      payments.length !== 1 || cents(payments[0].amount) !== expected) throw new Error('费用或付款金额核对失败。');
  const expectedRows = task.matches.map(match => JSON.stringify([cents(match.invoice.total), match.remark.trim()])).sort();
  const actualRows = traffic.map(row => JSON.stringify([cents(row.amount), row.remark])).sort();
  if (expectedRows.some((value, index) => value !== actualRows[index])) throw new Error('交通费用逐行核对失败。');
  return snapshots.find(item => item.documentNumber)?.documentNumber;
}

export async function fillTrafficWithMaterials(page, task, materials, signal, onProgress) {
  const originalTask = {
    ...task,
    matches: task.matches.map(match => ({
      ...match, confirmedOrigin: match.origin, confirmedDestination: match.destination,
      invoice: { ...match.invoice, filePath: materials.get(match.invoice.fileName) },
      itinerary: { ...match.itinerary, filePath: materials.get(match.itinerary.fileName) },
    })),
  };
  return session.run({ page, signal, onProgress }, async () => {
    await atStage('base-fields', async () => {
      try {
        await openScopedReimbursementHelp(page);
        await prepareBaseInformation(originalTask);
        await removeDefaultExpenseRow();
        await verifyFormPrepared(originalTask);
      } catch (cause) {
        const error = new Error('基础信息未能填写或核对。', { cause });
        error.portalDetail = baseFieldDetail(cause);
        throw error;
      }
    });
    const { results } = await atStage('ticket-pool', () => inspectTrafficInvoicePool(originalTask));
    if (results.length !== originalTask.matches.length || results.some(item => item.found && !item.valid)) {
      const error = new Error('票据池中缺少可用发票。');
      error.code = 'TICKETS_UNAVAILABLE';
      error.stage = 'ticket-pool';
      throw error;
    }
    const missing = originalTask.matches.filter((_, index) => !results[index].found);
    if (missing.length) {
      await atStage('invoice-imaging', async () => {
        await openInvoiceImaging();
        const upload = await uploadInvoiceImages({ ...originalTask, matches: missing });
        if (upload.haltedForUserDecision) {
          throw imagingFailure('企业系统提示需要人工核对发票影像。', upload.uploaded.at(-1)?.warning);
        }
        const result = await submitInvoiceImaging();
        if (!result.submitted) throw imagingFailure('发票影像入池未通过。', result.warning);
        await returnToReimbursementForm();
      });
    }
    await atStage('itinerary-attachments', async () => {
      await openAttachments();
      const input = await waitForAttachmentInput(page, { signal });
      try {
        await uploadItineraryAttachments(originalTask, paths => {
          signal?.throwIfAborted();
          return input.setInputFiles(paths, { timeout: 8000 });
        });
        await closeAttachments();
      } catch (cause) {
        const error = new Error('行程单附件未完成核对。', { cause });
        error.portalDetail = cause.message.includes('上传超时')
          ? '企业附件列表没有显示行程单，请先核对上传结果。'
          : cause.message.includes('自动关闭')
            ? '行程单已出现在附件列表，附件窗口未能自动关闭。'
            : '行程单上传中断，请查看企业窗口内的提示。';
        throw error;
      }
    });
    await atStage('traffic-fields', async () => {
      await openTrafficTicketPool();
      await selectTrafficInvoices(originalTask);
      const rows = await getTrafficRows(page);
      const snapshot = await Promise.all(rows.map(async row => ({
        amount: (await row.locator('td[cellindex="10"]').innerText({ timeout: 3000 })).trim(),
        numbers: (await row.innerText({ timeout: 3000 })).match(/\d{8,32}/g) || [],
      })));
      let matches;
      try { matches = matchTrafficRows(snapshot, originalTask.matches); }
      catch {
        const error = new Error('交通费用行无法核对。');
        error.portalDetail = '无法确认费用行和发票的对应关系，已停止填写。请在企业窗口核对。';
        throw error;
      }
      await fillTrafficRows({ ...originalTask, matches });
    });
  });
}
