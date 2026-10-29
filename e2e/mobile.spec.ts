import { expect, readout, setRange, test } from './fixtures'

const noHorizontalScroll = async (page: import('@playwright/test').Page) => {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(sw).toBeLessThanOrEqual(iw + 1)
}

test.describe('mobile', () => {
  test('home and catalog fit the screen; the menu is a drawer', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'VizLab', level: 1 })).toBeVisible()
    await expect(page.getByTestId('hero-demo')).toBeVisible()
    await noHorizontalScroll(page)
    await page.getByTestId('mobile-menu').click()
    await expect(page.getByTestId('sidebar')).toHaveClass(/is-open/)
    await page.getByTestId('nav-catalog').click()
    await expect(page).toHaveURL(/#\/catalog$/)
    await expect(page.getByTestId('sidebar')).not.toHaveClass(/is-open/)
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(20)
    await noHorizontalScroll(page)
  })

  test('labs work with a bottom sheet for settings and data', async ({ page }) => {
    await page.goto('./#/viz/histogram')
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await noHorizontalScroll(page)
    await expect(page.getByTestId('settings-panel')).toBeHidden()
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('settings-panel')).toBeVisible()
    await setRange(page.getByTestId('ctl-bins'), 8)
    await page.getByTestId('sheet-close').click()
    await expect(page.locator('.mark-bar')).toHaveCount(8)
    const box = (await page.getByTestId('chart-svg').boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(readout(page, 'n')).toHaveText('201')
    await page.getByTestId('open-data').click()
    await expect(page.getByTestId('data-table')).toBeVisible()
  })

  test('every lab renders on a phone', async ({ page }) => {
    for (const id of ['pairplot', 'parallel', 'treemap', 'heatmap', 'radar']) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      await noHorizontalScroll(page)
    }
  })
})
