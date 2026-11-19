import { setTimeout } from 'node:timers/promises';

export async function waitForAttachmentInput(page, { signal, timeout = 8000 } = {}) {
  const origin = new URL(page.url()).origin;
  const deadline = Date.now() + timeout;
  let counts = { attachment: 0, pdf: 0 };
  do {
    signal?.throwIfAborted();
    const attachment = [];
    const pdf = [];
    for (const frame of page.frames()) {
      if (new URL(frame.url()).origin !== origin) continue;
      if (!await frame.getByText('附件窗口', { exact: true }).first().isVisible().catch(() => false)) continue;
      const input = frame.locator('input[type="file"][accept*=".ofd"], input[type="file"][accept*=".pdf" i]');
      for (let index = 0, count = await input.count().catch(() => 0); index < count; index++) {
        const candidate = input.nth(index);
        if (!await candidate.isEnabled().catch(() => false)) continue;
        const accept = await candidate.getAttribute('accept', { timeout: 500 }).catch(() => '');
        if (!accept) continue;
        (accept.toLowerCase().includes('.ofd') ? attachment : pdf).push(candidate);
      }
    }
    counts = { attachment: attachment.length, pdf: pdf.length };
    const candidates = attachment.length ? attachment : pdf;
    if (candidates.length === 1) return candidates[0];
    if (Date.now() >= deadline) break;
    await setTimeout(150, undefined, { signal });
  } while (true);
  const error = new Error('附件上传控件未就绪。');
  error.portalDetail = `已打开附件窗口，但未找到唯一可用的上传控件（附件控件 ${counts.attachment}，PDF 控件 ${counts.pdf}）。行程单尚未交给企业系统。`;
  throw error;
}
