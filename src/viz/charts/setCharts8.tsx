import * as d3 from 'd3'
import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Slider, Toggle } from '../../components/controls'
import { columnIndex, toLabel, toNumber, updateRow, type DataTable } from '../../data/table'
import { categoryColor } from '../../lib/colors'
import { bubbleSet, defaultBubble, defaultKelp, kelp, lineSets, radialSets, rainbowBoxes, type Pt, type SetRegion } from '../../stats/sets8'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec, VizModule } from '../types'

// ───────────────────────────── shared: points with set membership ─────────────────────────────

interface PointSets {
  setNames: string[]
  setCols: string[]
  xCol: string
  yCol: string
  /** Table row of every point. */
  rows: number[]
  names: string[]
  data: Pt[]
  member: boolean[][]
}

const pointRoles = (): RoleSpec[] => [
  { key: 'label', label: '이름', type: 'category', auto: true },
  { key: 'x', label: 'x 좌표', type: 'number', required: true, prefer: 'x' },
  { key: 'y', label: 'y 좌표', type: 'number', required: true, prefer: 'y' },
  { key: 'sets', label: '집합 (0/1 소속 열)', type: 'number', required: true, multiple: { min: 2, max: 8 } },
]

function readPointSets(table: DataTable, mapping: Mapping): PointSets | null {
  const xCol = roleColumn(mapping, 'x'), yCol = roleColumn(mapping, 'y')
  const setCols = roleColumns(mapping, 'sets')
  const lab = columnIndex(table, roleColumn(mapping, 'label'))
  const xi = columnIndex(table, xCol), yi = columnIndex(table, yCol)
  const si = setCols.map((c) => columnIndex(table, c))
  if (xi < 0 || yi < 0 || si.length < 2 || si.some((i) => i < 0)) return null
  const rows: number[] = [], names: string[] = [], data: Pt[] = []
  table.rows.forEach((r, i) => {
    const x = toNumber(r[xi]), y = toNumber(r[yi])
    if (x == null || y == null) return
    rows.push(i)
    names.push(lab >= 0 ? toLabel(r[lab]) : `점 ${i + 1}`)
    data.push([x, y])
  })
  const member = si.map((c) => rows.map((i) => (toNumber(table.rows[i][c]) ?? 0) > 0))
  return { setNames: setCols, setCols, xCol: xCol!, yCol: yCol!, rows, names, data, member }
}

interface EditParams { mode: 'move' | 'member'; editSet: number; focusSet: number }

function usePointScene(table: DataTable, mapping: Mapping, width: number, height: number, compact: boolean | undefined) {
  const ps = useMemo(() => readPointSets(table, mapping), [table, mapping])
  const lock = useRef<{ x: [number, number]; y: [number, number] } | null>(null)
  if (!ps || ps.data.length < 2) return null
  const pad = compact ? 8 : 30
  const ext = (k: 0 | 1) => {
    const [a, b] = d3.extent(ps.data, (p) => p[k]) as [number, number]
    const m = (b - a || 1) * 0.04
    return [a - m, b + m] as [number, number]
  }
  const dom = lock.current ?? { x: ext(0), y: ext(1) }
  const sx = d3.scaleLinear().domain(dom.x).range([pad, width - pad])
  const sy = d3.scaleLinear().domain(dom.y).range([height - pad, pad])
  const px: Pt[] = ps.data.map((p) => [sx(p[0]), sy(p[1])])
  return { ps, sx, sy, px, lock, dom }
}

const smoothLine = d3.line<Pt>().curve(d3.curveCatmullRomClosed.alpha(0.5))
const ringsPath = (rings: Pt[][]) => rings.map((r) => smoothLine(r) ?? '').join('')

type Scene = NonNullable<ReturnType<typeof usePointScene>>

/** Dragging a point or flipping its membership; `svgProps` go on the svg element because pointer capture sends the events there. */
function usePointEdit(scene: Scene | null, params: EditParams, table: DataTable, svgRef: React.RefObject<SVGSVGElement | null>, compact: boolean | undefined, onTableChange: ChartProps<unknown>['onTableChange'], hide: () => void) {
  const drag = useRef<{ i: number; moved: boolean } | null>(null)
  const editable = !!onTableChange && !compact && !!scene
  const down = (i: number, e: PointerEvent<SVGGElement>) => {
    if (!editable || !scene) return
    if (params.mode === 'member') {
      const s = Math.min(params.editSet, scene.ps.setCols.length - 1)
      onTableChange!(updateRow(table, scene.ps.rows[i], { [scene.ps.setCols[s]]: scene.ps.member[s][i] ? 0 : 1 }))
      return
    }
    svgRef.current!.setPointerCapture(e.pointerId)
    drag.current = { i, moved: false }
    scene.lock.current = scene.dom
    hide()
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || !scene) return
    d.moved = true
    const p = localPoint(svgRef.current!, e)
    onTableChange!(updateRow(table, scene.ps.rows[d.i], { [scene.ps.xCol]: Math.round(scene.sx.invert(p.x) * 10) / 10, [scene.ps.yCol]: Math.round(scene.sy.invert(p.y) * 10) / 10 }), true)
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (scene) scene.lock.current = null
    if (d?.moved) onTableChange!(table, false)
  }
  return { down, editable, svgProps: { onPointerMove, onPointerUp, onPointerCancel: onPointerUp } }
}

/** Points drawn as donuts divided among the sets they belong to. */
function PointLayer({ ps, px, color, params, compact, linked, show, hide, svgRef, down, editable }: {
  ps: PointSets; px: Pt[]; color: (s: string) => string; params: EditParams; compact?: boolean; linked: ChartProps<unknown>['linked']
  show: (x: number, y: number, c: ReactNode) => void; hide: () => void; svgRef: React.RefObject<SVGSVGElement | null>
  down: (i: number, e: PointerEvent<SVGGElement>) => void; editable: boolean
}) {
  const marked = new Set(linked?.rows ?? [])
  const arc = d3.arc<{ a0: number; a1: number }>().innerRadius(compact ? 2 : 3.2).outerRadius(compact ? 4.2 : 6.4).startAngle((d) => d.a0).endAngle((d) => d.a1)
  return (
    <g>
      {ps.data.map((_, i) => {
        const inSets = ps.member.map((m, s) => (m[i] ? s : -1)).filter((s) => s >= 0)
        const dimmed = params.focusSet >= 0 && !inSets.includes(params.focusSet)
        const hot = marked.has(ps.rows[i])
        return (
          <g key={i} data-testid="set-point" transform={`translate(${px[i][0]},${px[i][1]})`} opacity={dimmed ? 0.25 : 1} style={{ cursor: editable ? (params.mode === 'move' ? 'grab' : 'pointer') : undefined }}
            onPointerDown={(e) => down(i, e)}
            onPointerEnter={compact ? undefined : (e) => {
              linked?.set([ps.rows[i]])
              const lp = localPoint(svgRef.current!, e)
              show(lp.x, lp.y, <><b>{ps.names[i]}</b><br />{inSets.length ? inSets.map((s) => ps.setNames[s]).join(' · ') : '어느 집합에도 속하지 않음'}<br />({ps.data[i][0]}, {ps.data[i][1]})</>)
            }}
            onPointerLeave={() => { hide(); linked?.set(null) }}>
            <circle r={compact ? 4.4 : 9} fill="transparent" />
            {inSets.length === 0 && <circle r={compact ? 2.2 : 3.4} fill="#fff" stroke="#8a929b" strokeWidth={1.2} />}
            {inSets.map((s, k) => <path key={s} d={arc({ a0: (k / inSets.length) * 2 * Math.PI, a1: ((k + 1) / inSets.length) * 2 * Math.PI }) ?? ''} fill={color(ps.setNames[s])} stroke="#fff" strokeWidth={0.6} />)}
            {hot && <circle r={compact ? 7 : 10} fill="none" stroke="#111" strokeWidth={1.6} data-testid="set-point-linked" />}
          </g>
        )
      })}
    </g>
  )
}

function EditControls({ params, setParams, sets, extra }: { params: EditParams; setParams: (p: Partial<EditParams>) => void; sets: string[]; extra?: ReactNode }) {
  return (
    <ControlGroup title="편집·강조">
      <Segmented label="점을 누르면" value={params.mode} onChange={(mode) => setParams({ mode })} options={[{ value: 'move', label: '끌어서 이동' }, { value: 'member', label: '소속 바꾸기' }]} testId="ctl-mode" />
      {params.mode === 'member' && (
        <Segmented label="바꿀 집합" value={String(params.editSet)} onChange={(v) => setParams({ editSet: Number(v) })} options={sets.map((s, i) => ({ value: String(i), label: s }))} testId="ctl-edit-set" />
      )}
      <Segmented label="강조할 집합" value={String(params.focusSet)} onChange={(v) => setParams({ focusSet: Number(v) })} options={[{ value: '-1', label: '모두' }, ...sets.map((s, i) => ({ value: String(i), label: s }))]} testId="ctl-focus" />
      {extra}
    </ControlGroup>
  )
}

const FILL_OPACITY = 0.18

function RegionPaths({ regions, color, setNames, focusSet, compact, showLinks }: { regions: SetRegion[]; color: (s: string) => string; setNames: string[]; focusSet: number; compact?: boolean; showLinks?: boolean }) {
  return (
    <g>
      {regions.map((r, s) => {
        const dim = focusSet >= 0 && focusSet !== s
        return (
          <g key={s} opacity={dim ? 0.15 : 1}>
            <path d={ringsPath(r.rings)} fill={color(setNames[s])} fillOpacity={FILL_OPACITY} stroke={color(setNames[s])} strokeWidth={compact ? 1 : 1.8} fillRule="evenodd" data-testid="set-region" />
            {showLinks && r.links.map((l, k) => <path key={k} d={`M${l.map((p) => p.join(',')).join('L')}`} fill="none" stroke={color(setNames[s])} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />)}
          </g>
        )
      })}
    </g>
  )
}

function SceneLegend({ setNames, regions, color }: { setNames: string[]; regions?: SetRegion[]; color: (s: string) => string }) {
  return (
    <g transform="translate(10,12)">
      {setNames.map((s, i) => (
        <g key={s} transform={`translate(${0},${i * 16})`}>
          <rect width={10} height={10} y={-9} fill={color(s)} fillOpacity={0.7} />
          <text x={15} className="radar-level" dy="0.1em">{s}{regions ? ` (${regions[i].members}${regions[i].leakedOthers ? ` · 타 점 ${regions[i].leakedOthers}` : ''})` : ''}</text>
        </g>
      ))}
    </g>
  )
}

interface RegionChartArgs extends ChartProps<EditParams & Record<string, unknown>> { compute: (px: Pt[], member: boolean[][], w: number, h: number, compact: boolean | undefined) => { regions: SetRegion[] }; label: string; showLinks?: boolean }

function RegionChart({ table, mapping, params, width, height, compact, linked, onTableChange, compute, label, showLinks }: RegionChartArgs) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const scene = usePointScene(table, mapping, width, height, compact)
  const regions = useMemo(() => (scene ? compute(scene.px, scene.ps.member, width, height, compact).regions : []), [scene?.px.map((p) => p.join()).join('|'), scene?.ps.member, width, height, compact, compute]) // eslint-disable-line react-hooks/exhaustive-deps
  const edit = usePointEdit(scene, params, table, svgRef, compact, onTableChange, hide)
  if (!scene) return <ChartMessage>x·y 좌표와 집합 열(0/1 소속) 2개 이상을 선택하세요.</ChartMessage>
  const { ps, px } = scene
  const color = categoryColor(ps.setNames)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" style={{ touchAction: 'none' }} {...edit.svgProps}
        aria-label={`${label}: 점 ${ps.data.length}개, 집합 ${ps.setNames.length}개 (${regions.map((r, i) => `${ps.setNames[i]} ${r.members}개`).join(', ')})`}>
        <RegionPaths regions={regions} color={color} setNames={ps.setNames} focusSet={params.focusSet} compact={compact} showLinks={showLinks && !compact && !!(params as { showLinks?: boolean }).showLinks} />
        <PointLayer ps={ps} px={px} color={color} params={params} svgRef={svgRef} compact={compact} linked={linked} show={show} hide={hide} down={edit.down} editable={edit.editable} />
        {!compact && <SceneLegend setNames={ps.setNames} regions={regions} color={color} />}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

const editDefaults: EditParams = { mode: 'move', editSet: 0, focusSet: -1 }
const setsOf = (mapping: Mapping) => roleColumns(mapping, 'sets')

// ───────────────────────────── Bubble Sets ─────────────────────────────

export interface BubbleParams extends EditParams { r0: number; r1: number; avoid: number; edgeWeight: number; showLinks: boolean }

const computeBubble = (p: BubbleParams) => (px: Pt[], member: boolean[][], w: number, h: number, compact: boolean | undefined) => {
  const cell = compact ? 8 : 5
  const regions = member.map((m) => bubbleSet(px, m, w, h, { ...defaultBubble, r0: p.r0, r1: p.r1, avoid: p.avoid, edgeWeight: p.edgeWeight, cell: compact ? cell : cell }))
  return { regions }
}

function BubbleChart(props: ChartProps<BubbleParams>) {
  const { params } = props
  const compute = useMemo(() => computeBubble(params), [params.r0, params.r1, params.avoid, params.edgeWeight]) // eslint-disable-line react-hooks/exhaustive-deps
  return <RegionChart {...(props as unknown as RegionChartArgs)} compute={compute} label="Bubble Sets" showLinks />
}

function BubbleControls({ params, setParams, mapping }: ControlsProps<BubbleParams>) {
  return (
    <>
      <ControlGroup title="윤곽 생성 (에너지 장)">
        <Slider label="항목 반지름 r₀ (px)" value={params.r0} min={6} max={26} onChange={(r0) => setParams({ r0, r1: Math.max(params.r1, r0 + 8) })} testId="ctl-r0" />
        <Slider label="영향 반경 r₁ — 윤곽의 부드러움 (px)" value={params.r1} min={20} max={90} onChange={(r1) => setParams({ r1: Math.max(r1, params.r0 + 8) })} testId="ctl-r1" />
        <Slider label="외부 개체 회피 (비소속 점의 음의 에너지)" value={params.avoid} min={0} max={1.6} step={0.05} onChange={(avoid) => setParams({ avoid })} format={(v) => v.toFixed(2)} testId="ctl-avoid" />
        <Slider label="가상 간선 에너지 (1 이상이면 소속 점이 이어짐)" value={params.edgeWeight} min={0} max={1.6} step={0.05} onChange={(edgeWeight) => setParams({ edgeWeight })} format={(v) => v.toFixed(2)} testId="ctl-edge" />
        <Toggle label="가상 간선(점선) 표시" checked={params.showLinks} onChange={(showLinks) => setParams({ showLinks })} testId="ctl-links" />
        <Hint>소속 점은 양의 에너지를, 비소속 점은 음의 에너지를 주고, 소속 점을 잇는 가상 간선(비소속 점을 돌아가는 최소 신장 트리)이 떨어진 점 사이를 이어 줍니다. 에너지가 문턱(1)이 되는 등치선이 영역의 경계입니다. 범례의 ‘타 점’은 영역 안에 들어간 비소속 점의 수입니다.</Hint>
      </ControlGroup>
      <EditControls params={params} setParams={setParams as never} sets={setsOf(mapping)} />
    </>
  )
}

export const bubbleSetsModule: VizModule<BubbleParams> = {
  roles: pointRoles(),
  datasets: ['set-points'],
  defaultParams: { ...editDefaults, r0: 12, r1: 40, avoid: 0.8, edgeWeight: 1, showLinks: false },
  Chart: BubbleChart,
  Controls: BubbleControls,
  hint: '점을 끌면 영역이 다시 계산됩니다 · ‘소속 바꾸기’ 모드에서 점을 눌러 집합 소속을 바꿉니다',
}

// ───────────────────────────── Kelp Diagram ─────────────────────────────

export interface KelpParams extends EditParams { radius: number; waist: number; fusion: number; avoid: number }

function KelpChart(props: ChartProps<KelpParams>) {
  const { params } = props
  const compute = useMemo(() => (px: Pt[], member: boolean[][], w: number, h: number, compact: boolean | undefined) => ({
    regions: member.map((m) => kelp(px, m, w, h, { ...defaultKelp, radius: params.radius, waist: params.waist, fusion: params.fusion, avoid: params.avoid, cell: compact ? 8 : 5 })),
  }), [params.radius, params.waist, params.fusion, params.avoid])
  return <RegionChart {...(props as unknown as RegionChartArgs)} compute={compute} label="Kelp Diagram" />
}

function KelpControls({ params, setParams, mapping }: ControlsProps<KelpParams>) {
  return (
    <>
      <ControlGroup title="켈프 구조">
        <Slider label="항목 둘레 반지름 (px)" value={params.radius} min={8} max={30} onChange={(radius) => setParams({ radius })} testId="ctl-radius" />
        <Slider label="연결 부위 굵기 (0 = 실처럼 가늘게)" value={params.waist} min={0} max={1} step={0.05} onChange={(waist) => setParams({ waist })} format={(v) => v.toFixed(2)} testId="ctl-waist" />
        <Slider label="KelpFusion 융합 (0 = 켈프만)" value={params.fusion} min={0} max={1} step={0.05} onChange={(fusion) => setParams({ fusion })} format={(v) => v.toFixed(2)} testId="ctl-fusion" />
        <Hint>소속 점들의 최소 신장 트리를 뼈대로 삼아, 점 둘레는 부풀고 연결 부위는 가늘어지는 해초 모양의 영역을 만듭니다. 뼈대는 비소속 점을 지나지 않도록 계산합니다. 융합 값을 올리면 비소속 점이 없는 델로네 삼각형이 채워져 볼록 껍질 쪽으로 옮겨 갑니다(KelpFusion의 개념을 단순화한 구현).</Hint>
      </ControlGroup>
      <EditControls params={params} setParams={setParams as never} sets={setsOf(mapping)} />
    </>
  )
}

export const kelpModule: VizModule<KelpParams> = {
  roles: pointRoles(),
  datasets: ['set-points'],
  defaultParams: { ...editDefaults, radius: 15, waist: 0.35, fusion: 0, avoid: 0.9 },
  Chart: KelpChart,
  Controls: KelpControls,
  hint: '점을 끌면 뼈대와 영역이 다시 계산됩니다 · 융합 슬라이더로 켈프에서 껍질 쪽으로',
}

// ───────────────────────────── LineSets ─────────────────────────────

export interface LineSetsParams extends EditParams { tension: number; gap: number }

function LineSetsChart({ table, mapping, params, width, height, compact, linked, onTableChange }: ChartProps<LineSetsParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const scene = usePointScene(table, mapping, width, height, compact)
  const result = useMemo(() => (scene ? lineSets(scene.px, scene.ps.member, params.gap) : null), [scene?.px.map((p) => p.join()).join('|'), scene?.ps.member, params.gap]) // eslint-disable-line react-hooks/exhaustive-deps
  const edit = usePointEdit(scene, params, table, svgRef, compact, onTableChange, hide)
  if (!scene || !result) return <ChartMessage>x·y 좌표와 집합 열(0/1 소속) 2개 이상을 선택하세요.</ChartMessage>
  const { ps, px } = scene
  const color = categoryColor(ps.setNames)
  const curve = d3.line<Pt>().curve(d3.curveCatmullRom.alpha(params.tension))
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" style={{ touchAction: 'none' }} {...edit.svgProps}
        aria-label={`LineSets: 점 ${ps.data.length}개, 집합 ${ps.setNames.length}개, 선 교차 ${result.crossings}회`}>
        {result.sets.map((l) => (l.line.length > 1 ? (
          <path key={l.set} d={curve(l.line) ?? ''} fill="none" stroke={color(ps.setNames[l.set])} strokeWidth={compact ? 1.4 : 3} strokeLinecap="round" opacity={params.focusSet >= 0 && params.focusSet !== l.set ? 0.15 : 0.85} data-testid="set-line" />
        ) : null))}
        <PointLayer ps={ps} px={px} color={color} params={params} svgRef={svgRef} compact={compact} linked={linked} show={show} hide={hide} down={edit.down} editable={edit.editable} />
        {!compact && (
          <g transform="translate(10,12)">
            {ps.setNames.map((s, i) => (
              <g key={s} transform={`translate(0,${i * 16})`}><rect width={10} height={4} y={-6} fill={color(s)} /><text x={15} className="radar-level" dy="0.1em">{s} (길이 {Math.round(result.sets[i].length)})</text></g>
            ))}
            <text y={ps.setNames.length * 16 + 4} className="radar-level" data-testid="line-crossings">선 교차 {result.crossings}회</text>
          </g>
        )}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function LineSetsControls({ params, setParams, mapping }: ControlsProps<LineSetsParams>) {
  return (
    <>
      <ControlGroup title="경로 모양">
        <Slider label="곡선 굽힘 (0 = 둥글게, 1 = 팽팽하게)" value={params.tension} min={0} max={1} step={0.05} onChange={(tension) => setParams({ tension })} format={(v) => v.toFixed(2)} testId="ctl-tension" />
        <Slider label="공유 항목에서 선 간격 (px)" value={params.gap} min={0} max={10} onChange={(gap) => setParams({ gap })} testId="ctl-gap" />
        <Hint>집합마다 소속 점을 한 줄로 잇는 가장 짧은 경로(최근접 이웃 + 2-opt)를 찾아 곡선으로 그립니다. 여러 집합이 지나는 점에서는 선을 나란히 벌려 각 집합을 따라갈 수 있게 합니다. 영역을 칠하지 않으므로 면적 겹침 없이 많은 집합을 올릴 수 있지만, 경로 순서는 집합의 의미가 아닙니다.</Hint>
      </ControlGroup>
      <EditControls params={params} setParams={setParams as never} sets={setsOf(mapping)} />
    </>
  )
}

export const lineSetsModule: VizModule<LineSetsParams> = {
  roles: pointRoles(),
  datasets: ['set-points'],
  defaultParams: { ...editDefaults, tension: 0.5, gap: 4 },
  Chart: LineSetsChart,
  Controls: LineSetsControls,
  hint: '점을 끌면 경로가 다시 계산됩니다 · 선 교차 횟수가 범례에 표시됩니다',
}

// ───────────────────────────── Rainbow Boxes ─────────────────────────────

export interface RainbowParams { optimize: boolean; weights: boolean; selected: number }

function RainbowChart({ table, mapping, params, setParams, width, height, compact, linked }: ChartProps<RainbowParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const setCols = roleColumns(mapping, 'sets')
  const wCol = roleColumn(mapping, 'weight')
  const model = useMemo(() => {
    const si = setCols.map((c) => columnIndex(table, c))
    if (si.length < 2 || si.some((i) => i < 0)) return null
    const lab = columnIndex(table, roleColumn(mapping, 'label'))
    const wi = columnIndex(table, wCol)
    const rows = table.rows.map((_, i) => i)
    const member = si.map((c) => rows.map((i) => (toNumber(table.rows[i][c]) ?? 0) > 0))
    const names = rows.map((i) => (lab >= 0 ? toLabel(table.rows[i][lab]) : `행 ${i + 1}`))
    const weight = rows.map((i) => (wi >= 0 ? Math.max(0, toNumber(table.rows[i][wi]) ?? 0) : 1))
    // elements without any membership are left out: they carry no box
    const keep = rows.filter((i) => member.some((m) => m[i]))
    const sub = member.map((m) => keep.map((i) => m[i]))
    const lay = rainbowBoxes(sub, keep.length)
    const order = params.optimize ? lay.order : keep.map((_, k) => k)
    return { keep, member, names, weight, sub, lay, order }
  }, [table, setCols.join('|'), wCol, params.optimize]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!model || !model.keep.length) return <ChartMessage>집합 열(0/1 소속)을 2개 이상 선택하세요.</ChartMessage>
  const { keep, sub, names, weight, order } = model
  // fragments of the plain (table) order for comparison with the optimized order
  const plainRuns = sub.reduce((n, m) => n + m.reduce((c, v, i) => c + (v && !m[i - 1] ? 1 : 0), 0), 0)
  const runs = params.optimize ? model.lay.runs : sub.map((m) => {
    const out: [number, number][] = []
    let s = -1
    m.forEach((v, c) => { if (v) { if (s < 0) s = c } else if (s >= 0) { out.push([s, c - 1]); s = -1 } })
    if (s >= 0) out.push([s, m.length - 1])
    return out
  })
  const color = categoryColor(setCols)
  const wts = order.map((k) => (params.weights ? Math.max(0.0001, weight[keep[k]]) : 1))
  const m = compact ? { l: 4, r: 4, t: 4, b: 4 } : { l: 14, r: 14, t: 18, b: 56 }
  const iw = width - m.l - m.r
  const tot = wts.reduce((a, b) => a + b, 0)
  const colX = (c: number) => (wts.slice(0, c).reduce((a, b) => a + b, 0) / tot) * iw
  const colW = (c: number) => (wts[c] / tot) * iw
  const lanes = params.optimize ? model.lay.lane : sub.map((_, s) => s)
  const laneCount = params.optimize ? model.lay.lanes : sub.length
  const laneH = Math.min(46, (height - m.t - m.b) / Math.max(1, laneCount))
  const boxH = laneH * 0.78
  const selPos = params.selected >= 0 ? order.indexOf(params.selected) : -1
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg"
        aria-label={`Rainbow Boxes: 원소 ${keep.length}개, 집합 ${setCols.length}개, 상자 조각 ${runs.reduce((n, r) => n + r.length, 0)}개`}>
        <g transform={`translate(${m.l},${m.t})`}>
          {Array.from({ length: laneCount }, (_, l) => <rect key={l} x={0} y={l * laneH} width={iw} height={laneH} fill={l % 2 ? '#fff' : '#f7f8fa'} />)}
          {runs.map((rs, s) => rs.map(([a, b], k) => {
            const x = colX(a), w = colX(b) + colW(b) - x
            return (
              <g key={`${s}-${k}`} data-testid="rainbow-box">
                <rect x={x + 0.5} y={lanes[s] * laneH + (laneH - boxH) / 2} width={Math.max(1, w - 1)} height={boxH} rx={3} fill={color(setCols[s])} fillOpacity={0.82} stroke={color(setCols[s])} />
                {!compact && k === 0 && w > 40 && <text x={x + 6} y={lanes[s] * laneH + laneH / 2} dy="0.34em" fill="#fff" fontSize={11} style={{ pointerEvents: 'none' }}>{setCols[s]}</text>}
              </g>
            )
          }))}
          {/* element columns: a thin strip under the boxes; holes in a box show up as gaps over the columns that are not members */}
          {order.map((k, c) => {
            const row = keep[k]
            const isSel = params.selected === k
            const marks = sub.map((mm, s) => (mm[k] ? s : -1)).filter((s) => s >= 0)
            return (
              <g key={k} data-testid="rainbow-col" onPointerEnter={compact ? undefined : (e) => {
                linked?.set([row])
                const lp = localPoint(svgRef.current!, e)
                show(lp.x, lp.y, <><b>{names[row]}</b><br />{marks.map((s) => setCols[s]).join(' · ')}</>)
              }} onPointerLeave={() => { hide(); linked?.set(null) }} onClick={compact ? undefined : () => setParams({ selected: isSel ? -1 : k })} style={{ cursor: compact ? undefined : 'pointer' }}>
                <rect x={colX(c)} y={0} width={colW(c)} height={laneCount * laneH + 22} fill="transparent" />
                <rect x={colX(c) + 0.5} y={laneCount * laneH + 4} width={Math.max(1, colW(c) - 1)} height={10} fill={isSel || (linked?.rows ?? []).includes(row) ? '#111' : '#c9ced4'} />
                {!compact && colW(c) >= 9 && keep.length <= 60 && <text transform={`translate(${colX(c) + colW(c) / 2},${laneCount * laneH + 20}) rotate(60)`} fontSize={9} fill="#555">{names[row]}</text>}
              </g>
            )
          })}
          {selPos >= 0 && <rect x={colX(selPos)} y={0} width={colW(selPos)} height={laneCount * laneH + 14} fill="none" stroke="#111" strokeWidth={1.4} pointerEvents="none" />}
          {!compact && <text x={0} y={-6} className="radar-level" data-testid="rainbow-frag">상자 조각 {runs.reduce((n, r) => n + r.length, 0)}개{params.optimize ? ` (표 순서 ${plainRuns}개)` : ''} · 층 {laneCount}</text>}
        </g>
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function RainbowControls({ params, setParams }: ControlsProps<RainbowParams>) {
  return (
    <ControlGroup title="배치">
      <Toggle label="상자가 끊기지 않도록 원소 순서 최적화" checked={params.optimize} onChange={(optimize) => setParams({ optimize })} testId="ctl-optimize" />
      <Toggle label="가중치 열을 칸 너비로" checked={params.weights} onChange={(weights) => setParams({ weights })} testId="ctl-weights" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: -1 })} data-testid="rainbow-clear">선택 해제</button>
      <Hint>원소가 세로 칸이고 집합은 칸들을 가로질러 덮는 색 상자입니다. 소속이 아닌 칸에서는 상자가 끊기므로, 상자 조각 수가 적을수록 읽기 쉽습니다. 서로 겹치지 않는 구간의 집합은 같은 층에 올려 공간을 아낍니다. 순서 최적화는 휴리스틱이라 최소 조각 수를 보장하지 않습니다.</Hint>
    </ControlGroup>
  )
}

export const rainbowBoxesModule: VizModule<RainbowParams> = {
  roles: [
    { key: 'label', label: '이름', type: 'category', auto: true },
    { key: 'sets', label: '집합 (0/1 소속 열)', type: 'number', required: true, multiple: { min: 2, max: 8 } },
    { key: 'weight', label: '가중치 (칸 너비)', type: 'number', prefer: '가중|weight' },
  ],
  datasets: ['set-members', 'set-points'],
  defaultParams: { optimize: true, weights: false, selected: -1 },
  Chart: RainbowChart,
  Controls: RainbowControls,
  hint: '칸을 누르면 그 원소가 속한 집합을 확인합니다 · 순서 최적화로 상자 조각 수를 줄입니다',
}

// ───────────────────────────── Radial Sets ─────────────────────────────

export interface RadialSetsParams { gap: number; selected: number }

function RadialSetsChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<RadialSetsParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const setCols = roleColumns(mapping, 'sets')
  const model = useMemo(() => {
    const si = setCols.map((c) => columnIndex(table, c))
    if (si.length < 2 || si.some((i) => i < 0)) return null
    const member = si.map((c) => table.rows.map((r) => (toNumber(r[c]) ?? 0) > 0))
    return { layout: radialSets(member, table.rows.length, params.gap), n: table.rows.length }
  }, [table, setCols.join('|'), params.gap]) // eslint-disable-line react-hooks/exhaustive-deps
  const [hover, setHover] = useState(-1)
  if (!model) return <ChartMessage>집합 열(0/1 소속)을 2개 이상 선택하세요.</ChartMessage>
  const { layout } = model
  const color = categoryColor(setCols)
  const R = Math.max(50, Math.min(width, height) / 2 - (compact ? 8 : 52))
  const rIn = R * 0.46, rBase = R * 0.58, bandH = R * 0.4
  const cx = width / 2, cy = height / 2
  const ang = (a: number) => a - Math.PI / 2
  const P = (a: number, r: number): Pt => [cx + r * Math.cos(ang(a)), cy + r * Math.sin(ang(a))]
  const arcGen = d3.arc<{ a0: number; a1: number; r0: number; r1: number }>().startAngle((d) => d.a0).endAngle((d) => d.a1).innerRadius((d) => d.r0).outerRadius((d) => d.r1)
  const active = hover >= 0 ? hover : params.selected
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`Radial Sets: 집합 ${setCols.length}개, 원소 ${model.n}개, 겹침 ${layout.links.length}쌍`} onPointerLeave={() => { hide(); setHover(-1) }}>
        <circle cx={cx} cy={cy} r={rIn} fill="none" stroke="#e1e5e9" />
        {layout.links.map((l, k) => {
          const dim = active >= 0 && l.a !== active && l.b !== active
          const [p0, p1, p2, p3] = [P(l.a0, rIn), P(l.a1, rIn), P(l.b0, rIn), P(l.b1, rIn)]
          return (
            <path key={k} d={`M${p0}Q${cx},${cy} ${p3}A${rIn},${rIn} 0 0 ${l.b1 > l.b0 ? 0 : 1} ${p2}Q${cx},${cy} ${p1}A${rIn},${rIn} 0 0 ${l.a1 > l.a0 ? 0 : 1} ${p0}Z`} fill={color(setCols[l.a])} fillOpacity={dim ? 0.05 : 0.38} stroke={color(setCols[l.b])} strokeOpacity={dim ? 0.05 : 0.5} strokeWidth={0.6} data-testid="radial-link"
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{setCols[l.a]} ∩ {setCols[l.b]}</b><br />공유 원소 {l.count}개</>) }} onPointerLeave={hide} />
          )
        })}
        {layout.sectors.map((s) => (
          <g key={s.set} opacity={active >= 0 && active !== s.set ? 0.55 : 1}>
            <path d={arcGen({ a0: s.a0, a1: s.a1, r0: rIn - 6, r1: rIn }) ?? ''} transform={`translate(${cx},${cy})`} fill={color(setCols[s.set])} data-testid="radial-sector" style={{ cursor: compact ? undefined : 'pointer' }}
              onClick={compact ? undefined : () => setParams({ selected: params.selected === s.set ? -1 : s.set })} onPointerEnter={() => setHover(s.set)} onPointerLeave={() => setHover(-1)} />
            {!compact && s.a1 - s.a0 > 0.15 && <text x={P((s.a0 + s.a1) / 2, R + 22)[0]} y={P((s.a0 + s.a1) / 2, R + 22)[1]} textAnchor="middle" dy="0.34em" className="radar-axis-label">{setCols[s.set]} ({s.size})</text>}
          </g>
        ))}
        {layout.arcs.map((a, k) => (
          <path key={k} d={arcGen({ a0: a.a0, a1: a.a1, r0: rBase, r1: rBase + (a.degree / layout.maxDegree) * bandH }) ?? ''} transform={`translate(${cx},${cy})`} fill={color(setCols[a.set])} fillOpacity={0.25 + 0.6 * (a.degree / layout.maxDegree)} stroke="#fff" strokeWidth={0.6} data-testid="radial-arc" opacity={active >= 0 && active !== a.set ? 0.4 : 1}
            onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{setCols[a.set]}</b><br />{a.degree}개 집합에 속한 원소 {a.count}개</>) }} onPointerLeave={hide} />
        ))}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function RadialSetsControls({ params, setParams }: ControlsProps<RadialSetsParams>) {
  return (
    <ControlGroup title="배치">
      <Slider label="부채꼴 사이 간격 (라디안)" value={params.gap} min={0.02} max={0.3} step={0.01} onChange={(gap) => setParams({ gap })} format={(v) => v.toFixed(2)} testId="ctl-gap" />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ selected: -1 })} data-testid="radial-clear">선택 해제</button>
      <Hint>집합은 원 둘레의 부채꼴이고 각도가 집합 크기에 비례합니다. 부채꼴 바깥쪽에는 원소를 ‘몇 개 집합에 속하는가’(차수)로 묶어 방사형 막대로 나타내며, 막대가 길수록 여러 집합에 걸친 원소입니다. 안쪽 띠는 두 집합의 공통 원소 수에 비례합니다(Radial Sets의 단순화한 구현).</Hint>
    </ControlGroup>
  )
}

export const radialSetsModule: VizModule<RadialSetsParams> = {
  roles: [{ key: 'sets', label: '집합 (0/1 소속 열)', type: 'number', required: true, multiple: { min: 2, max: 10 } }],
  datasets: ['set-members', 'set-points'],
  defaultParams: { gap: 0.08, selected: -1 },
  Chart: RadialSetsChart,
  Controls: RadialSetsControls,
  hint: '부채꼴을 눌러 그 집합과 겹치는 집합만 강조합니다',
}
