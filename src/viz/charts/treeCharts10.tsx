import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { ChartMessage, Tooltip, localPoint, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, Toggle } from '../../components/controls'
import { columnIndex, toNumber, toLabel } from '../../data/table'
import { fmt } from '../../lib/format'
import { buildTree } from '../../stats/hierarchy'
import { contourBoxplot, spaceTree } from '../../stats/stat10c'
import { roleColumn, roleColumns } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'

// ───────────────────────────── contour boxplot ─────────────────────────────

export interface CbParams { level: number; showAll: boolean; factor: number }

function CbChart({ table, mapping, params, width, height, compact }: ChartProps<CbParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const grid = useMemo(() => {
    const mi = columnIndex(table, roleColumn(mapping, 'member')), xi = columnIndex(table, roleColumn(mapping, 'x')), yi = columnIndex(table, roleColumn(mapping, 'y')), vi = columnIndex(table, roleColumn(mapping, 'value'))
    if (mi < 0 || xi < 0 || yi < 0 || vi < 0) return null
    const names: string[] = [], idx = new Map<string, number>()
    let W = 0, H = 0
    const cells: { m: number; x: number; y: number; v: number }[] = []
    for (const r of table.rows) {
      const x = toNumber(r[xi]), y = toNumber(r[yi]), v = toNumber(r[vi])
      if (x == null || y == null || v == null) continue
      const k = toLabel(r[mi])
      if (!idx.has(k)) { idx.set(k, names.length); names.push(k) }
      W = Math.max(W, x + 1); H = Math.max(H, y + 1)
      cells.push({ m: idx.get(k)!, x, y, v })
    }
    if (names.length < 5 || W < 4 || H < 4 || W * H > 10000) return null
    const fields = names.map(() => new Float32Array(W * H).fill(NaN))
    for (const c of cells) fields[c.m][c.y * W + c.x] = c.v
    return { names, W, H, fields }
  }, [table, mapping])
  const result = useMemo(() => {
    if (!grid) return null
    const masks = grid.fields.map((f) => Uint8Array.from(f, (v) => (v >= params.level ? 1 : 0)))
    return { masks, cb: contourBoxplot(masks, params.factor) }
  }, [grid, params.level, params.factor])
  if (!grid || !result) return <ChartMessage>멤버, x, y, 값 열을 고르세요(멤버 5개 이상, 격자 100×100 이하).</ChartMessage>
  const { W, H } = grid, { masks, cb } = result
  const side = Math.min(width, height) - (compact ? 8 : 20)
  const k = side / Math.max(W, H)
  const ox = (width - W * k) / 2, oy = (height - H * k) / 2
  const path = (m: Uint8Array) => {
    const cs = d3.contours().size([W, H]).thresholds([0.5])(Array.from(m))
    return d3.geoPath(d3.geoIdentity().scale(k).translate([ox, oy]))(cs[0]) ?? ''
  }
  const diff = Uint8Array.from(cb.union, (u, i) => (u && !cb.intersection[i] ? 1 : 0))
  const out = new Set(cb.outliers)
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`윤곽 상자그림: 멤버 ${grid.names.length}개, 이상 윤곽 ${cb.outliers.length}개`} onPointerLeave={hide}>
        {params.showAll && masks.map((m, i) => (out.has(i) || i === cb.median ? null : <path key={i} d={path(m)} fill="none" stroke="#9aa6a6" strokeOpacity={0.35} />))}
        <path d={path(cb.union)} fill="#a9d3c4" fillOpacity={0.4} stroke="none" data-testid="cb-box" />
        <path d={path(cb.intersection)} fill="#fff" fillOpacity={0.85} stroke="#3f8f78" strokeWidth={1} data-testid="cb-core" />
        <path d={path(cb.union)} fill="none" stroke="#3f8f78" strokeWidth={1.2} />
        {cb.outliers.map((i) => <path key={i} d={path(masks[i])} fill="none" stroke="#d4452f" strokeWidth={1.6} strokeDasharray="5 3" data-testid="cb-outlier"
          onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <>{grid.names[i]} · 이상 윤곽<br />깊이 {fmt(cb.depth[i], 3)}</>) }} onPointerLeave={hide} />)}
        <path d={path(masks[cb.median])} fill="none" stroke="#111827" strokeWidth={2.4} data-testid="cb-median" />
        {!compact && <text x={10} y={16} fontSize={11} fill="#374151" data-testid="cb-summary">중앙 윤곽 {grid.names[cb.median]} · 이상 윤곽 {cb.outliers.length}개 · 상자 면적 {diff.reduce((a, b) => a + b, 0)}칸</text>}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function CbControls({ params, setParams }: ControlsProps<CbParams>) {
  return (
    <ControlGroup title="윤곽 상자그림">
      <Slider label="등치선 값(이 값 이상인 영역이 윤곽 안쪽)" value={params.level} min={0.2} max={1.2} step={0.05} onChange={(level) => setParams({ level })} format={(v) => v.toFixed(2)} testId="ctl-level" />
      <Slider label="이상 판정 배율(깊이 사분위 범위의 몇 배)" value={params.factor} min={0.5} max={3} step={0.1} onChange={(factor) => setParams({ factor })} format={(v) => v.toFixed(1)} testId="ctl-factor" />
      <Toggle label="모든 윤곽 표시" checked={params.showAll} onChange={(showAll) => setParams({ showAll })} testId="ctl-showall" />
      <Hint>시뮬레이션 앙상블에서 멤버마다 같은 값 이상인 영역(등치선 안쪽)을 구해, 멤버 쌍이 이루는 띠(두 영역 사이) 안에 칸 단위로 들어오는 비율(수정 윤곽 띠 깊이)로 깊이를 정합니다. 가장 깊은 멤버가 중앙 윤곽(검은 선), 깊이가 큰 절반 멤버의 합집합과 교집합 사이가 상자(초록), 깊이가 유난히 낮은 멤버가 이상 윤곽(붉은 점선)입니다. 구조는 원 논문과 같지만 이상 윤곽 판정은 깊이 사분위로 단순화했고, 영역은 격자의 칸 단위로 다룹니다.</Hint>
    </ControlGroup>
  )
}

export const cbModule: VizModule<CbParams> = {
  roles: [
    { key: 'member', label: '멤버', type: 'category', required: true, prefer: '멤버|member' },
    { key: 'x', label: 'x (격자)', type: 'number', required: true, prefer: '^x$' },
    { key: 'y', label: 'y (격자)', type: 'number', required: true, prefer: '^y$' },
    { key: 'value', label: '값', type: 'number', required: true, prefer: '값|value' },
  ],
  datasets: ['contour-ensemble'],
  defaultParams: { level: 0.5, showAll: true, factor: 1.5 },
  Chart: CbChart,
  Controls: CbControls,
  hint: '등치선 값을 바꾸면 윤곽과 깊이가 다시 계산됩니다 · 붉은 점선이 이상 윤곽',
}

// ───────────────────────────── SpaceTree ─────────────────────────────

export interface StParams { selected: string; labels: boolean }

interface Tn { name: string; children?: Tn[] }

function StChart({ table, mapping, params, setParams, width, height, compact }: ChartProps<StParams>) {
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const levels = roleColumns(mapping, 'levels')
  const tree = useMemo(() => (levels.length ? (buildTree(table, levels, null).tree as Tn) : null), [table, levels.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const selected = params.selected ? params.selected.split('/') : []
  const nodes = useMemo(() => (tree ? spaceTree(tree, selected, height) : []), [tree, params.selected, height]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!tree) return <ChartMessage>계층 수준 열을 하나 이상 고르세요.</ChartMessage>
  const maxDepth = Math.max(...nodes.map((n) => n.depth))
  const colW = (width - 20) / (maxDepth + 1.35)
  const bw = Math.min(colW * 0.72, compact ? 40 : 128)
  const X = (d: number) => 10 + d * colW
  const pick = (n: (typeof nodes)[number]) => {
    const below = n.path.slice(1).join('/')
    setParams({ selected: below === params.selected && n.depth > 0 ? n.path.slice(1, -1).join('/') : below })
  }
  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`스페이스트리: 보이는 노드 ${nodes.length}개`} onPointerLeave={hide}>
        {nodes.filter((n) => n.parent >= 0).map((n) => {
          const p = nodes[n.parent]
          const x0 = X(p.depth) + bw, x1 = X(n.depth), mx = (x0 + x1) / 2
          return <path key={n.path.join('/')} d={`M${x0},${p.y}C${mx},${p.y} ${mx},${n.y} ${x1},${n.y}`} fill="none" stroke="#b7c3c3" strokeWidth={1.2} />
        })}
        {nodes.map((n) => {
          const onPath = selected.length >= n.path.length - 1 && n.path.slice(1).every((s, i) => s === selected[i])
          const isSel = n.path.slice(1).join('/') === params.selected
          const triH = n.hasKids && !n.open ? Math.min(n.h * 2.2, 3 + Math.sqrt(n.leaves) * 2.4) : 0
          return (
            <g key={n.path.join('/')} data-testid="st-node" data-open={n.open} data-depth={n.depth} style={{ cursor: n.hasKids ? 'pointer' : 'default' }}
              onClick={() => pick(n)}
              onPointerEnter={compact ? undefined : (e) => { const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{n.name}</b><br />아래 잎 {n.leaves}개{n.hasKids ? (n.open ? ' · 펼쳐짐' : ' · 눌러서 펼치기') : ''}</>) }} onPointerLeave={hide}>
              <rect x={X(n.depth)} y={n.y - n.h / 2} width={bw} height={n.h} rx={3} fill={isSel ? '#cfe6dd' : onPath ? '#e8f1ee' : '#fff'} stroke={isSel ? '#3f8f78' : '#9fb0b0'} strokeWidth={isSel ? 1.8 : 1} />
              {params.labels && n.h >= 11 && !compact && <text x={X(n.depth) + 5} y={n.y} dy="0.34em" fontSize={Math.min(11, n.h - 2)} fill="#1f2937">{n.name.length > 12 ? n.name.slice(0, 11) + '…' : n.name}</text>}
              {triH > 0 && <path d={`M${X(n.depth) + bw + 3},${n.y - triH / 2}L${X(n.depth) + bw + 3 + Math.min(colW * 0.25, 14)},${n.y}L${X(n.depth) + bw + 3},${n.y + triH / 2}Z`} fill="#8fb7a8" data-testid="st-preview" />}
            </g>
          )
        })}
      </svg>
      {!compact && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

function StControls({ params, setParams }: ControlsProps<StParams>) {
  return (
    <ControlGroup title="스페이스트리">
      <Toggle label="이름 표시" checked={params.labels} onChange={(labels) => setParams({ labels })} testId="ctl-labels" />
      <Hint>노드를 누르면 그 노드까지의 경로와 그 노드의 자식만 펼치고 나머지 가지는 접습니다. 같은 깊이에 보이는 노드가 많아질수록 노드의 높이가 줄어 한 열이 화면에 들어오도록 크기를 다시 맞추고(동적 재조정), 접힌 가지의 오른쪽에는 아래에 있는 잎의 수에 비례하는 삼각형(미리보기)을 둡니다. 선택한 노드를 한 번 더 누르면 한 단계 접습니다. 원 논문의 애니메이션, 카메라 이동, 검색·필터는 구현하지 않았습니다.</Hint>
    </ControlGroup>
  )
}

export const spaceTreeModule: VizModule<StParams> = {
  roles: [{ key: 'levels', label: '계층 수준 (바깥 → 안쪽)', type: 'category', required: true, multiple: { min: 1, max: 4 } }],
  datasets: ['org-tree', 'budget'],
  defaultParams: { selected: '', labels: true },
  Chart: StChart,
  Controls: StControls,
  hint: '노드를 눌러 가지를 펼칩니다 · 접힌 가지의 삼각형이 클수록 아래 잎이 많습니다',
}
