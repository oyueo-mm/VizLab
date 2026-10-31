import * as d3 from 'd3'
import { Trash2 } from 'lucide-react'
import { useMemo, useRef, type PointerEvent } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Segmented, Select, StatTable, Toggle } from '../../components/controls'
import { columnIndex, removeRows, toLabel, toNumber, updateRow } from '../../data/table'
import { fmt } from '../../lib/format'
import { blandAltman, type DiffMode } from '../../stats/agreement'
import { pearson } from '../../stats/descriptive'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, VizModule } from '../types'
import type { DataTable } from '../../data/table'
import { paddedDomain } from './shared'

export interface BlandAltmanParams {
  mode: DiffMode
  level: 0.9 | 0.95 | 0.99
  showCi: boolean
  showRegression: boolean
  selected: number
}

const MODE_TEXT: Record<DiffMode, { y: string; x: string; unit: string }> = {
  difference: { y: '차이 (A − B)', x: '평균 (A+B)/2', unit: '' },
  percent: { y: '차이 (%, (A−B)/평균)', x: '평균 (A+B)/2', unit: '%' },
  ratio: { y: '로그 비 ln(A/B)', x: '로그 평균 (ln A+ln B)/2', unit: '' },
}

function readPairs(table: DataTable, mapping: Mapping) {
  const ai = columnIndex(table, roleColumn(mapping, 'a'))
  const bi = columnIndex(table, roleColumn(mapping, 'b'))
  const li = columnIndex(table, roleColumn(mapping, 'label'))
  const pairs: { a: number; b: number; row: number; label: string }[] = []
  let missing = 0
  if (ai >= 0 && bi >= 0) table.rows.forEach((r, row) => {
    const a = toNumber(r[ai]); const b = toNumber(r[bi])
    if (a == null || b == null) { missing++; return }
    pairs.push({ a, b, row, label: li >= 0 ? toLabel(r[li]) : '' })
  })
  return { pairs, missing, labelOf: new Map(pairs.map((p) => [p.row, p.label])) }
}

function BlandAltmanChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<BlandAltmanParams>) {
  const { pairs, missing, labelOf } = useMemo(() => readPairs(table, mapping), [table, mapping])
  const ba = useMemo(() => blandAltman(pairs, params.mode, params.level), [pairs, params.mode, params.level])
  const { tip, show, hide } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const m = margins(compact)
  const iw = Math.max(40, width - m.left - m.right)
  const ih = Math.max(40, height - m.top - m.bottom)
  const marked = new Set(linked?.rows ?? [])
  const editable = !!onTableChange && !compact && params.mode === 'difference'
  const aCol = roleColumn(mapping, 'a')
  const bCol = roleColumn(mapping, 'b')

  if (!aCol || !bCol) return <ChartMessage>방법 A와 방법 B(숫자형) 열을 선택하세요.</ChartMessage>
  if (!ba) return <ChartMessage>쌍이 3개 이상 필요합니다.<small>{params.mode === 'ratio' ? '비 형태는 두 값이 모두 0보다 커야 합니다. ' : params.mode === 'percent' ? '백분율 형태는 두 값의 합이 0이 아니어야 합니다. ' : ''}값이 있는 쌍이 부족합니다.</small></ChartMessage>

  const xs = ba.points.map((p) => p.mean)
  const ys = ba.points.map((p) => p.diff)
  const xd = paddedDomain(xs, 0.05)
  const yd = paddedDomain([...ys, ba.loaLoCi[0], ba.loaHiCi[1]], 0.08)
  const x = d3.scaleLinear().domain(xd).range([0, iw])
  const y = d3.scaleLinear().domain(yd).range([ih, 0])
  if (!compact) { x.nice(); y.nice() }
  const r = pearson(pairs.map((p) => p.a), pairs.map((p) => p.b))
  const t = MODE_TEXT[params.mode]
  const outside = ba.points.filter((p) => p.outside)
  const q = (v: number) => (params.mode === 'ratio' ? `${fmt(v, 3)} (비 ${fmt(Math.exp(v), 3)})` : `${fmt(v, 3)}${t.unit}`)
  const del = () => { if (params.selected >= 0 && params.selected < table.rows.length) { onTableChange!(removeRows(table, [params.selected])); setParams({ selected: -1 }) } }
  const level = `${fmt(params.level * 100, 1)}%`

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current == null) return
    const p = localPoint(svgRef.current!, e)
    const mean = x.invert(p.x - m.left)
    const diff = y.invert(p.y - m.top)
    if (!Number.isFinite(mean) || !Number.isFinite(diff)) return
    // x = (A + B)/2 and y = A − B, so A = x + y/2 and B = x − y/2.
    onTableChange!(updateRow(table, drag.current, { [aCol]: Math.round((mean + diff / 2) * 100) / 100, [bCol]: Math.round((mean - diff / 2) * 100) / 100 }), true)
  }
  const onUp = () => { if (drag.current != null) { drag.current = null; onTableChange!(table, false) } }
  const band = (lo: number, hi: number, fill: string, id: string) => <rect data-testid={id} x={0} y={y(hi)} width={iw} height={Math.max(0, y(lo) - y(hi))} fill={fill} fillOpacity={0.16} />

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={`블랜드-알트만 플롯: 쌍 ${ba.n}개, 편향 ${fmt(ba.bias, 3)}`} tabIndex={editable ? 0 : undefined}
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hide(); linked?.set(null) }}
        onKeyDown={(e) => { if (!compact && onTableChange && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); del() } }}>
        <g transform={`translate(${m.left},${m.top})`}>
          <AxisBottom scale={x} y={ih} grid={ih} label={t.x} compact={compact} />
          <AxisLeft scale={y} x={0} grid={iw} label={t.y} compact={compact} />
          {params.showCi && <g aria-hidden="true">{band(ba.loaHiCi[0], ba.loaHiCi[1], '#2a7d74', 'ba-ci-hi')}{band(ba.loaLoCi[0], ba.loaLoCi[1], '#2a7d74', 'ba-ci-lo')}{band(ba.biasCi[0], ba.biasCi[1], '#2a7d74', 'ba-ci-bias')}</g>}
          <line className="ref-line" x1={0} x2={iw} y1={y(0)} y2={y(0)} stroke="#121816" strokeOpacity={0.35} />
          {[['bias', ba.bias, '#2a7d74', undefined], ['loa-hi', ba.loaHi, '#e07a3f', '6 4'], ['loa-lo', ba.loaLo, '#e07a3f', '6 4']].map(([id, v, c, dash]) => (
            <g key={id as string}>
              <line data-testid={`ba-${id}`} data-value={(v as number).toFixed(5)} x1={0} x2={iw} y1={y(v as number)} y2={y(v as number)} stroke={c as string} strokeWidth={1.6} strokeDasharray={dash as string | undefined} />
              {!compact && <text className="bar-label" x={iw - 4} y={y(v as number) - 5} textAnchor="end" fill={c as string}>{id === 'bias' ? '편향' : id === 'loa-hi' ? '상한' : '하한'} {fmt(v as number, 3)}{t.unit}</text>}
            </g>
          ))}
          {params.showRegression && <line data-testid="ba-regression" x1={0} x2={iw} y1={y(ba.intercept + ba.slope * x.invert(0))} y2={y(ba.intercept + ba.slope * x.invert(iw))} stroke="#5a6b66" strokeWidth={1.2} strokeDasharray="2 3" />}
          {ba.points.map((p) => {
            const on = params.selected === p.row || marked.has(p.row)
            return (
              <circle key={p.row} data-testid="ba-point" data-row={p.row} data-outside={p.outside ? '1' : undefined} data-nodrag="" cx={x(p.mean)} cy={y(p.diff)} r={on ? 6 : compact ? 2 : 4} fill={p.outside ? '#e07a3f' : '#2a7d74'} fillOpacity={0.75} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 2 : 0.8}
                style={{ cursor: editable ? 'grab' : compact ? undefined : 'pointer', touchAction: editable ? 'none' : undefined }}
                onPointerDown={editable ? (e) => { e.stopPropagation(); svgRef.current!.setPointerCapture(e.pointerId); drag.current = p.row; setParams({ selected: p.row }); hide() } : compact ? undefined : () => setParams({ selected: params.selected === p.row ? -1 : p.row })}
                onPointerEnter={compact ? undefined : (e) => { if (drag.current != null) return; linked?.set([p.row]); const lp = localPoint(svgRef.current!, e); show(lp.x, lp.y, <><b>{labelOf.get(p.row) || `행 ${p.row + 1}`}</b><br />A {fmt(p.a, 4)} · B {fmt(p.b, 4)}<br />평균 {fmt(p.mean, 4)}<br />차이 {q(p.diff)}{p.outside ? <><br />한계 밖</> : null}{editable ? <><br />드래그해 값 수정</> : null}</>) }}
                onPointerLeave={() => { hide(); linked?.set(null) }} />
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          <Readout items={[{ label: '쌍', value: ba.n }, { label: '편향', value: q(ba.bias) }, { label: `${level} 일치한계`, value: `${fmt(ba.loaLo, 3)} ~ ${fmt(ba.loaHi, 3)}` }, { label: '한계 밖', value: outside.length }, { label: '상관 r', value: fmt(r, 3) }]} />
          {missing > 0 && <p className="chart-warning" role="status">값이 없는 {missing}행은 제외했습니다.</p>}
          {onTableChange && params.selected >= 0 && params.selected < table.rows.length && (
            <div className="chart-actions" style={{ bottom: 6, right: 8 }}><span>행 {params.selected + 1}</span><button type="button" onClick={del} data-testid="ba-delete"><Trash2 size={14} aria-hidden="true" />삭제</button></div>
          )}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

function BlandAltmanControls({ params, setParams, table, mapping }: ControlsProps<BlandAltmanParams>) {
  const { pairs } = useMemo(() => readPairs(table, mapping), [table, mapping])
  const ba = useMemo(() => blandAltman(pairs, params.mode, params.level), [pairs, params.mode, params.level])
  const r = pearson(pairs.map((p) => p.a), pairs.map((p) => p.b))
  return (
    <>
      <ControlGroup title="차이의 정의">
        <Segmented label="차이" value={params.mode} onChange={(mode) => setParams({ mode })} testId="ctl-ba-mode" options={[{ value: 'difference', label: '절대 차이' }, { value: 'percent', label: '백분율' }, { value: 'ratio', label: '로그 비' }]} />
        <Hint>{params.mode === 'difference' ? '차이 A−B를 그대로 씁니다. 값이 클수록 오차도 커지는 데이터에는 맞지 않을 수 있습니다.' : params.mode === 'percent' ? '차이를 평균의 백분율로 바꿉니다. 오차가 크기에 비례할 때 적합합니다.' : '로그를 취한 뒤 차이를 구합니다(양수 데이터만). 한계를 되돌리면 A/B 비의 범위가 됩니다.'}</Hint>
        <Select label="일치한계 수준" value={String(params.level)} onChange={(v) => setParams({ level: Number(v) as BlandAltmanParams['level'] })} testId="ctl-ba-level" options={[{ value: '0.9', label: '90% (±1.645 SD)' }, { value: '0.95', label: '95% (±1.96 SD)' }, { value: '0.99', label: '99% (±2.576 SD)' }]} />
        <Toggle label="한계의 신뢰구간(음영)" checked={params.showCi} onChange={(showCi) => setParams({ showCi })} testId="ctl-ba-ci" description="편향과 두 일치한계 자체의 불확실성입니다. 표본이 작을수록 넓습니다." />
        <Toggle label="차이~평균 회귀선" checked={params.showRegression} onChange={(showRegression) => setParams({ showRegression })} testId="ctl-ba-reg" description="기울기가 0에서 멀면 평균 크기에 따라 편향이 달라진다는 뜻(비례 편향)입니다." />
      </ControlGroup>
      {ba && (
        <ControlGroup title="결과">
          <StatTable rows={[
            ['쌍', ba.n],
            ['편향 (평균 차이)', `${fmt(ba.bias, 4)} [${fmt(ba.biasCi[0], 3)}, ${fmt(ba.biasCi[1], 3)}]`],
            ['차이의 SD', fmt(ba.sd, 4)],
            ['하한', `${fmt(ba.loaLo, 4)} [${fmt(ba.loaLoCi[0], 3)}, ${fmt(ba.loaLoCi[1], 3)}]`],
            ['상한', `${fmt(ba.loaHi, 4)} [${fmt(ba.loaHiCi[0], 3)}, ${fmt(ba.loaHiCi[1], 3)}]`],
            ['회귀 기울기', fmt(ba.slope, 3)],
            ['상관계수 r', fmt(r, 3)],
          ]} />
          <Hint>상관이 높다는 것은 두 방법이 같은 방향으로 움직인다는 뜻일 뿐 값이 같다는 뜻이 아닙니다. 한 방법이 항상 2씩 크게 재도 r은 1입니다. 일치도는 편향과 일치한계를 임상·공정에서 허용할 수 있는지로 판단하며, 이 그림은 허용 기준을 정해 주지 않습니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}

export const blandAltmanModule: VizModule<BlandAltmanParams> = {
  roles: [
    { key: 'a', label: '방법 A', type: 'number', required: true, prefer: '방법 A|A$' },
    { key: 'b', label: '방법 B', type: 'number', required: true, prefer: '방법 B|B$' },
    { key: 'label', label: '대상 이름 (선택)', type: 'category', auto: true },
  ],
  datasets: ['paired'],
  defaultParams: { mode: 'difference', level: 0.95, showCi: true, showRegression: false, selected: -1 },
  Chart: BlandAltmanChart,
  Controls: BlandAltmanControls,
  hint: '점을 끌어 값 수정(절대 차이 형태) · 클릭해 선택 후 Delete · 일치한계 수준과 차이의 정의를 바꿔 보세요 · 높은 상관이 일치를 뜻하지 않습니다',
}
