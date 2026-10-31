import * as d3 from 'd3'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartMessage, Legend, Readout, Tooltip, localPoint, useSvgId, useTooltip } from '../../components/chart/primitives'
import { ControlGroup, Hint, Select, Slider, Toggle } from '../../components/controls'
import { appendRow, setCell, templateRow } from '../../data/table'
import { MapZoomButtons, useMapZoom } from '../../geo/useMapZoom'
import { schemes, type ColorScheme } from '../../lib/colors'
import { fmt } from '../../lib/format'
import { classBreaks, classIndex, classMethods, normalizeValue, type ClassMethod, type NormalizeMode } from '../../stats/geo'
import { roleColumn } from '../mapping'
import type { ChartProps, ControlsProps, VizModule } from '../types'
import { GeoControls, HatchDefs, geoDefaults, regionData, regionRoles, resolveMap, useProjection, type GeoParams } from './geoShared'

export interface ChoroplethParams extends GeoParams {
  classMethod: 'continuous' | ClassMethod
  classes: number
  scheme: ColorScheme
  normalize: NormalizeMode
  missing: 'hatch' | 'blank'
  borders: boolean
  /** Selected region id. */
  selected: string
}

const SCHEME_KEYS = Object.keys(schemes) as ColorScheme[]

function ChoroplethChart({ table, mapping, params, setParams, width, height, compact, onTableChange, linked }: ChartProps<ChoroplethParams>) {
  const data = useMemo(() => regionData(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  const { map } = resolved
  const projection = useProjection(map, params, width, height, resolved.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoom = useMapZoom(svgRef, { enabled: !compact, width, height })
  const hatch = useSvgId('chor-hatch')
  const { tip, show, hide } = useTooltip()
  const [edit, setEdit] = useState<{ id: string; x: number; y: number } | null>(null)
  const [draft, setDraft] = useState('')
  useEffect(() => { setEdit(null) }, [table, params.map])

  const paths = useMemo(() => { const g = d3.geoPath(projection); return map.regions.map((r) => ({ r, d: g(r.feature) ?? '' })) }, [map, projection])
  const rows = useMemo(() => map.regions.map((r) => {
    const d = data.get(r.id)
    const v = d ? normalizeValue(d.value, params.normalize, r.area, d.base) : null
    return { r, d, v }
  }), [map, data, params.normalize])
  const values = rows.map((x) => x.v).filter((v): v is number => v != null)
  const [lo, hi] = d3.extent(values) as [number, number]
  const scheme = schemes[params.scheme]
  const edges = useMemo(() => (params.classMethod === 'continuous' ? [] : classBreaks(values, params.classMethod, params.classes)), [values.join(','), params.classMethod, params.classes]) // eslint-disable-line react-hooks/exhaustive-deps
  const classes = Math.max(1, edges.length - 1)
  const colorOf = (v: number) => {
    if (params.classMethod === 'continuous') {
      const t = hi === lo ? 0.5 : (v - lo) / (hi - lo)
      return scheme.interpolate(scheme.diverging ? t : 0.08 + 0.92 * t)
    }
    const t = classes === 1 ? 0.5 : classIndex(v, edges) / (classes - 1)
    return scheme.interpolate(scheme.diverging ? t : 0.12 + 0.88 * t)
  }
  const marked = new Set(linked?.rows ?? [])
  const unmatched = [...data.keys()].filter((id) => !map.byId.has(id)).length
  const editable = !!onTableChange && !compact

  const commit = () => {
    if (!edit) return
    const d = data.get(edit.id)
    const vc = roleColumn(mapping, 'value')
    const rc = roleColumn(mapping, 'region')
    if (!vc || !rc) return
    const text = draft.trim()
    const v = text === '' ? null : Number(text.replace(/,/g, ''))
    if (text !== '' && !Number.isFinite(v)) return
    if (d) onTableChange!(setCell(table, d.rows[0], vc, v))
    else if (v != null) onTableChange!(appendRow(table, { ...templateRow(table), [rc]: edit.id, [vc]: v }))
    setEdit(null)
  }
  if (!roleColumn(mapping, 'region') || !roleColumn(mapping, 'value')) return <ChartMessage>지역 ID(범주형)와 값(숫자형) 열을 선택하세요.</ChartMessage>
  if (params.normalize === 'base' && !roleColumn(mapping, 'base')) return <ChartMessage>‘분모’ 열을 선택하거나 다른 정규화를 고르세요.</ChartMessage>
  if (!values.length) return <ChartMessage>지도와 맞는 지역 ID에 값이 없습니다.<small>ID 열이 {map.title}의 ID와 같은지 확인하세요.</small></ChartMessage>

  const k = zoom.t.k
  const fill = (x: (typeof rows)[number]) => (x.v == null ? (params.missing === 'hatch' ? `url(#${hatch})` : '#f6f8f7') : colorOf(x.v))
  const legendItems = params.classMethod === 'continuous' ? [] : edges.slice(0, -1).map((e, i) => ({ key: `${fmt(e, 3)} – ${fmt(edges[i + 1], 3)} (${rows.filter((x) => x.v != null && classIndex(x.v, edges) === i).length})`, color: colorOf(e + (edges[i + 1] - e) / 2) }))

  return (
    <div className="chart-root">
      <svg ref={svgRef} width={width} height={height} className="chart-svg map-svg" role="img" data-testid="chart-svg" data-zoom={k.toFixed(2)} aria-label={`코로플레스 지도: ${map.title}, ${values.length}개 지역에 값`} onPointerLeave={() => { hide(); linked?.set(null) }}>
        <defs><HatchDefs id={hatch} /></defs>
        <g transform={`translate(${zoom.t.x},${zoom.t.y}) scale(${k})`}>
          {paths.map(({ r, d }, i) => {
            const x = rows[i]
            const on = params.selected === r.id || (x.d?.rows.some((q) => marked.has(q)) ?? false)
            return (
              <path key={r.id} className="map-region" data-testid="map-region" data-id={r.id} data-value={x.v ?? ''} d={d} fill={fill(x)} stroke={on ? '#121816' : '#ffffff'} strokeWidth={on ? 1.8 : params.borders ? 0.6 : 0} vectorEffect="non-scaling-stroke"
                onPointerMove={compact ? undefined : (e) => {
                  linked?.set(x.d?.rows ?? null)
                  const p = localPoint(svgRef.current!, e)
                  show(p.x, p.y, <><b>{r.name}</b> <small>{r.id}</small><br />{x.d?.value != null ? <>{roleColumn(mapping, 'value')}: {fmt(x.d.value)}{params.normalize !== 'none' && x.v != null && <><br />{params.normalize === 'area' ? '면적당' : '분모당'}: {fmt(x.v, 4)}</>}</> : '값 없음'}<br />면적 {fmt(r.area, 0)} km²{editable ? <><br />클릭해 선택·값 편집</> : null}</>)
                }}
                onPointerLeave={() => { hide(); linked?.set(null) }}
                onClick={compact ? undefined : (e) => { const p = localPoint(svgRef.current!, e); setParams({ selected: params.selected === r.id && !editable ? '' : r.id }); if (editable) { setEdit({ id: r.id, x: p.x, y: p.y }); setDraft(x.d?.value != null ? String(x.d.value) : ''); hide() } }} />
            )
          })}
        </g>
      </svg>
      {!compact && (
        <>
          {params.classMethod === 'continuous'
            ? (
              <div className="color-legend" aria-label="색상 범례"><span>{fmt(lo, 3)}</span><span className="color-ramp" style={{ background: `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map((v) => scheme.interpolate(scheme.diverging ? v : 0.08 + 0.92 * v)).join(',')})` }} /><span>{fmt(hi, 3)}</span></div>
            )
            : <Legend items={legendItems} title={params.normalize === 'none' ? roleColumn(mapping, 'value') ?? '' : params.normalize === 'area' ? '면적당' : '분모당'} />}
          <Readout items={[{ label: '지역', value: `${values.length} / ${map.regions.length}` }, { label: '범위', value: `${fmt(lo, 3)} – ${fmt(hi, 3)}` }, ...(params.selected && map.byId.get(params.selected) ? [{ label: '선택', value: map.byId.get(params.selected)!.name }] : [])]} />
          <MapZoomButtons zoom={zoom} k={k} />
          {unmatched > 0 && <p className="chart-warning" role="status">지도에 없는 지역 ID {unmatched}개는 그리지 않았습니다.</p>}
          <Tooltip tip={tip} width={width} />
          {edit && (
            <form className="cell-popover" style={{ left: Math.min(width - 200, edit.x), top: edit.y + 10 }} onSubmit={(e) => { e.preventDefault(); commit() }}>
              <label>{map.byId.get(edit.id)?.name} 값</label>
              <input autoFocus type="text" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`${edit.id} 값`} data-testid="map-input" onKeyDown={(e) => { if (e.key === 'Escape') setEdit(null) }} placeholder="비우면 값 삭제" />
              <button type="submit" className="btn btn-primary btn-sm">적용</button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

function ChoroplethControls({ params, setParams, table, mapping }: ControlsProps<ChoroplethParams>) {
  const data = useMemo(() => regionData(table, mapping), [table, mapping])
  const resolved = useMemo(() => resolveMap(params, [...data.keys()]), [params, data])
  const unmatched = [...data.keys()].filter((id) => !resolved.map.byId.has(id)).length
  const method = classMethods.find((m) => m.value === params.classMethod)
  return (
    <>
      <ControlGroup title="지도">
        <GeoControls params={params} setParams={setParams} resolved={resolved} unmatched={unmatched} />
        <Toggle label="지역 경계선" checked={params.borders} onChange={(borders) => setParams({ borders })} />
        <Select label="값 없는 지역" value={params.missing} onChange={(missing) => setParams({ missing })} options={[{ value: 'hatch', label: '빗금' }, { value: 'blank', label: '빈칸' }]} />
      </ControlGroup>
      <ControlGroup title="색상 구분">
        <Select label="분할 기준" value={params.classMethod} onChange={(classMethod) => setParams({ classMethod })} testId="ctl-class-method"
          options={[{ value: 'continuous', label: '연속 (구분 없음)' }, ...classMethods.map((m) => ({ value: m.value as 'continuous' | ClassMethod, label: m.label }))]} />
        {method && <Hint>{method.hint}</Hint>}
        {params.classMethod === 'continuous' && <Hint>값을 구간으로 나누지 않고 최솟값에서 최댓값까지 색이 이어집니다. 작은 차이도 색 차이로 보이지만, 정확한 값을 색으로 읽기는 어렵습니다.</Hint>}
        <Slider label="계급 수" value={params.classes} min={2} max={9} onChange={(classes) => setParams({ classes })} disabled={params.classMethod === 'continuous'} testId="ctl-classes" />
        <Select label="색상 팔레트" value={params.scheme} onChange={(scheme) => setParams({ scheme })} testId="ctl-scheme" options={SCHEME_KEYS.map((k) => ({ value: k, label: schemes[k].name }))} />
      </ControlGroup>
      <ControlGroup title="값 정규화">
        <Select label="색에 쓰는 값" value={params.normalize} onChange={(normalize) => setParams({ normalize })} testId="ctl-normalize"
          options={[{ value: 'none', label: '원래 값 (절댓값)' }, { value: 'area', label: '면적(km²)당' }, { value: 'base', label: '분모 열당 (예: 1인당)' }]} />
        <Hint>인구 같은 절댓값은 큰 지역이 항상 진하게 칠해집니다. 면적이나 인구로 나눈 비율은 ‘얼마나 밀집했는가’를 말하므로, 같은 데이터라도 어느 지역이 두드러지는지가 달라집니다. 분모는 데이터 탭의 ‘열 매핑’에서 지정합니다.</Hint>
      </ControlGroup>
    </>
  )
}

export const choroplethModule: VizModule<ChoroplethParams> = {
  roles: [...regionRoles, { key: 'base', label: '분모 (선택, 예: 인구)', type: 'number' }],
  datasets: ['kr-regions', 'world-regions'],
  defaultParams: { ...geoDefaults, classMethod: 'quantile', classes: 5, scheme: 'teal', normalize: 'none', missing: 'hatch', borders: true, selected: '' },
  Chart: ChoroplethChart,
  Controls: ChoroplethControls,
  hint: '지역을 클릭해 값 편집 · 휠·드래그·핀치로 확대와 이동 · 분할 기준과 투영법을 바꿔 인상이 어떻게 달라지는지 확인',
}
