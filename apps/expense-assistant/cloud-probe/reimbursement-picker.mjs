const fieldId = 'DataSetFieldComboBox6-input';
const triggerSelector = 'button:visible, [role="button"]:visible, img:visible, [title*="帮助"]:visible';

// Prefer the field's own visible help button when the page exposes one.
// If its markup is ambiguous, let the original adapter locate the picker.
export async function openScopedReimbursementHelp(page) {
  for (const frame of page.frames()) {
    if (await frame.getByText('帮助字典', { exact: true }).first().isVisible().catch(() => false)) return;
  }
  for (const frame of page.frames()) {
    const input = frame.locator(`[id="${fieldId}"]:visible`);
    if (await input.count() !== 1) continue;
    let scope = input;
    for (let depth = 0; depth < 3; depth++) {
      scope = scope.locator('xpath=..');
      if (await scope.locator('input:visible').count() !== 1) break;
      const trigger = scope.locator(triggerSelector);
      if (await trigger.count() !== 1) continue;
      await trigger.click({ timeout: 5000 });
      await frame.getByText('帮助字典', { exact: true }).first().waitFor({ state: 'visible', timeout: 8000 });
      return;
    }
  }
}
