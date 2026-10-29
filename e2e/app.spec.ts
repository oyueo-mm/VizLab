import { expect, test } from './fixtures'

test.describe('home', () => {
  test('renders the hero and a live demo built from one dataset', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'VizLab', level: 1 })).toBeVisible()
    await expect(page.getByText('인터랙티브 데이터 시각화 백과사전')).toBeVisible()
    const demo = page.getByTestId('hero-demo')
    await expect(demo.locator('.hero-points circle')).toHaveCount(140)
    await expect(demo).toHaveAttribute('data-stage', 'scatter')
    // auto-advances to the next representation of the same data
    await expect(demo).toHaveAttribute('data-stage', 'histogram', { timeout: 6000 })
    await expect(page.getByTestId('featured-scatter')).toBeVisible()
    await expect(page.getByTestId('home-cat-distribution')).toBeVisible()
  })

  test('hero stages are selectable and link to the matching lab', async ({ page }) => {
    await page.goto('./')
    await page.getByTestId('hero-stage-kde').click()
    await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', 'kde')
    await page.getByTestId('hero-link').click()
    await expect(page).toHaveURL(/#\/viz\/kde$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('KDE')
  })

  test('respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    await page.waitForTimeout(4200)
    await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', 'scatter')
  })

  test('the call to action opens the catalog', async ({ page }) => {
    await page.goto('./')
    await page.getByTestId('hero-cta').click()
    await expect(page).toHaveURL(/#\/catalog$/)
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(20)
  })
})

test.describe('sidebar', () => {
  test('collapses to icons, expands, and remembers the state', async ({ page }) => {
    await page.goto('./')
    const sidebar = page.getByTestId('sidebar')
    await expect(sidebar.getByText('시각화 도감')).toBeVisible()
    await page.getByTestId('sidebar-toggle').click()
    await expect(sidebar).toHaveClass(/is-collapsed/)
    await expect(sidebar.getByText('시각화 도감')).toBeHidden()
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(80)
    await page.reload()
    await expect(page.getByTestId('sidebar')).toHaveClass(/is-collapsed/)
    await page.getByTestId('nav-catalog').click()
    await expect(page).toHaveURL(/#\/catalog$/)
    await page.getByTestId('sidebar-toggle').click()
    await expect(page.getByTestId('sidebar')).not.toHaveClass(/is-collapsed/)
  })

  test('category links filter the catalog and the 기타 category is marked as not ready', async ({ page }) => {
    await page.goto('./')
    await page.getByTestId('nav-cat-timeseries').click()
    await expect(page).toHaveURL(/#\/catalog\/timeseries$/)
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(2)
    await expect(page.getByTestId('sidebar').getByText('준비 중')).toBeVisible()
  })
})

test.describe('catalog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./#/catalog')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
  })

  test('shows real chart previews for every card', async ({ page }) => {
    const cards = page.getByTestId('catalog-grid').locator('.viz-card')
    await expect(cards).toHaveCount(20)
    await cards.last().scrollIntoViewIfNeeded()
    for (const id of ['scatter', 'heatmap', 'radar']) {
      await page.getByTestId(`card-${id}`).scrollIntoViewIfNeeded()
      await expect(page.getByTestId(`preview-${id}`).locator('svg')).toBeVisible()
    }
  })

  test('searches Korean names, English names and keywords', async ({ page }) => {
    const search = page.getByTestId('catalog-search')
    const cards = page.getByTestId('catalog-grid').locator('.viz-card')
    await search.fill('히스토')
    await expect(cards).toHaveCount(1)
    await expect(page.getByTestId('card-histogram')).toBeVisible()
    await search.fill('violin')
    await expect(cards).toHaveCount(1)
    await search.fill('density')
    await expect(page.getByTestId('card-kde')).toBeVisible()
    await search.fill('이상치')
    await expect(page.getByTestId('card-box')).toBeVisible()
    await search.fill('존재하지않는차트')
    await expect(page.getByTestId('catalog-empty')).toBeVisible()
  })

  test('combines search with category filters', async ({ page }) => {
    const cards = page.getByTestId('catalog-grid').locator('.viz-card')
    await page.getByTestId('chip-comparison').click()
    await expect(page).toHaveURL(/#\/catalog\/comparison$/)
    const comparison = await cards.count()
    expect(comparison).toBeGreaterThan(3)
    await page.getByTestId('catalog-search').fill('막대')
    await expect(cards).toHaveCount(3)
    await page.getByTestId('chip-composition').click()
    await expect(cards).toHaveCount(1)
    await expect(page.getByTestId('card-stacked-bar')).toBeVisible()
    await expect(page.getByTestId('chip-other')).toBeDisabled()
    await page.getByTestId('chip-all').click()
    await expect(cards).toHaveCount(3)
    // the search box survives a reload
    await page.reload()
    await expect(page.getByTestId('catalog-search')).toHaveValue('막대')
  })

  test('cards open the lab, and the route survives a reload', async ({ page }) => {
    await page.getByTestId('card-violin').click()
    await expect(page).toHaveURL(/#\/viz\/violin$/)
    await page.reload()
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', 'violin')
    await page.goBack()
    await expect(page.getByTestId('catalog')).toBeVisible()
  })

  test('unknown charts show a not-found message', async ({ page }) => {
    await page.goto('./#/viz/sankey')
    await expect(page.getByTestId('not-found')).toBeVisible()
  })
})
