import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { AxisBottom, AxisLeft, ChartMessage, Readout, Tooltip, localPoint, margins, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Slider, StatTable, Toggle } from '../../components/controls'
import { columnIndex, toNumber, type DataTable } from '../../data/table'
import { colorAt } from '../../lib/colors'
import { fmt, pct } from '../../lib/format'
import { averagePrecision, curveIssue, curvePoints, pointAt, prAucTrapezoid, prevalence, rocAuc, type CurvePoint, type Scored } from '../../stats/roc'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, Mapping, RoleSpec } from '../types'

export interface ClassifierParams {
  /** Decision threshold: score ≥ threshold is predicted positive. */
  threshold: number
  /** Show the other curve (PR next to ROC, or ROC next to PR). */
  compare: boolean
  baseline: boolean
  dots: boolean
  fill: boolean
}

export const classifierRoles: RoleSpec[] = [
  { key: 'score', label: '예측 점수 (높을수록 양성)', type: 'number', required: true },
  { key: 'label', label: '실제 레이블 (1 = 양성, 0 = 음성)', type: 'number', required: true },
]

export const classifierDefaults: ClassifierParams = { threshold: 0.5, compare: false, baseline: true, dots: false, fill: true }

/** Rows with a finite score and a 0/1 label. `badLabels` counts rows whose label is neither. */
export function scoredRows(table: DataTable, mapping: Mapping): { data: Scored[]; badLabels: number } {
  const si = columnIndex(table, roleColumn(mapping, 'score'))
  const li = columnIndex(table, roleColumn(mapping, 'label'))
  const data: Scored[] = []
  let badLabels = 0
  if (si < 0 || li < 0) return { data, badLabels }
  table.rows.forEach((r, row) => {
    const score = toNumber(r[si])
    const label = toNumber(r[li])
    if (score == null || label == null) return
    if (label !== 0 && label !== 1) { badLabels++; return }
    data.push({ score, label, row })
  })
  return { data, badLabels }
}

interface PanelProps {
  kind: 'roc' | 'pr'
  points: CurvePoint[]
  current: CurvePoint
  w: number
  h: number
  compact?: boolean
  params: ClassifierParams
  base: number
  onPick: (p: CurvePoint) => void
  /** Curve points of the observations marked in another chart (comparison lab). */
  marks: CurvePoint[]
  hoverTip: (px: number, py: number, p: CurvePoint | null) => void
  svg: React.RefObject<SVGSVGElement | null>
  ox: number
  oy: number
}

function Panel({ kind, points, current, w, h, compact, params, base, onPick, marks, hoverTip, svg, ox, oy }: PanelProps) {
  const x = d3.scaleLinear().domain([0, 1]).range([0, w])
  const y = d3.scaleLinear().domain([0, 1]).range([h, 0])
  const px = (p: CurvePoint) => (kind === 'roc' ? p.fpr : p.recall)
  const py = (p: CurvePoint) => (kind === 'roc' ? p.tpr : p.precision)
  const color = kind === 'roc' ? colorAt(0) : colorAt(1)
  const line = d3.line<CurvePoint>().x((p) => x(px(p))).y((p) => y(py(p))).curve(kind === 'roc' ? d3.curveLinear : d3.curveStepBefore)
  const linear = d3.line<CurvePoint>().x((p) => x(px(p))).y((p) => y(py(p)))
  const area = d3.area<CurvePoint>().x((p) => x(px(p))).y0(y(0)).y1((p) => y(py(p))).curve(kind === 'roc' ? d3.curveLinear : d3.curveStepBefore)
  const nearest = (mx: number, my: number) => d3.least(points, (p) => (x(px(p)) - mx) ** 2 + (y(py(p)) - my) ** 2)
  const loc = (e: { clientX: number; clientY: number }) => { const p = localPoint(svg.current!, e); return { mx: p.x - ox, my: p.y - oy, sx: p.x, sy: p.y } }
  const cx = x(px(current))
  const cy = y(py(current))
  return (
    <g transform={`translate(${ox},${oy})`} data-testid={`panel-${kind}`}>
      <AxisBottom scale={x} y={h} grid={h} label={compact ? undefined : kind === 'roc' ? '거짓양성률 FPR' : '재현율 Recall'} compact={compact} ticks={5} />
      <AxisLeft scale={y} x={0} grid={w} label={compact ? undefined : kind === 'roc' ? '참양성률 TPR' : '정밀도 Precision'} compact={compact} ticks={5} />
      {params.fill && <path d={area(points) ?? ''} fill={color} fillOpacity={0.1} aria-hidden="true" />}
      {params.baseline && (kind === 'roc'
        ? <line className="qq-line" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#8a9692" aria-hidden="true" data-testid="baseline" />
        : <line className="qq-line" x1={x(0)} y1={y(base)} x2={x(1)} y2={y(base)} stroke="#8a9692" aria-hidden="true" data-testid="baseline" />)}
      {kind === 'pr' && !compact && <path d={linear(points) ?? ''} fill="none" stroke={color} strokeOpacity={0.45} strokeDasharray="4 4" strokeWidth={1.4} aria-hidden="true" />}
      <path className="series-line" d={line(points) ?? ''} stroke={color} fill="none" data-testid={`${kind}-curve`} />
      {params.dots && !compact && points.map((p, i) => <circle key={i} cx={x(px(p))} cy={y(py(p))} r={2.4} fill="#fff" stroke={color} strokeWidth={1.2} aria-hidden="true" />)}
      {!compact && (
        <>
          <line x1={cx} x2={cx} y1={y(0)} y2={cy} stroke="#121816" strokeDasharray="3 3" strokeWidth={1} aria-hidden="true" />
          <line x1={x(0)} x2={cx} y1={cy} y2={cy} stroke="#121816" strokeDasharray="3 3" strokeWidth={1} aria-hidden="true" />
        </>
      )}
      {marks.map((p, i) => <circle key={i} data-testid={`${kind}-linked`} cx={x(px(p))} cy={y(py(p))} r={compact ? 2.5 : 5} fill="none" stroke="#121816" strokeWidth={2} aria-hidden="true" />)}
      <circle cx={cx} cy={cy} r={compact ? 3 : 6.5} fill="#e07a3f" stroke="#fff" strokeWidth={2} data-testid={`${kind}-current`} data-x={px(current).toFixed(4)} data-y={py(current).toFixed(4)} />
      {!compact && (
        <rect width={w} height={h} fill="transparent" style={{ cursor: 'crosshair' }} data-testid={`${kind}-hit`}
          onPointerMove={(e) => { const l = loc(e); const p = nearest(l.mx, l.my); hoverTip(l.sx, l.sy, p ?? null) }}
          onPointerLeave={() => hoverTip(0, 0, null)}
          onClick={(e) => { const l = loc(e); const p = nearest(l.mx, l.my); if (p) onPick(p) }} />
      )}
    </g>
  )
}

export function ClassifierChart({ kind, table, mapping, params, setParams, width, height, compact, linked }: ChartProps<ClassifierParams> & { kind: 'roc' | 'pr' }) {
  const { data, badLabels } = useMemo(() => scoredRows(table, mapping), [table, mapping])
  const issue = useMemo(() => curveIssue(data), [data])
  const points = useMemo(() => (issue ? [] : curvePoints(data)), [data, issue])
  const lo = data.length ? d3.min(data, (d) => d.score)! : 0
  const hi = data.length ? d3.max(data, (d) => d.score)! : 1
  const threshold = Math.min(hi, Math.max(lo, params.threshold))
  const svgRef = useRef<SVGSVGElement>(null)
  const { tip, show, hide } = useTooltip()
  const m = margins(compact, compact ? {} : { right: 22 })

  // Observations marked elsewhere sit on the curve at the threshold equal to their own score; hovering a curve point marks the observations tied at that threshold.
  const marks = useMemo(() => {
    if (!linked?.rows.length || compact) return []
    const rows = new Set(linked.rows)
    const scores = [...new Set(data.filter((d) => rows.has(d.row)).map((d) => d.score))].slice(0, 60)
    return scores.map((sc) => pointAt(data, sc))
  }, [linked?.rows, data, compact])
  if (!roleColumn(mapping, 'score') || !roleColumn(mapping, 'label')) return <ChartMessage>예측 점수와 실제 레이블(0/1) 열을 선택하세요.</ChartMessage>
  if (issue) return <ChartMessage>{issue}<small>데이터 탭에서 레이블을 확인하세요.</small></ChartMessage>
  const current = pointAt(data, threshold)
  const other: 'roc' | 'pr' = kind === 'roc' ? 'pr' : 'roc'
  const split = params.compare && !compact
  const side = width >= 640
  // Two panels share the area side by side on wide screens and stack on narrow ones; each stays square-ish.
  const pw = split ? (side ? Math.max(40, (width - m.left - m.right - 56) / 2) : Math.max(40, width - m.left - m.right)) : Math.max(40, width - m.left - m.right)
  const ph = split ? (side ? Math.max(40, height - m.top - m.bottom) : Math.max(40, (height - m.top - m.bottom - 64) / 2)) : Math.max(40, height - m.top - m.bottom)
  const sq = Math.min(pw, ph)
  const size = sq
  const offX = (w: number) => Math.max(0, (pw - w) / 2)
  const base = prevalence(data)
  const auc = rocAuc(points)
  const ap = averagePrecision(points)
  const showTip = (which: 'roc' | 'pr') => (px: number, py: number, p: CurvePoint | null) => {
    if (!p) { hide(); linked?.set(null); return }
    linked?.set(p.threshold === Infinity ? null : data.filter((d) => d.score === p.threshold).map((d) => d.row))
    show(px, py, <><b>임계값 ≥ {p.threshold === Infinity ? '∞ (모두 음성)' : fmt(p.threshold, 3)}</b><br />{which === 'roc' ? <>TPR {fmt(p.tpr, 3)} · FPR {fmt(p.fpr, 3)}</> : <>Precision {fmt(p.precision, 3)} · Recall {fmt(p.recall, 3)}</>}<br />TP {p.tp} · FP {p.fp} · FN {p.fn} · TN {p.tn}<br />클릭해 임계값으로 지정</>)
  }
  const pick = (p: CurvePoint) => setParams({ threshold: p.threshold === Infinity ? hi + (hi - lo) * 0.001 : p.threshold })
  const common = { points, current, compact, params, base, onPick: pick, marks, svg: svgRef, h: size, w: size }

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg" role="img" data-testid="chart-svg" aria-label={kind === 'roc' ? `ROC 곡선, AUC ${auc.toFixed(3)}` : `Precision–Recall 곡선, AP ${ap.toFixed(3)}`}>
        <Panel kind={kind} {...common} ox={m.left + offX(size)} oy={m.top} hoverTip={showTip(kind)} />
        {split && <Panel kind={other} {...common} ox={side ? m.left + pw + 56 + offX(size) : m.left + offX(size)} oy={side ? m.top : m.top + ph + 64} hoverTip={showTip(other)} />}
      </svg>
      {!compact && (
        <>
          <Readout items={kind === 'roc'
            ? [{ label: 'AUC', value: fmt(auc, 3) }, { label: 'TPR', value: fmt(current.tpr, 3) }, { label: 'FPR', value: fmt(current.fpr, 3) }]
            : [{ label: 'AP', value: fmt(ap, 3) }, { label: 'Precision', value: fmt(current.precision, 3) }, { label: 'Recall', value: fmt(current.recall, 3) }]} />
          {badLabels > 0 && <p className="chart-warning" role="status">레이블이 0 또는 1이 아닌 {badLabels}행을 제외했습니다.</p>}
          <Tooltip tip={tip} width={width} />
        </>
      )}
    </div>
  )
}

export function ClassifierControls({ kind, params, setParams, table, mapping }: ControlsProps<ClassifierParams> & { kind: 'roc' | 'pr' }) {
  const { data } = useMemo(() => scoredRows(table, mapping), [table, mapping])
  const issue = curveIssue(data)
  const points = useMemo(() => (issue ? [] : curvePoints(data)), [data, issue])
  const lo = data.length ? d3.min(data, (d) => d.score)! : 0
  const hi = data.length ? d3.max(data, (d) => d.score)! : 1
  const threshold = Math.min(hi, Math.max(lo, params.threshold))
  const cur = data.length ? pointAt(data, threshold) : null
  const step = (hi - lo) / 200 || 0.01
  return (
    <>
      <ControlGroup title="임계값">
        <Slider label="결정 임계값" value={threshold} min={lo} max={hi} step={step} onChange={(threshold) => setParams({ threshold })} format={(v) => fmt(v, 3)} testId="ctl-threshold" disabled={!!issue} />
        <Hint>점수가 임계값 이상이면 양성으로 예측합니다. 곡선 위의 점은 임계값을 오른쪽에서 왼쪽으로 낮출 때 한 점씩 움직입니다. 곡선을 클릭해도 임계값이 정해집니다.</Hint>
        {cur && (
          <StatTable rows={[['', '실제 양성', '실제 음성'], ['예측 양성', String(cur.tp), String(cur.fp)], ['예측 음성', String(cur.fn), String(cur.tn)]]} caption="혼동행렬" />
        )}
        {cur && <StatTable rows={[['지표', '값'], ['TPR (재현율)', fmt(cur.tpr, 3)], ['FPR', fmt(cur.fpr, 3)], ['정밀도', fmt(cur.precision, 3)], ['정확도', pct((cur.tp + cur.tn) / Math.max(1, data.length))]]} />}
      </ControlGroup>
      <ControlGroup title="표현">
        <Toggle label={kind === 'roc' ? 'PR 곡선과 함께 보기' : 'ROC 곡선과 함께 보기'} checked={params.compare} onChange={(compare) => setParams({ compare })} testId="ctl-compare" />
        <Toggle label={kind === 'roc' ? '무작위 분류 기준선' : '무작위 분류 기준선 (양성 비율)'} checked={params.baseline} onChange={(baseline) => setParams({ baseline })} testId="ctl-baseline" />
        <Toggle label="임계값마다 점 찍기" checked={params.dots} onChange={(dots) => setParams({ dots })} />
        <Toggle label="곡선 아래 칠하기" checked={params.fill} onChange={(fill) => setParams({ fill })} />
      </ControlGroup>
      {!issue && (
        <ControlGroup title="요약" defaultOpen={false}>
          <StatTable rows={[['지표', '값'], ['표본 수', String(data.length)], ['양성 비율', pct(prevalence(data))], ['ROC AUC (사다리꼴)', fmt(rocAuc(points), 4)], ['Average Precision (AP)', fmt(averagePrecision(points), 4)], ['PR AUC (사다리꼴)', fmt(prAucTrapezoid(points), 4)]]} />
          <Hint>AP는 임계값마다 (재현율 증가분 × 정밀도)를 더한 계단식 합이고, PR AUC는 점 사이를 직선으로 이은 사다리꼴 넓이입니다. 둘은 다른 값이며 직선 보간은 정밀도를 낙관적으로 추정할 수 있습니다.</Hint>
        </ControlGroup>
      )}
    </>
  )
}
