import { expect, test } from './fixtures'

/** Mobile checks run in Chromium with the Pixel 7 device profile (emulation, not a physical phone). */
const LABS: string[] = ["point-map","kde-map","square-grid","cluster-map","spike-map","isoline","hillshade","slope-aspect","vector-field","streamline","particle-flow","bivariate","chorochromatic","vba-map","glyph-map","cartogram-contiguous","cartogram-noncontiguous","demers","gridded-cartogram","voronoi-map","isochrone","buffer-map","hotspot","lisa","trajectory","tissot","raster-map","terrain-profile","terrain-3d","prism-map","space-time-cube","dasymetric","residual-plot","scale-location","influence-plot","coefficient-plot","partial-dependence","kaplan-meier","nelson-aalen","bootstrap","ewma","cusum","lift-gain","pit-histogram","surface-3d","scatter-3d","phase-portrait","bifurcation","spectrogram","scalogram","recurrence-plot","ternary","wind-rose","polar-plot","polar-heatmap","delaunay","renko","heikin-ashi","kagi","point-figure","equivolume","volume-profile","line-break","drawdown","yield-curve","order-book","pictogram","nightingale-rose","radial-bar","event-raster","barcode-plot","lexis","cumulative-flow","spiral-plot","volcano","ma-plot","manhattan","sequence-logo","coverage","pcoa","phylogenetic-tree","clustered-heatmap","venn","upset","hypergraph","biofabric","radial-tree"]

const noHorizontalScroll = async (page: import('@playwright/test').Page) => {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(sw).toBeLessThanOrEqual(iw + 1)
}

test.describe('mobile: v0.5', () => {
  test('every v0.5 lab fits a phone without sideways page scrolling and keeps a usable chart height', async ({ page }) => {
    test.setTimeout(240000)
    for (const id of LABS) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', id)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      await noHorizontalScroll(page)
      const box = (await page.getByTestId('chart-svg').boundingBox())!
      expect(box.width, id).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
      expect(box.height, id).toBeGreaterThan(150)
      await expect(page.locator('.chart-message'), id).toHaveCount(0)
    }
  })

  test('legend, readout and map controls do not overlap on the dense new charts', async ({ page }) => {
    for (const id of ['volcano', 'manhattan', 'upset', 'venn', 'kaplan-meier', 'renko', 'order-book', 'yield-curve', 'hotspot', 'bivariate', 'cluster-map', 'clustered-heatmap']) {
      await page.goto(`./#/viz/${id}`)
      await expect(page.getByTestId('chart-svg')).toBeVisible()
      const boxes = await page.locator('.chart-legend, .chart-readout, .map-zoom, .chart-actions').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom } }))
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]; const c = boxes[j]
        expect(a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1, `${id}: overlay boxes ${i}/${j}`).toBe(false)
      }
    }
  })

  test('the settings of a new chart open in the bottom sheet and change the chart', async ({ page }) => {
    await page.goto('./#/viz/volcano')
    await expect(page.getByTestId('chart-svg')).toBeVisible()
    const legend = page.locator('.chart-legend')
    const before = await legend.innerText()
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('settings-panel')).toBeVisible()
    await page.getByTestId('ctl-volcano-fdr').uncheck()
    await page.getByTestId('sheet-close').click()
    await expect.poll(async () => legend.innerText()).not.toBe(before)
  })

  test('the catalog sub-category filters fit the phone, and the home animation runs 80 charts', async ({ page }) => {
    await page.goto('./#/catalog/geo')
    if (await page.getByTestId('filter-toggle').isVisible()) await page.getByTestId('filter-toggle').click()
    await expect(page.getByTestId('sub-filters')).toBeVisible()
    await page.getByTestId('sub-surface').click()
    await noHorizontalScroll(page)
    await page.goto('./')
    await expect(page.getByTestId('hero-count')).toHaveText('1 / 90')
    await noHorizontalScroll(page)
  })

  test('the comparison lab stacks the new presets and keeps every pane inside the screen', async ({ page }) => {
    for (const preset of ['terrain', 'set-overlap', 'differential-expression']) {
      await page.goto(`./#/compare/${preset}`)
      await expect(page.getByTestId('pane-chart-0').locator('svg').first()).toBeVisible()
      await noHorizontalScroll(page)
    }
  })
})
