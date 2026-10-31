import { expect, test } from './fixtures'

test.use({ viewport: { width: 820, height: 1180 } })

const noHorizontalScroll = async (page: import('@playwright/test').Page) => {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(sw).toBeLessThanOrEqual(iw + 1)
}

test.describe('tablet', () => {
  test('home, catalog and the animation fit', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('hero-demo')).toBeVisible()
    const box = (await page.getByTestId('hero-demo').boundingBox())!
    expect(box.width).toBeLessThanOrEqual(820)
    await expect(page.getByTestId('hero-marks').locator('circle')).toHaveCount(140)
    await noHorizontalScroll(page)
    await page.getByTestId('hero-cta').click()
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(40)
    await noHorizontalScroll(page)
  })

  for (const id of ['ridgeline', 'calendar', 'sankey', 'chord', 'dendrogram', 'sunburst', 'waffle', 'ci']) {
    test(`${id} lab renders`, async ({ page }) => {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      await noHorizontalScroll(page)
      const svg = (await page.getByTestId('chart-svg').boundingBox())!
      expect(svg.width).toBeGreaterThan(300)
      expect(svg.height).toBeGreaterThan(200)
    })
  }
})
