import { expect, openViz, readout, setRange, test } from './fixtures'

test.describe('data system', () => {
  test('switching datasets regenerates the chart and explains incompatible ones', async ({ page }) => {
    await openViz(page, 'histogram')
    await page.getByTestId('tab-data').click()
    const counts = async () => page.locator('.mark-bar').evaluateAll((els) => els.map((e) => e.getAttribute('data-count')).join(','))
    const before = await counts()
    await page.getByTestId('dataset-select').selectOption('uniform')
    await expect(page.locator('.dataset-desc')).toContainText('0부터 100')
    await expect.poll(counts).not.toBe(before)
    // sample size and seed are reproducible controls
    await setRange(page.getByTestId('dataset-size'), 500)
    await expect(readout(page, 'n')).toHaveText('500')
    const seed = await page.getByTestId('seed-value').textContent()
    await page.getByTestId('resample').click()
    await expect(page.getByTestId('seed-value')).not.toHaveText(seed!)
    // a chart with stricter needs lists the datasets it cannot use, with reasons
    await openViz(page, 'scatter')
    await page.getByTestId('tab-data').click()
    await expect(page.locator('.incompat summary')).toContainText('사용할 수 없는 데이터셋')
    await expect(page.getByTestId('dataset-select').locator('option[value="votes"]')).toBeDisabled()
  })

  test('editing a cell updates the chart immediately; invalid input is flagged, not fatal', async ({ page }) => {
    await openViz(page, 'bar')
    await page.getByTestId('tab-data').click()
    const cell = page.getByRole('textbox', { name: '1행 응답 수' })
    await cell.fill('100')
    await cell.press('Enter')
    await expect(page.locator('.bar-label').first()).toHaveText('100')
    await cell.fill('abc')
    await cell.press('Enter')
    await expect(page.getByText('숫자가 아닌 값이 1개')).toBeVisible()
    // the category whose only value is invalid drops out; the chart keeps rendering
    await expect(page.locator('.mark-bar')).toHaveCount(6)
    await page.getByTestId('undo').click()
    await expect(page.locator('.bar-label').first()).toHaveText('100')
    await page.getByTestId('restore-data').click()
    await expect(page.locator('.bar-label').first()).toHaveText('48')
  })

  test('rows can be added and deleted', async ({ page }) => {
    await openViz(page, 'scatter')
    await page.getByTestId('tab-data').click()
    await page.getByTestId('row-add').click()
    await expect(readout(page, 'n')).toHaveText('81')
    await page.getByTestId('row-delete').first().click()
    await page.getByTestId('row-delete').first().click()
    await expect(readout(page, 'n')).toHaveText('79')
  })

  test('mapping columns to roles and reporting missing roles', async ({ page }) => {
    await openViz(page, 'scatter')
    await page.getByTestId('tab-data').click()
    await page.getByTestId('role-x').selectOption('직원 수')
    await expect(page.locator('.axis-label', { hasText: '직원 수' })).toBeVisible()
    await page.getByTestId('role-color').selectOption('')
    await expect(page.locator('.legend-item')).toHaveCount(0)
  })

  test('CSV import and export stay in the browser', async ({ page }) => {
    await openViz(page, 'scatter')
    await page.getByTestId('tab-data').click()
    const csv = '키,몸무게,성별\n170,65,남\n160,52,여\n182,80,남\n155,48,여\n'
    await page.getByTestId('csv-file').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(page.getByTestId('dataset-select')).toHaveValue('custom')
    await expect(page.getByText('4행 × 3열을 불러왔습니다.')).toBeVisible()
    await expect(readout(page, 'n')).toHaveText('4')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('csv-export').click()])
    expect(download.suggestedFilename()).toBe('people.csv')
    // an incompatible file is explained instead of breaking the chart
    await page.getByTestId('csv-file').setInputFiles({ name: 'words.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\nx,y\n') })
    await expect(page.locator('.notice.is-error').first()).toContainText('숫자형')
    await expect(page.getByTestId('lab-canvas').locator('.chart-message')).toBeVisible()
  })

  test('settings and edits persist across reloads; reset restores defaults', async ({ page }) => {
    await openViz(page, 'histogram')
    await setRange(page.getByTestId('ctl-bins'), 25)
    await page.getByTestId('tab-data').click()
    await page.getByRole('textbox', { name: '1행 값', exact: true }).fill('999')
    await page.getByRole('textbox', { name: '1행 값', exact: true }).press('Enter')
    await page.waitForTimeout(400)
    await page.reload()
    await expect(page.getByTestId('lab')).toHaveAttribute('data-viz', 'histogram')
    await expect(page.getByRole('textbox', { name: '1행 값', exact: true })).toHaveValue('999')
    await page.getByTestId('tab-settings').click()
    await expect(page.getByTestId('ctl-bins')).toHaveValue('25')
    await page.getByTestId('reset').click()
    await expect(page.locator('.mark-bar')).toHaveCount(16)
  })

  test('settings panel collapses and the chart takes the space; fullscreen toggles', async ({ page }) => {
    await openViz(page, 'line')
    const w0 = (await page.getByTestId('lab-canvas').boundingBox())!.width
    await page.getByTestId('panel-toggle').click()
    await expect(page.getByTestId('settings-panel')).toBeHidden()
    await expect.poll(async () => (await page.getByTestId('lab-canvas').boundingBox())!.width).toBeGreaterThan(w0 + 200)
    await page.getByTestId('fullscreen').click()
    await expect(page.getByTestId('fullscreen-exit')).toBeVisible()
    await page.getByTestId('fullscreen-exit').click()
    await expect(page.getByTestId('fullscreen')).toHaveAttribute('aria-label', '전체 화면')
  })

  test('keyboard: arrow keys move a selected scatter point', async ({ page }) => {
    await openViz(page, 'scatter')
    const pt = page.locator('circle[data-i="3"]')
    await pt.click()
    await page.waitForTimeout(500)
    const cx = Number(await pt.getAttribute('cx'))
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(600)
    expect(Number(await pt.getAttribute('cx'))).toBeGreaterThan(cx)
  })
})

test('escape cancels a cell edit', async ({ page }) => {
  await openViz(page, 'bar')
  await page.getByTestId('tab-data').click()
  const cell = page.getByRole('textbox', { name: '1행 응답 수' })
  await cell.fill('5')
  await cell.press('Escape')
  await expect(cell).toHaveValue('48')
  await expect(page.locator('.bar-label').first()).toHaveText('48')
  await expect(page.getByTestId('undo')).toBeDisabled()
})
