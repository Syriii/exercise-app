import type { Locator } from '@playwright/test';

// Follow the same explicit disclosure controls as a person. No forced clicks or DOM mutations.
export async function reveal(target: Locator) {
  await target.waitFor({ state: 'attached' });
  const parents = await target.locator('xpath=ancestor::details').all();
  for (const details of parents) {
    if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  }
}
