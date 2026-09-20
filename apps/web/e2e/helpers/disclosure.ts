import type { Locator } from '@playwright/test';

// Follow the same explicit disclosure controls as a person. No forced clicks or DOM mutations.
export async function reveal(target: Locator) {
  await target.waitFor({ state: 'attached' });
  const parents = await target.locator('xpath=ancestor::details').all();
  const element = await target.elementHandle();
  for (const details of parents) {
    // A summary is already the disclosure control: reveal its ancestors, but do not
    // open its own details and then let the caller's click immediately close it.
    if (await details.locator(':scope > summary').evaluate((summary, node) => summary === node, element)) continue;
    if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  }
}
