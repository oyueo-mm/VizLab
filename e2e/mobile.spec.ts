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
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(320)
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
    for (const id of ['pairplot', 'parallel', 'treemap', 'heatmap', 'radar', 'ridgeline', 'sankey', 'chord', 'calendar', 'dendrogram']) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      await noHorizontalScroll(page)
    }
  })
})

const NEW_LABS = ['kde2d', 'pp', 'letter-value', 'connected-scatter', 'pca-biplot', 'andrews', 'pyramid', 'pareto', 'bullet', 'step', 'candlestick', 'horizon', 'mosaic', 'icicle', 'network', 'arc', 'alluvial', 'roc', 'pr', 'fan']

test.describe('mobile: v0.3', () => {
  test('the catalog collapses its filters behind a button and keeps them in the URL', async ({ page }) => {
    await page.goto('./#/catalog')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.getByTestId('filter-toggle')).toBeVisible()
    await expect(page.getByTestId('kind-timeseries')).toBeHidden()
    const closed = (await page.locator('.catalog-head').boundingBox())!
    await page.getByTestId('filter-toggle').click()
    await expect(page.getByTestId('kind-timeseries')).toBeVisible()
    await page.getByTestId('kind-timeseries').click()
    await expect(page).toHaveURL(/\?t=timeseries$/)
    await expect(page.getByTestId('filter-toggle')).toContainText('1')
    await expect(page.getByTestId('result-count')).toBeVisible()
    await noHorizontalScroll(page)
    await page.getByTestId('filter-toggle').click()
    await expect(page.getByTestId('kind-timeseries')).toBeHidden()
    expect(closed.height).toBeGreaterThan(0)
    await page.getByTestId('filter-reset').click()
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(320)
  })

  test('every new lab fits a phone without sideways page scrolling', async ({ page }) => {
    for (const id of NEW_LABS) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      await noHorizontalScroll(page)
      const box = (await page.getByTestId('chart-svg').boundingBox())!
      expect(box.width, id).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
      expect(box.height, id).toBeGreaterThan(150)
    }
  })

  test('chart labels, legend and readout do not overlap on the dense new charts', async ({ page }) => {
    for (const id of ['pca-biplot', 'network', 'alluvial', 'candlestick', 'horizon', 'mosaic', 'fan']) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      const boxes = await page.locator('.chart-legend, .chart-readout').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width } }))
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const c = boxes[j]
        const overlap = a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1
        expect(overlap, `${id}: legend/readout overlap`).toBe(false)
      }
    }
  })

  test('settings for a new chart open in the bottom sheet and change the chart', async ({ page }) => {
    await page.goto('./#/viz/pca-biplot')
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('settings-panel')).toBeVisible()
    await page.getByTestId('ctl-arrows').uncheck()
    await page.getByTestId('sheet-close').click()
    await expect(page.getByTestId('pca-arrow')).toHaveCount(0)
  })

  test('the calendar heatmap keeps readable cells and scrolls sideways inside the chart', async ({ page }) => {
    await page.goto('./#/viz/calendar')
    await expect(page.getByTestId('cal-cell').first()).toBeVisible()
    await noHorizontalScroll(page)
    const cell = (await page.getByTestId('cal-cell').first().boundingBox())!
    expect(cell.width).toBeGreaterThanOrEqual(13)
    const scroll = page.getByTestId('cal-scroll')
    const sizes = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(sizes.sw).toBeGreaterThan(sizes.cw)
    // a quarter fits the screen with larger cells
    await page.getByTestId('open-settings').click()
    await page.getByTestId('ctl-view').selectOption('q1')
    await page.getByTestId('sheet-close').click()
    const q = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(q.sw).toBeLessThanOrEqual(q.cw + 1)
    const big = (await page.getByTestId('cal-cell').first().boundingBox())!
    expect(big.width).toBeGreaterThanOrEqual(cell.width)
  })

  test('the comparison lab stacks charts vertically and still shares one dataset', async ({ page }) => {
    await page.goto('./#/compare')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.getByTestId('compare-pane-0')).toBeVisible()
    await noHorizontalScroll(page)
    const a = (await page.getByTestId('compare-pane-0').boundingBox())!
    const b = (await page.getByTestId('compare-pane-1').boundingBox())!
    const c = (await page.getByTestId('compare-pane-2').boundingBox())!
    expect(b.y).toBeGreaterThan(a.y + a.height - 2)
    expect(c.y).toBeGreaterThan(b.y + b.height - 2)
    expect(a.width).toBeGreaterThan(300)
    await expect(page.getByTestId('pane-chart-2').locator('svg').first()).toBeVisible()
    await page.getByTestId('compare-size-quick').fill('120')
    await expect(page.getByTestId('compare-size-quick')).toHaveValue('120')
    await page.getByTestId('pane-settings-0').click()
    await expect(page.getByTestId('pane-panel-0')).toBeVisible()
    await noHorizontalScroll(page)
    await page.getByTestId('compare-edit-data').click()
    await expect(page.getByTestId('compare-data')).toBeVisible()
    await noHorizontalScroll(page)
  })
})

const V4_LABS = ['choropleth', 'symbol-map', 'dot-density', 'geo-hexbin', 'flow-map', 'tile-grid', 'dorling', 'forest', 'bland-altman', 'calibration', 'control', 'funnel-plot', 'gantt', 'funnel', 'marimekko', 'flame', 'adjacency', 'edge-bundling', 'bipartite', 'hive']

test.describe('mobile: v0.4', () => {
  test('every v0.4 lab fits a phone without sideways page scrolling and keeps a usable chart height', async ({ page }) => {
    test.setTimeout(120000)
    for (const id of V4_LABS) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      await noHorizontalScroll(page)
      const box = (await page.getByTestId('chart-svg').boundingBox())!
      expect(box.width, id).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
      expect(box.height, id).toBeGreaterThan(150)
      await expect(page.locator('.chart-message'), id).toHaveCount(0)
    }
  })

  test('legend and readout do not overlap on the dense new charts', async ({ page }) => {
    for (const id of ['choropleth', 'symbol-map', 'forest', 'control', 'flame', 'adjacency', 'hive', 'edge-bundling', 'marimekko', 'funnel']) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      const boxes = await page.locator('.chart-legend, .chart-readout, .map-zoom, .chart-actions').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom } }))
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]; const c = boxes[j]
        expect(a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1, `${id}: overlay boxes ${i}/${j}`).toBe(false)
      }
    }
  })

  test('map: zoom buttons are touch-sized, pinch and drag move the map, and zoom does not edit data', async ({ page }) => {
    await page.goto('./#/viz/choropleth')
    const svg = page.getByTestId('chart-svg')
    await expect(page.getByTestId('map-region').first()).toBeVisible()
    const btn = (await page.getByTestId('map-zoom-in').boundingBox())!
    expect(btn.width).toBeGreaterThanOrEqual(36)
    expect(btn.height).toBeGreaterThanOrEqual(36)
    const zoom = async () => Number(await svg.getAttribute('data-zoom'))
    await page.getByTestId('map-zoom-in').tap()
    await expect.poll(zoom).toBeGreaterThan(1.3)
    await page.getByTestId('map-zoom-reset').tap()
    await expect.poll(zoom).toBeCloseTo(1, 1)
    // two-finger pinch through the DevTools protocol (a touch gesture, not a mouse event)
    const box = (await svg.boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.synthesizePinchGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, scaleFactor: 2.2, relativeSpeed: 400, gestureSourceType: 'touch' })
    await expect.poll(zoom).toBeGreaterThan(1.4)
    // a one-finger drag pans; the values in the table stay as they were
    const seoul = page.locator('[data-testid="map-region"][data-id="KR-11"]')
    const value = await seoul.getAttribute('data-value')
    await cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, xDistance: 80, yDistance: 40, gestureSourceType: 'touch', speed: 800 })
    expect(await seoul.getAttribute('data-value')).toBe(value)
  })

  test('tapping a region edits its value; tapping a node selects it', async ({ page }) => {
    await page.goto('./#/viz/choropleth')
    const seoul = page.locator('[data-testid="map-region"][data-id="KR-11"]')
    await seoul.tap()
    await expect(page.getByTestId('map-input')).toBeVisible()
    await page.getByTestId('map-input').fill('777')
    await page.getByTestId('map-input').press('Enter')
    await expect(seoul).toHaveAttribute('data-value', '777')
    await page.goto('./#/viz/hive')
    await page.getByTestId('hive-node').first().locator('circle').tap()
    await expect(page.getByTestId('chart-svg').locator('[stroke="#e07a3f"]').first()).toBeAttached()
  })

  test('settings and data of a map open in the bottom sheet; a long edit table stays inside the screen', async ({ page }) => {
    await page.goto('./#/viz/flow-map')
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('settings-panel')).toBeVisible()
    await page.getByTestId('ctl-flow-width').fill('6')
    await page.getByTestId('sheet-close').click()
    await page.getByTestId('open-data').click()
    await expect(page.getByTestId('data-table')).toBeVisible()
    await noHorizontalScroll(page)
  })

  test('rotating to landscape keeps the labs inside the screen', async ({ page }) => {
    await page.goto('./#/viz/gantt')
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await page.setViewportSize({ width: 915, height: 412 })
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await noHorizontalScroll(page)
    for (const id of ['choropleth', 'control', 'flame']) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      await noHorizontalScroll(page)
    }
  })

  test('the fullscreen button works for a map', async ({ page }) => {
    await page.goto('./#/viz/choropleth')
    await page.getByTestId('fullscreen').click()
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    await page.keyboard.press('Escape').catch(() => {})
    await noHorizontalScroll(page)
  })
})
