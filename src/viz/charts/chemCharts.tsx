import * as d3 from 'd3'
import { useMemo, useState } from 'react'
import { ChartMessage } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, type DataTable } from '../../data/table'
import { fmt } from '../../lib/format'
import { angle, cellVolume, crystalDensity, detectBonds, dihedral, elementOf, formula, latticeVectors, molarMass, nearestNeighbours, supercell, toCartesian, type Atom, type Cell, type CrystalAtom, type V3 } from '../../stats/chem'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'
import { ViewControls, type ViewParams } from './geo3dCharts'
import { Scene3D } from './kit3d'

/** Molecular graphs and crystal lattices drawn as sorted SVG spheres and bonds on the orbit camera. */


/** Small x / y / z axis triad in the lower-left corner that follows the camera. */
function Triad({ proj, height }: { proj: (p: V3) => { x: number; y: number }; height: number }) {
  const o = proj([0, 0, 0])
  const axes: [string, V3, string][] = [['x', [1, 0, 0], '#e03131'], ['y', [0, 1, 0], '#2f9e44'], ['z', [0, 0, 1], '#1c7ed6']]
  return (
    <g transform={`translate(46,${height - 54})`} pointerEvents="none" aria-hidden="true">
      {axes.map(([n, v, c]) => { const q = proj(v); const dx = (q.x - o.x) * 0.1, dy = (q.y - o.y) * 0.1; const l = Math.hypot(dx, dy) || 1, k = 26 / l; return <g key={n}><line x1={0} y1={0} x2={dx * k} y2={dy * k} stroke={c} strokeWidth={2} /><text x={dx * k * 1.25} y={dy * k * 1.25} dy="0.35em" textAnchor="middle" fontSize={11} fill={c}>{n}</text></g> })}
    </g>
  )
}

function Defs({ colors, id }: { colors: string[]; id: string }) {
  return (
    <defs>
      {colors.map((c) => (
        <radialGradient key={c} id={`${id}-${c.replace('#', '')}`} cx="35%" cy="32%" r="75%">
          <stop offset="0%" stopColor={d3.color(c)!.brighter(1.1).formatHex()} /><stop offset="60%" stopColor={c} /><stop offset="100%" stopColor={d3.color(c)!.darker(1.1).formatHex()} />
        </radialGradient>
      ))}
    </defs>
  )
}

// ─── molecule viewer ────────────────────────────────────────────────────────────────

export interface MoleculeParams extends ViewParams { style: 'ball' | 'space' | 'stick'; labels: boolean; selected: number[] }
const molRoles: RoleSpec[] = [
  { key: 'el', label: '원소 기호', type: 'category', required: true, prefer: '원소|element' },
  { key: 'x', label: 'x (Å)', type: 'number', required: true, prefer: '^x' }, { key: 'y', label: 'y (Å)', type: 'number', required: true, prefer: '^y' }, { key: 'z', label: 'z (Å)', type: 'number', required: true, prefer: '^z' },
]

function readAtoms(table: DataTable, mapping: Mapping): Atom[] {
  const ei = columnIndex(table, roleColumn(mapping, 'el')), xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), zi = columnIndex(table, roleColumn(mapping, 'z'))
  const out: Atom[] = []
  if (ei < 0 || xi < 0 || yi < 0 || zi < 0) return out
  for (const r of table.rows) { const x = toNumber(r[xi]), y = toNumber(r[yi]), z = toNumber(r[zi]); const el = toLabel(r[ei]).trim(); if (x != null && y != null && z != null && el) out.push({ el, pos: [x, y, z] }) }
  return out
}

function MoleculeChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<MoleculeParams>) {
  const atoms = useMemo(() => readAtoms(table, mapping), [table, mapping])
  const bonds = useMemo(() => detectBonds(atoms), [atoms])
  const [hover, setHover] = useState<number | null>(null)
  if (atoms.length < 2) return <ChartMessage>원소 기호와 x, y, z(Å) 열을 선택하세요. 원자가 2개 이상 필요합니다.</ChartMessage>
  const c: V3 = [0, 1, 2].map((k) => d3.mean(atoms, (a) => a.pos[k])!) as V3
  const R = Math.max(1.5, ...atoms.map((a) => Math.hypot(a.pos[0] - c[0], a.pos[1] - c[1], a.pos[2] - c[2]) + elementOf(a.el).vdw))
  const s = 1 / R
  const norm = (p: V3): V3 => [(p[0] - c[0]) * s, (p[1] - c[1]) * s, (p[2] - c[2]) * s]
  const sel = params.selected.filter((i) => i < atoms.length)
  const toggle = (i: number) => setParams({ selected: sel.includes(i) ? sel.filter((k) => k !== i) : [...sel.slice(-3), i] })
  const info = (() => {
    const p = sel.map((i) => atoms[i].pos)
    if (p.length === 2) return { label: '결합 거리', value: `${fmt(Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1], p[0][2] - p[1][2]), 3)} Å` }
    if (p.length === 3) return { label: '결합각', value: `${fmt(angle(p[0], p[1], p[2]), 1)}°` }
    if (p.length === 4) return { label: '이면각', value: `${fmt(dihedral(p[0], p[1], p[2], p[3]), 1)}°` }
    return null
  })()
  const mass = molarMass(atoms)
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`분자 구조: ${formula(atoms)}`} draw={() => {}} drawKey="mol" fit={0.4} frame={false}
      readout={[{ label: '화학식', value: formula(atoms) }, { label: '몰질량', value: `${fmt(mass, 2)} g/mol` }, { label: '원자 / 결합', value: `${atoms.length} / ${bonds.length}` }, ...(info ? [info] : [])]}
      note={sel.length ? `선택한 원자 ${sel.map((i) => `${atoms[i].el}${i + 1}`).join(' – ')} (원자를 누르면 선택, 최대 4개)` : '원자를 차례로 눌러 거리(2개)·결합각(3개)·이면각(4개)을 잽니다'}
      overlay={(proj, stage) => {
        const P = atoms.map((a) => proj(norm(a.pos)))
        const px = Math.min(width, height) * 0.4 * params.zoom
        const rOf = (a: Atom) => (params.style === 'space' ? elementOf(a.el).vdw : params.style === 'ball' ? elementOf(a.el).vdw * 0.36 : 0.16) * s * px
        const items = [...atoms.map((_, i) => ({ kind: 'atom' as const, i, depth: P[i].depth })), ...bonds.map((b, k) => ({ kind: 'bond' as const, k, depth: (P[b.a].depth + P[b.b].depth) / 2 }))].sort((a, b) => b.depth - a.depth)
        const colors = [...new Set(atoms.map((a) => elementOf(a.el).color))]
        return (
          <g>
            <Defs colors={colors} id="mol" />
            {!compact && <Triad proj={proj} height={height} />}
            {items.map((it) => {
              if (it.kind === 'bond') {
                const b = bonds[it.k], pa = P[b.a], pb = P[b.b]
                const w = (params.style === 'space' ? 0 : params.style === 'stick' ? 0.2 : 0.11) * s * px * 2
                return w > 0 ? <line key={`b${it.k}`} data-testid="mol-bond" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#9ca3af" strokeWidth={Math.max(2, w)} strokeLinecap="round" onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>{atoms[b.a].el}{b.a + 1}–{atoms[b.b].el}{b.b + 1}</b><br />결합 길이 {fmt(b.length, 3)} Å</>)} /> : null
              }
              const a = atoms[it.i], el = elementOf(a.el), on = sel.includes(it.i)
              return (
                <g key={`a${it.i}`} transform={`translate(${P[it.i].x},${P[it.i].y})`} style={{ cursor: compact ? undefined : 'pointer' }} data-testid="mol-atom" onClick={compact ? undefined : () => toggle(it.i)} onPointerEnter={() => setHover(it.i)} onPointerLeave={() => setHover(null)}>
                  <circle r={Math.max(3, rOf(a))} fill={`url(#mol-${el.color.replace('#', '')})`} stroke={on ? '#111827' : hover === it.i ? '#2a8c82' : 'rgba(0,0,0,.25)'} strokeWidth={on ? 3 : 1} />
                  {!compact && params.labels && rOf(a) > 6 && <text y={4} textAnchor="middle" fontSize={Math.max(9, Math.min(15, rOf(a) * 0.9))} fill={d3.hsl(el.color).l > 0.6 ? '#111827' : '#ffffff'} pointerEvents="none">{a.el}</text>}
                  {on && <text y={-Math.max(3, rOf(a)) - 4} textAnchor="middle" fontSize={11} fill="#111827" fontWeight={700}>{sel.indexOf(it.i) + 1}</text>}
                </g>
              )
            })}
          </g>
        )
      }} />
  )
}

function MoleculeControls({ params, setParams }: ControlsProps<MoleculeParams>) {
  return (
    <>
      <ControlGroup title="표현">
        <Segmented label="모형" value={params.style} onChange={(style) => setParams({ style })} testId="ctl-style" options={[{ value: 'ball', label: '공-막대' }, { value: 'space', label: '공간 채움' }, { value: 'stick', label: '막대' }]} />
        <Toggle label="원소 기호 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: [] })} data-testid="mol-clear">선택 해제</button>
        <Hint>표의 원자 좌표(Å)에서 공유결합을 ‘두 원자 사이의 거리 &lt; 1.2 × (공유 반지름 합)’이라는 규칙으로 찾아 분자 그래프를 만듭니다. 원자를 누르면 번호가 매겨져 2개는 결합 거리, 3개는 결합각, 4개는 이면각을 계산합니다. 공간 채움 모형은 반데르발스 반지름으로 분자가 차지하는 부피를 보여 줍니다. 결합 차수(이중·삼중 결합)는 좌표만으로는 판단하지 않고 단일선으로 그립니다. 예시는 표준 결합 길이·각으로 만든 근사 구조입니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const moleculeModule: VizModule<MoleculeParams> = {
  roles: molRoles, datasets: ['mol-water', 'mol-ammonia', 'mol-methane', 'mol-ethene', 'mol-benzene', 'mol-ethane', 'mol-co2'], defaultParams: { yaw: -30, pitch: 28, zoom: 1.5, style: 'ball', labels: true, selected: [] },
  Chart: MoleculeChart, Controls: MoleculeControls, hint: '끌어서 회전 · 원자를 차례로 눌러 결합 길이·결합각·이면각을 재세요 · 표의 좌표를 고치면 결합이 다시 계산됩니다',
}

// ─── crystal lattice ────────────────────────────────────────────────────────────────

export interface CrystalParams extends ViewParams { cells: number; bonds: boolean; radius: number; box: boolean }
const crystalRoles: RoleSpec[] = [
  { key: 'el', label: '원소', type: 'category', required: true, prefer: '원소|element' },
  { key: 'u', label: '분율 좌표 u', type: 'number', required: true, prefer: '분율 u|^u' }, { key: 'v', label: '분율 좌표 v', type: 'number', required: true, prefer: '분율 v|^v' }, { key: 'w', label: '분율 좌표 w', type: 'number', required: true, prefer: '분율 w|^w' },
  { key: 'cell', label: '격자 상수 a, b, c, α, β, γ', type: 'number', required: true, multiple: { min: 6, max: 6 } },
]

function readCrystal(table: DataTable, mapping: Mapping): { basis: CrystalAtom[]; cell: Cell } | null {
  const ei = columnIndex(table, roleColumn(mapping, 'el')), ui = columnIndex(table, roleColumn(mapping, 'u')), vi = columnIndex(table, roleColumn(mapping, 'v')), wi = columnIndex(table, roleColumn(mapping, 'w'))
  const ci = roleColumns(mapping, 'cell').map((n) => columnIndex(table, n))
  if ([ei, ui, vi, wi].some((i) => i < 0) || ci.length < 6 || ci.some((i) => i < 0)) return null
  const basis: CrystalAtom[] = []
  let cell: Cell | null = null
  for (const r of table.rows) {
    const f = [ui, vi, wi].map((i) => toNumber(r[i])), el = toLabel(r[ei]).trim()
    if (f.some((x) => x == null) || !el) continue
    basis.push({ el, frac: f as V3 })
    if (!cell) { const c = ci.map((i) => toNumber(r[i])); if (c.every((x) => x != null && x > 0)) cell = { a: c[0]!, b: c[1]!, c: c[2]!, alpha: c[3]!, beta: c[4]!, gamma: c[5]! } }
  }
  return basis.length && cell && cell.alpha < 180 && cell.beta < 180 && cell.gamma < 180 ? { basis, cell } : null
}

function CrystalChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<CrystalParams>) {
  const data = useMemo(() => readCrystal(table, mapping), [table, mapping])
  const atoms = useMemo(() => (data ? supercell(data.basis, data.cell, [params.cells, params.cells, params.cells]) : []), [data, params.cells])
  const nn = useMemo(() => (data ? nearestNeighbours(data.basis, data.cell, 0) : null), [data])
  const bonds = useMemo(() => {
    if (!nn || !params.bonds || atoms.length > 700) return []
    const cut = nn.distance * 1.05, out: [number, number][] = []
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) if (Math.hypot(atoms[i].pos[0] - atoms[j].pos[0], atoms[i].pos[1] - atoms[j].pos[1], atoms[i].pos[2] - atoms[j].pos[2]) < cut) out.push([i, j])
    return out
  }, [atoms, nn, params.bonds])
  if (!data || !nn) return <ChartMessage>원소, 분율 좌표 u·v·w, 격자 상수 6개(a, b, c, α, β, γ) 열을 고르세요. 각도는 0°보다 크고 180°보다 작아야 합니다.</ChartMessage>
  const L = latticeVectors(data.cell)
  const c: V3 = [0, 1, 2].map((k) => d3.mean(atoms, (a) => a.pos[k])!) as V3
  const R = Math.max(2, ...atoms.map((a) => Math.hypot(a.pos[0] - c[0], a.pos[1] - c[1], a.pos[2] - c[2]))) + 1.2
  const s = 1 / R
  const norm = (p: V3): V3 => [(p[0] - c[0]) * s, (p[1] - c[1]) * s, (p[2] - c[2]) * s]
  const V = cellVolume(data.cell), rho = crystalDensity(data.basis, data.cell)
  const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((f) => toCartesian(f as V3, L))
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  const els = [...new Set(data.basis.map((b) => b.el))]
  return (
    <Scene3D width={width} height={height} compact={compact} params={params} setParams={setParams} label={`결정 구조: 원자 ${atoms.length}개`} draw={() => {}} drawKey="cry" fit={0.4} frame={false}
      readout={[{ label: '단위포 부피', value: `${fmt(V, 2)} Å³` }, { label: '밀도', value: `${fmt(rho, 2)} g/cm³` }, { label: '최근접 거리', value: `${fmt(nn.distance, 3)} Å` }, { label: '배위수', value: nn.count }]}
      note={`${els.join('·')} · 단위포 원자 ${data.basis.length}개 · ${params.cells}×${params.cells}×${params.cells} 초격자`}
      overlay={(proj, stage) => {
        const P = atoms.map((a) => proj(norm(a.pos)))
        const px = Math.min(width, height) * 0.4 * params.zoom
        const items = [...atoms.map((_, i) => ({ kind: 'atom' as const, i, depth: P[i].depth })), ...bonds.map(([a, b], k) => ({ kind: 'bond' as const, k, a, b, depth: (P[a].depth + P[b].depth) / 2 }))].sort((a, b) => b.depth - a.depth)
        const colors = [...new Set(atoms.map((a) => elementOf(a.el).color))]
        return (
          <g>
            <Defs colors={colors} id="cry" />
            {!compact && <Triad proj={proj} height={height} />}
            {params.box && edges.map(([a, b], i) => { const pa = proj(norm(corners[a])), pb = proj(norm(corners[b])); return <line key={`e${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#111827" strokeWidth={1.4} strokeDasharray="5 3" pointerEvents="none" /> })}
            {items.map((it) => it.kind === 'bond'
              ? <line key={`b${it.k}`} x1={P[it.a].x} y1={P[it.a].y} x2={P[it.b].x} y2={P[it.b].y} stroke="#b6bdc4" strokeWidth={Math.max(1.5, 0.07 * s * px * 2)} strokeLinecap="round" />
              : (() => {
                const a = atoms[it.i], el = elementOf(a.el)
                return <circle key={`a${it.i}`} data-testid="crystal-atom" cx={P[it.i].x} cy={P[it.i].y} r={Math.max(2.5, el.cov * 0.55 * params.radius * s * px)} fill={`url(#cry-${el.color.replace('#', '')})`} stroke="rgba(0,0,0,.25)"
                  onPointerEnter={compact ? undefined : (e) => stage.at(e, <><b>{a.el}</b><br />({fmt(a.pos[0], 2)}, {fmt(a.pos[1], 2)}, {fmt(a.pos[2], 2)}) Å</>)} />
              })())}
          </g>
        )
      }} />
  )
}

function CrystalControls({ params, setParams }: ControlsProps<CrystalParams>) {
  return (
    <>
      <ControlGroup title="결정">
        <Slider label="초격자 크기 (단위포 수/축)" value={params.cells} min={1} max={3} onChange={(cells) => setParams({ cells })} testId="ctl-cells" />
        <Slider label="원자 크기" value={params.radius} min={0.4} max={1.6} step={0.05} onChange={(radius) => setParams({ radius })} testId="ctl-radius" />
        <Toggle label="최근접 결합 표시" checked={params.bonds} onChange={(bonds) => setParams({ bonds })} />
        <Toggle label="단위포 상자" checked={params.box} onChange={(box) => setParams({ box })} />
        <Hint>격자 상수(a, b, c, α, β, γ)로 격자 벡터를 만들고, 단위포 안 원자의 분율 좌표 (u, v, w)를 데카르트 좌표로 바꿔 초격자를 만듭니다. 단위포 부피는 abc√(1 − cos²α − cos²β − cos²γ + 2cosα cosβ cosγ), 밀도는 단위포 안 원자의 질량 합을 부피와 아보가드로 수로 나눠 계산하므로 NaCl은 2.16, Cu는 8.93 g/cm³처럼 알려진 값과 맞습니다. 배위수는 가장 가까운 거리의 1.05배 안에 있는 이웃 수입니다. 결합은 이온·금속 결정에서는 화학 결합이 아니라 이웃 관계를 보이는 선입니다.</Hint>
      </ControlGroup>
      <ViewControls params={params} setParams={setParams} />
    </>
  )
}

export const crystalModule: VizModule<CrystalParams> = {
  roles: crystalRoles, datasets: ['crystal-nacl', 'crystal-cu', 'crystal-fe', 'crystal-diamond', 'crystal-cscl', 'crystal-mg'], defaultParams: { yaw: -35, pitch: 25, zoom: 1.05, cells: 2, bonds: true, radius: 1, box: true },
  Chart: CrystalChart, Controls: CrystalControls, hint: '끌어서 회전 · 구조를 바꿔 배위수와 밀도를 비교하세요 · 격자 상수를 고치면 밀도와 부피가 다시 계산됩니다',
}

