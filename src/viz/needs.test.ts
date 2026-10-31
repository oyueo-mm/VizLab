import { beforeAll, describe, expect, it } from 'vitest'
import { generateDataset } from '../data/datasets'
import { catalog } from './catalog'
import { loadAllModules } from './charts'
import { incompatibility, incompatibilityFromSlots, slotsOf } from './mapping'
import { needs } from './needs'
import type { VizModule } from './types'

let modules: Record<string, VizModule>
beforeAll(async () => { modules = await loadAllModules() })

const short = (slot: string[]) => `[${slot.map((t) => `'${t}'`).join(', ')}]`

function render(table: Record<string, string[][]>) {
  const lines = Object.entries(table).map(([id, slots]) => `  '${id}': [${slots.map(short).join(', ')}],`)
  return `import type { Slot } from './mapping'

/**
 * Required column slots of every chart (which column types can fill each required role), kept apart from the chart modules so the
 * comparison lab can tell which charts fit the shared table before any chart code is loaded. A test compares this table with the roles
 * of every module and fails when they drift; regenerate it with \`UPDATE_NEEDS=1 npx vitest run src/viz/needs.test.ts\`.
 */
export const needs: Record<string, Slot[]> = {
${lines.join('\n')}
}
`
}

describe('static slot table (pre-load compatibility)', () => {
  it('matches the required roles of every chart module', async () => {
    const actual = Object.fromEntries(catalog.map((c) => [c.id, slotsOf(modules[c.id].roles)]))
    // Regeneration (UPDATE_NEEDS=1) writes the table next to this test; node modules are loaded dynamically because the app's tsconfig has no node types.
    if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.UPDATE_NEEDS) {
      const fsName = 'node:fs'
      const fs = (await import(/* @vite-ignore */ fsName)) as { writeFileSync: (path: string, text: string) => void }
      fs.writeFileSync(decodeURIComponent(new URL('./needs.ts', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), render(actual))
    }
    expect(Object.keys(needs).sort()).toEqual(catalog.map((c) => c.id).sort())
    expect(needs).toEqual(actual)
  })

  it('gives the same verdict as the module-based check for every chart and several datasets', () => {
    for (const d of ['votes', 'normal', 'network', 'kr-regions', 'paired', 'projects', 'scores'] as const) {
      const t = generateDataset(d, 7)
      for (const c of catalog) expect(incompatibilityFromSlots(needs[c.id], t), `${c.id} × ${d}`).toBe(incompatibility(modules[c.id].roles, t))
    }
  })
})
