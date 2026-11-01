import { createRng, round } from '../lib/random'
import { localKm, simulateField } from '../stats/geostat'
import { onLand } from './datasetsV5Geo'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

function landPoints(n: number, seed: number): { lon: number; lat: number }[] {
  const r = createRng(seed), out: { lon: number; lat: number }[] = []
  while (out.length < n) { const lon = 126.3 + r() * 3.1, lat = 34.4 + r() * 3.7; if (onLand(lon, lat)) out.push({ lon, lat }) }
  return out
}

const fieldCache = new Map<string, DataTable>()
function fieldTable(seed: number, n: number, opts: { range: number; ratio: number; angle: number; mean: number; sill: number; nugget: number }): DataTable {
  const key = `${seed}|${n}|${JSON.stringify(opts)}`
  const hit = fieldCache.get(key)
  if (hit) return hit
  const pts = landPoints(n, seed)
  const km = localKm(pts)
  const z = simulateField(pts.map((p) => km.to(p.lon, p.lat)), { ...opts, seed: seed + 1 })
  const t = table([num('위도'), num('경도'), num('값')], pts.map((p, i) => [round(p.lat, 3), round(p.lon, 3), round(z[i], 2)]))
  fieldCache.set(key, t)
  return t
}

/** Geostatistics example data (all synthetic, generated on the south-Korean land mask). */
export const datasetsV6Geo: DatasetDef[] = [
  {
    id: 'geo-field-iso', name: '등방성 공간 상관 값 (합성 측정소)', description: '남한 위의 측정소에서 잰 값을 흉내 낸 합성 데이터입니다. 거리에 따라 상관이 지수적으로 줄어드는(실효 범위 약 150 km, 너깃 5%) 가우시안 확률장에서 뽑았으며 모든 방향으로 같은 범위를 갖습니다. 값은 미세먼지 농도처럼 평균 25, 표준편차 약 5로 맞췄습니다. 실제 관측이 아닙니다.',
    size: sizes(110, 40, 180, 10, '측정소 수'),
    generate: (seed, n) => { const t = fieldTable(seed, n, { range: 150, ratio: 1, angle: 0, mean: 25, sill: 25, nugget: 1.5 }); return t },
  },
  {
    id: 'geo-field-aniso', name: '방향 의존(이방성) 공간 상관 값 (합성)', description: '북동–남서(45°) 방향으로는 상관이 멀리 이어지고 그 수직 방향으로는 짧게 끝나는 이방성 가우시안 확률장의 합성 측정값입니다(긴 축 범위 약 220 km, 짧은 축은 그 30%). 한 방향의 분산도만 보면 놓치는 구조를 방향별 분산도로 확인하기 위한 합성 데이터입니다.',
    size: sizes(130, 60, 190, 10, '측정소 수'),
    generate: (seed, n) => fieldTable(seed + 100, n, { range: 220, ratio: 0.3, angle: 45, mean: 25, sill: 25, nugget: 0.8 }),
  },
  {
    id: 'events-spacetime', name: '이동하는 핫스팟의 사건 기록 (합성)', description: '60일 동안 서울 부근에서 시작해 대전을 거쳐 부산 쪽으로 옮겨 가는 사건 밀집과 전국에 흩어진 배경 사건을 섞어 만든 합성 데이터입니다. 한 행이 사건 하나(위도, 경도, 발생일)입니다. 공간만 보면 세 도시가 모두 뜨겁지만 시간까지 보면 시기가 다릅니다.',
    size: sizes(420, 100, 900, 20, '사건 수'),
    generate: (seed, n) => {
      const r = createRng(seed), rows: Cell[][] = []
      const path: [number, number][] = [[37.55, 127.0], [36.35, 127.4], [35.15, 129.05]]
      while (rows.length < n) {
        if (r() < 0.65) {
          const day = r() * 60, f = day / 60 * 2, i = Math.min(1, Math.floor(f)), w = f - i
          const lat = path[i][0] + (path[i + 1][0] - path[i][0]) * w + r.normal(0, 0.22), lon = path[i][1] + (path[i + 1][1] - path[i][1]) * w + r.normal(0, 0.25)
          if (onLand(lon, lat)) rows.push([round(lat, 3), round(lon, 3), round(day, 1)])
        } else { const lon = 126.3 + r() * 3.1, lat = 34.4 + r() * 3.7; if (onLand(lon, lat)) rows.push([round(lat, 3), round(lon, 3), round(r() * 60, 1)]) }
      }
      return table([num('위도'), num('경도'), num('발생일')], rows)
    },
  },
  {
    id: 'case-control', name: '환자–대조군 위치 (합성)', description: '질병 발생(환자)과 같은 지역의 건강한 사람(대조군)의 위치를 흉내 낸 합성 데이터입니다. 환자의 일부는 대전 부근에 몰리고 나머지는 대조군처럼 인구가 많은 곳에 흩어져 있어, 인구 분포를 고려한 ‘상대 위험’의 지도를 그릴 수 있습니다. 실제 환자 자료가 아닙니다.',
    size: sizes(240, 80, 500, 20, '대조군 수'),
    generate: (seed, n) => {
      const r = createRng(seed), rows: Cell[][] = []
      const centers: [number, number, number][] = [[37.55, 127.0, 0.35], [35.15, 129.05, 0.2], [35.85, 128.6, 0.15], [36.35, 127.4, 0.1], [35.15, 126.85, 0.12], [37.45, 126.7, 0.08]]
      const pick = () => { let u = r(); for (const c of centers) { u -= c[2]; if (u <= 0) return c } return centers[0] }
      const draw = (cl: [number, number, number]): [number, number] | null => { const lat = cl[0] + r.normal(0, 0.3), lon = cl[1] + r.normal(0, 0.35); return onLand(lon, lat) ? [lat, lon] : null }
      let c = 0
      while (c < n) { const p = draw(pick()); if (p) { rows.push([round(p[0], 3), round(p[1], 3), '대조군']); c++ } }
      const nc = Math.round(n * 0.45)
      let k = 0
      while (k < nc) {
        const hot = r() < 0.5
        const p = hot ? (() => { const lat = 36.35 + r.normal(0, 0.18), lon = 127.4 + r.normal(0, 0.2); return onLand(lon, lat) ? [lat, lon] as [number, number] : null })() : draw(pick())
        if (p) { rows.push([round(p[0], 3), round(p[1], 3), '환자']); k++ }
      }
      return table([num('위도'), num('경도'), cat('집단')], rows)
    },
  },
]
