import { expect, test } from './fixtures'

test.describe('home', () => {
  test('renders the hero and a live demo built from one dataset', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'VizLab', level: 1 })).toBeVisible()
    await expect(page.getByText('인터랙티브 데이터 시각화 백과사전')).toBeVisible()
    const demo = page.getByTestId('hero-demo')
    await expect(demo.getByTestId('hero-marks').locator('circle')).toHaveCount(140)
    await expect(demo).toHaveAttribute('data-stage', 'scatter')
    await expect(demo.getByTestId('hero-count')).toHaveText('1 / 64')
    // auto-advances to the next representation of the same data after ~1.8 s
    await expect(demo).toHaveAttribute('data-stage', 'histogram', { timeout: 4000 })
    await expect(page.getByTestId('featured-scatter')).toBeVisible()
    await expect(page.getByTestId('home-cat-distribution')).toBeVisible()
  })

  test('hero prev/next buttons step through the stages and the chart links to the matching lab', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    const demo = page.getByTestId('hero-demo')
    await page.getByTestId('hero-next').click()
    await expect(demo).toHaveAttribute('data-stage', 'histogram')
    await page.getByTestId('hero-next').click()
    await expect(demo).toHaveAttribute('data-stage', 'kde')
    await expect(page.getByTestId('hero-name')).toHaveText('KDE 플롯')
    await page.getByTestId('hero-prev').click()
    await expect(demo).toHaveAttribute('data-stage', 'histogram')
    await page.getByTestId('hero-next').click()
    await page.getByTestId('hero-link').click()
    await expect(page).toHaveURL(/#\/viz\/kde$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('KDE')
  })

  test('respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('./')
    await page.waitForTimeout(4200)
    await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-stage', 'scatter')
    await expect(page.getByTestId('hero-demo')).toHaveAttribute('data-running', '0')
  })

  test('the call to action opens the catalog', async ({ page }) => {
    await page.goto('./')
    await page.getByTestId('hero-cta').click()
    await expect(page).toHaveURL(/#\/catalog$/)
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(281)
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

  test('category links filter the catalog and no category is empty', async ({ page }) => {
    await page.goto('./')
    await page.getByTestId('nav-cat-timeseries').click()
    await expect(page).toHaveURL(/#\/catalog\/timeseries$/)
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(45)
    await expect(page.getByTestId('sidebar').getByText('준비 중')).toHaveCount(0)
    await page.getByTestId('nav-cat-hierarchy').click()
    await expect(page).toHaveURL(/#\/catalog\/hierarchy$/)
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(16)
    await page.getByTestId('nav-cat-uncertainty').click()
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(44)
    for (const c of ['geo', 'network', 'special', 'science', 'bio', 'finance']) {
      await page.getByTestId(`nav-cat-${c}`).click()
      await expect(page).toHaveURL(new RegExp(`#/catalog/${c}$`))
      await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount({ geo: 46, network: 25, special: 13, science: 33, bio: 12, finance: 20 }[c]!)
    }
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
    await expect(cards).toHaveCount(281)
    await cards.last().scrollIntoViewIfNeeded()
    for (const id of ['scatter', 'heatmap', 'radar', 'ridgeline', 'sankey', 'ci']) {
      await page.getByTestId(`card-${id}`).scrollIntoViewIfNeeded()
      await expect(page.getByTestId(`preview-${id}`).locator('svg')).toBeVisible()
    }
  })

  test('searches Korean names, English names and keywords', async ({ page }) => {
    const search = page.getByTestId('catalog-search')
    const cards = page.getByTestId('catalog-grid').locator('.viz-card')
    await search.fill('히스토')
    await expect(cards).toHaveCount(5) // 히스토그램, the PIT histogram, rank plots and the joint distribution (their names or summaries mention a histogram)
    await expect(page.getByTestId('card-histogram')).toBeVisible()
    await search.fill('violin')
    await expect(cards).toHaveCount(2)
    await expect(page.getByTestId('card-violin')).toBeVisible()
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
    expect(comparison).toBeGreaterThan(8)
    await page.getByTestId('catalog-search').fill('막대')
    await expect(cards).toHaveCount(9) // the v0.5 polar and radial bar charts match too
    await page.getByTestId('chip-composition').click()
    await expect(cards).toHaveCount(3)
    await expect(page.getByTestId('card-stacked-bar')).toBeVisible()
    await expect(page.getByTestId('card-stacked-bar-100')).toBeVisible()
    await expect(page.getByTestId('card-pyramid')).toBeVisible()
    await page.getByTestId('chip-all').click()
    await expect(cards).toHaveCount(11)
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
    await page.goto('./#/viz/not-a-chart')
    await expect(page.getByTestId('not-found')).toBeVisible()
  })
})
