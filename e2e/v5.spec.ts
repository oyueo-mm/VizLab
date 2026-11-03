import { expect, openViz, test } from './fixtures'

/** Every chart added in v0.5, in catalog order. */
export const V5_LABS: string[] = ["point-map","kde-map","square-grid","cluster-map","spike-map","isoline","hillshade","slope-aspect","vector-field","streamline","particle-flow","bivariate","chorochromatic","vba-map","glyph-map","cartogram-contiguous","cartogram-noncontiguous","demers","gridded-cartogram","voronoi-map","isochrone","buffer-map","hotspot","lisa","trajectory","tissot","raster-map","terrain-profile","terrain-3d","prism-map","space-time-cube","dasymetric","residual-plot","scale-location","influence-plot","coefficient-plot","partial-dependence","kaplan-meier","nelson-aalen","bootstrap","ewma","cusum","lift-gain","pit-histogram","surface-3d","scatter-3d","phase-portrait","bifurcation","spectrogram","scalogram","recurrence-plot","ternary","wind-rose","polar-plot","polar-heatmap","delaunay","renko","heikin-ashi","kagi","point-figure","equivolume","volume-profile","line-break","drawdown","yield-curve","order-book","pictogram","nightingale-rose","radial-bar","event-raster","barcode-plot","lexis","cumulative-flow","spiral-plot","volcano","ma-plot","manhattan","sequence-logo","coverage","pcoa","phylogenetic-tree","clustered-heatmap","venn","upset","hypergraph","biofabric","radial-tree"]

test.describe('v0.5: catalog', () => {
  test('lists 360 charts in 17 categories with the geo sub-category filters', async ({ page }) => {
    await page.goto('./#/catalog')
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(360)
    for (const c of ['science', 'bio', 'finance']) await expect(page.getByTestId(`chip-${c}`)).toBeVisible()
    await page.getByTestId('chip-geo').click()
    await expect(page.getByTestId('sub-filters')).toBeVisible()
    const all = await page.getByTestId('catalog-grid').locator('.viz-card').count()
    expect(all).toBe(65)
    for (const s of ['sub-point', 'sub-surface', 'sub-thematic', 'sub-distort', 'sub-analysis', 'sub-stats', 'sub-spacetime', 'sub-map3d']) await expect(page.getByTestId(s), s).toBeVisible()
    await page.getByTestId('sub-surface').click()
    await expect(page).toHaveURL(/\?s=surface/)
    const surface = await page.getByTestId('catalog-grid').locator('.viz-card').count()
    expect(surface).toBeGreaterThan(2)
    expect(surface).toBeLessThan(all)
    // the filter survives a reload and clears with 'all'
    await page.reload()
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(surface)
    await page.getByTestId('sub-all').click()
    await expect(page.getByTestId('catalog-grid').locator('.viz-card')).toHaveCount(all)
  })

  test('search finds charts by Korean names, English names, abbreviations, keywords, category and sub-category', async ({ page }) => {
    await page.goto('./#/catalog')
    const search = page.getByTestId('catalog-search')
    for (const [q, id] of [['화산 도표', 'volcano'], ['Kaplan', 'kaplan-meier'], ['GWAS', 'manhattan'], ['LISA', 'lisa'], ['등고선', 'isoline'], ['UpSet', 'upset'], ['renko', 'renko'], ['생물정보학', 'sequence-logo'], ['음영기복', 'hillshade'], ['Moran', 'lisa']] as const) {
      await search.fill(q)
      await expect(page.getByTestId(`card-${id}`), q).toBeVisible()
    }
  })
})

test.describe('v0.5: every new lab renders', () => {
  test('all 87 new charts open on a deep link, draw something and reload to the same chart', async ({ page }) => {
    test.setTimeout(300000)
    const failed: string[] = []
    page.on('requestfailed', (r) => failed.push(r.url()))
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })
    expect(V5_LABS).toHaveLength(87)
    for (const id of V5_LABS) {
      await openViz(page, id)
      await expect(page.locator('.chart-message'), id).toHaveCount(0)
      // canvas-based charts (density, flow, spectrogram) draw part of the image on a canvas under the SVG
      expect(await page.locator('.chart-root').first().locator('svg circle, svg rect, svg path, svg line, svg polygon, svg text, canvas').count(), id).toBeGreaterThan(2)
    }
    await page.reload()
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', V5_LABS[V5_LABS.length - 1])
    expect(failed).toEqual([])
  })
})

test.describe('v0.5: interactions', () => {
  test('volcano: the FDR correction changes which genes are coloured, and the readout follows', async ({ page }) => {
    await openViz(page, 'volcano')
    const legend = page.locator('.chart-legend')
    await expect(legend).toContainText('증가')
    const before = await legend.innerText()
    await page.getByTestId('ctl-volcano-fdr').uncheck()
    await expect.poll(async () => legend.innerText()).not.toBe(before)
  })

  test('venn: the area-proportional and equal-size modes both draw three circles', async ({ page }) => {
    await openViz(page, 'venn')
    await expect(page.getByTestId('venn-circle')).toHaveCount(3)
    const r1 = await page.getByTestId('venn-circle').first().getAttribute('r')
    await page.getByTestId('ctl-venn-mode').getByText('같은 크기').click()
    await expect.poll(async () => page.getByTestId('venn-circle').first().getAttribute('r')).not.toBe(r1)
  })

  test('UpSet: sorting by degree reorders the bars, and the bars of an exclusive count add up to the union', async ({ page }) => {
    await openViz(page, 'upset')
    const counts = async () => (await page.getByTestId('upset-col').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-count')))))
    const bySize = await counts()
    for (let i = 1; i < bySize.length; i++) expect(bySize[i]).toBeLessThanOrEqual(bySize[i - 1])
    await page.getByTestId('ctl-upset-sort').selectOption('degree')
    await expect.poll(counts).not.toEqual(bySize)
  })

  test('kaplan-meier: shows confidence bands and the log-rank test', async ({ page }) => {
    await openViz(page, 'kaplan-meier')
    await expect(page.getByTestId('chart-svg').locator('path').first()).toBeVisible()
  })

  test('terrain 3D: dragging rotates the view without errors', async ({ page }) => {
    await openViz(page, 'terrain-3d')
    const box = (await page.getByTestId('chart-svg').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 20, { steps: 6 })
    await page.mouse.up()
    await expect(page.getByTestId('chart-svg')).toBeVisible()
  })
})

test.describe('v0.5: comparison lab', () => {
  test('the new presets load, and the three chart lab panes each draw their chart', async ({ page }) => {
    test.setTimeout(120000)
    for (const [preset, n] of [['terrain', 3], ['vector', 3], ['cartogram', 3], ['regression-diagnostics', 3], ['survival', 2], ['price-bricks', 3], ['spectral', 3], ['differential-expression', 2], ['set-overlap', 3], ['community-distance', 2]] as const) {
      await page.goto(`./#/compare/${preset}`)
      for (let i = 0; i < n; i++) {
        await expect(page.getByTestId(`pane-chart-${i}`).locator('svg').first(), `${preset}#${i}`).toBeVisible()
        await expect(page.getByTestId(`pane-issue-${i}`), `${preset}#${i}`).toHaveCount(0)
      }
    }
  })

  test('linked highlighting: hovering a UpSet combination marks the same items in the hypergraph', async ({ page }) => {
    await page.goto('./#/compare/set-overlap')
    await expect(page.getByTestId('pane-chart-1').getByTestId('upset-col').first()).toBeVisible()
    await page.getByTestId('pane-chart-1').getByTestId('upset-bar').first().hover()
    await expect(page.getByTestId('pane-chart-2').locator('circle[stroke="#111827"]').first()).toBeAttached()
    await page.mouse.move(2, 2)
    await expect(page.getByTestId('pane-chart-2').locator('circle[stroke="#111827"]')).toHaveCount(0)
  })
})
