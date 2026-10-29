import { expect, test as base, type Locator, type Page } from '@playwright/test'

/** Fails any test that logs a console error or throws an uncaught exception. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(e.message))
    await use(errors)
    expect(errors, 'console errors').toEqual([])
  }, { auto: true }],
})

export { expect }

export async function openViz(page: Page, id: string) {
  await page.goto(`./#/viz/${id}`)
  await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', id)
  await expect(page.getByTestId('chart-svg')).toBeVisible()
}

/** Text of a readout value by its label (e.g. 'n'). */
export const readout = (page: Page, label: string) => page.locator('.chart-readout div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')

export async function setRange(input: Locator, value: number) {
  await input.fill(String(value))
}

/** Absolute page coordinates of a point inside the chart svg. */
export async function svgPoint(page: Page, fx: number, fy: number) {
  const box = (await page.getByTestId('chart-svg').boundingBox())!
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

export async function dragBy(page: Page, target: Locator, dx: number, dy: number) {
  const b = (await target.boundingBox())!
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6)
  await page.mouse.up()
}

export const settle = (page: Page) => page.waitForTimeout(550)
