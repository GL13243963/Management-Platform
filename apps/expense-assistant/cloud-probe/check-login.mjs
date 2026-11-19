import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const portalOrigin = 'https://fip.cscec.com';
const portalUrl = `${portalOrigin}/OSPPortal/CSCPortal.jsp`;
const loginTimeout = 5 * 60_000;
// Use the same visible reimbursement-reason control as M-baoxiao.
const formControl = '[id="FormTextInput4-input"]:visible';

export async function waitForPortalForm(context, timeout = 20_000, signal, { autoOpen = false, onProgress } = {}) {
  const deadline = Date.now() + timeout;
  const progress = new WeakMap();
  let menuRetries = 0;
  const onRetry = () => onProgress?.('portal-login', ++menuRetries);
  let menuStatus = '等待企业登录或费用报销菜单。';
  do {
    signal?.throwIfAborted();
    if (!context.browser()?.isConnected()) throw new Error('云端浏览器已关闭。');
    for (const page of context.pages()) {
      if (page.isClosed() || new URL(page.url()).origin !== portalOrigin) continue;
      for (const frame of page.frames()) {
        if (new URL(frame.url()).origin !== portalOrigin) continue;
        const control = frame.locator(formControl).first();
        if (await control.isVisible().catch(() => false)) return control;
      }
      if (autoOpen) menuStatus = await advancePortalMenu(page, progress, signal, onRetry);
    }
    await setTimeout(200, undefined, { signal });
  } while (Date.now() < deadline);
  const error = new Error('等待通用报销单输入区域超时。');
  error.portalDetail = menuStatus;
  throw error;
}

async function advancePortalMenu(page, progress, signal, onRetry) {
  const state = progress.get(page) || { report: 0, nextReportAt: 0, category: false, form: false };
  if (state.form) return '已点击通用报销单，等待报销事由输入框超时。';
  progress.set(page, state);
  const frames = page.frames().filter(frame => new URL(frame.url()).origin === portalOrigin);
  const actions = [
    // This selector is specific to the service directory. History cards may share the caption.
    { key: 'form', select: frame => frame.locator('li.title > span.txt').filter({
      hasText: /^(通用报销单|General Reimbursement Form)$/i,
    }) },
    { key: 'category', select: frame => frame.getByText(/^(员工薪酬及费用|SAL&EXP)$/i) },
    { key: 'report', select: frame => frame.locator('li[data-menu-id$="-00010003"]') },
  ];
  for (const { key, select } of actions) {
    if (key === 'report' ? state.category || state.report >= 3 || Date.now() < state.nextReportAt : state[key]) continue;
    const visible = [];
    for (const frame of frames) {
      const items = select(frame);
      const count = await items.count().catch(() => 0);
      for (let index = 0; index < count; index++) {
        const item = items.nth(index);
        if (await item.isVisible().catch(() => false)) visible.push(item);
      }
    }
    if (visible.length !== 1) {
      if (key === 'form' && visible.length > 1) return '发现多个同名通用报销单入口，请在企业窗口选中费用报销菜单中的入口。';
      continue;
    }
    signal?.throwIfAborted();
    try {
      await visible[0].click({ timeout: 3000, force: key === 'report' });
    } catch (error) {
      signal?.throwIfAborted();
      if (error.name !== 'TimeoutError') throw error;
      onRetry();
      return key === 'form' ? '已找到通用报销单，点击入口超时。' : '已找到报销菜单，点击菜单超时。';
    }
    if (key === 'report') {
      state.report++;
      state.nextReportAt = Date.now() + 1500;
    } else {
      state[key] = true;
    }
    return key === 'form' ? '已点击通用报销单，等待报销事由输入框超时。' : '已打开报销菜单，等待通用报销单入口。';
  }
  return '等待费用报销菜单中的通用报销单入口超时。';
}

export async function openPortalBrowser({ task, materials, autoSave, signal, onProgress, env = process.env } = {}) {
  signal?.throwIfAborted();
  if (process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    throw new Error('请从可交互的云端图形会话运行。网页终端本身无法显示浏览器窗口。');
  }
  const { chromium } = createRequire(import.meta.url)('playwright-core');
  const browser = await chromium.launch({
    headless: false,
    executablePath: env.EXPENSE_CHROMIUM_PATH || undefined,
    env,
    chromiumSandbox: true,
    timeout: 30_000,
  });
  let closing;
  let save;
  const close = () => closing ??= browser.close();
  const ready = (async () => {
    signal?.throwIfAborted();
    const context = await browser.newContext({ acceptDownloads: false, locale: 'zh-CN' });
    const page = await context.newPage();
    const response = await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!response?.ok()) throw new Error(`企业入口访问失败，HTTP ${response?.status() ?? '无响应'}。`);
    onProgress?.('portal-login', 0);
    const control = await waitForPortalForm(context, loginTimeout, signal, { autoOpen: true, onProgress });
    if (task) {
      const existing = (await control.inputValue({ timeout: 3000 })).trim();
      if (existing && existing !== '通用费用报销-') throw new Error('报销事由已有内容，请检查当前表单。');
      const { fillTrafficWithMaterials, reviewAccount, saveReviewedDraft } = await import('./traffic-bundle.mjs');
      const formPage = control.page();
      onProgress?.('material-transfer');
      await fillTrafficWithMaterials(formPage, task, await materials, signal, onProgress);
      onProgress?.('review');
      save = () => saveReviewedDraft(formPage, task, signal);
      return reviewAccount(formPage, task, signal, { autoSelect: autoSave });
    }
  })();
  return { ready, close, save: () => save() };
}

async function main() {
  const browser = await openPortalBrowser();
  try {
    console.log('请在 5 分钟内扫码登录，助手将自动打开通用报销单。');
    await browser.ready;
    console.log('通过：企业登录后的通用报销单输入区域可见。');
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('登录验收未通过。请检查图形会话、Chromium 和报销单页面是否就绪。');
    process.exitCode = 1;
  });
}
