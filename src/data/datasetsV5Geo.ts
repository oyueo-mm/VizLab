import { koreaRows, worldRows } from '../geo/data/stats'
import { createRng, round } from '../lib/random'
import { DAY_MS, formatISO } from '../stats/datetime'
import { hillsHeight, type Hill } from '../stats/spatial'
import type { DatasetDef, DatasetId, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const date = (name: string): Column => ({ name, type: 'date' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

/** Real mountains at their approximate locations and heights; the terrain built from them is a smooth synthetic model, not a surveyed elevation grid. */
export const MOUNTAINS: [string, number, number, number, number][] = [
  ['한라산', 33.36, 126.53, 1947, 14], ['지리산', 35.34, 127.73, 1915, 26], ['덕유산', 35.87, 127.75, 1614, 20], ['설악산', 38.12, 128.46, 1708, 20],
  ['오대산', 37.79, 128.54, 1563, 20], ['태백산', 37.1, 128.92, 1567, 24], ['소백산', 36.95, 128.48, 1439, 22], ['속리산', 36.54, 127.87, 1058, 14],
  ['가야산', 35.82, 128.12, 1430, 14], ['계룡산', 36.35, 127.21, 845, 10], ['북한산', 37.66, 126.98, 836, 9], ['무등산', 35.13, 126.99, 1187, 11],
  ['팔공산', 35.99, 128.69, 1193, 12], ['가지산', 35.62, 129.03, 1241, 16], ['치악산', 37.37, 128.05, 1288, 14], ['월악산', 36.86, 128.1, 1097, 11],
]

export const KOREA_HILLS: Hill[] = MOUNTAINS.map(([, lat, lon, height, radiusKm]) => ({ lat, lon, height, radiusKm }))

/** Rough outline of mainland South Korea, used only to place synthetic stations on land. */
const MAINLAND: [number, number][] = [[126.1, 37.8], [126.7, 38.0], [127.5, 38.3], [128.4, 38.6], [128.6, 38.3], [129.1, 37.2], [129.4, 36.0], [129.45, 35.4], [129.1, 35.05], [128.5, 34.8], [127.8, 34.55], [126.9, 34.3], [126.3, 34.6], [126.3, 35.6], [126.6, 36.5], [126.15, 36.9]]
const inPoly = (x: number, y: number, poly: readonly [number, number][]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const onLand = (lon: number, lat: number) => inPoly(lon, lat, MAINLAND) || Math.hypot((lon - 126.55) * 0.82, lat - 33.4) < 0.28

const elevation = hillsHeight(KOREA_HILLS)
/** Smooth synthetic annual-mean temperature (°C): colder to the north and on high ground. */
export const tempField = (lon: number, lat: number) => 15.2 - 0.95 * (lat - 35.5) - 0.0052 * elevation(lon, lat) + 0.7 * Math.sin((lon - 126) * 1.7) - 0.4 * (lon > 128.5 ? 0 : 0.3)

const KR_INDICATORS: Record<string, { aging: number; income: number; trust: number; s1: number; s2: number; s3: number; zone: string }> = {
  'KR-11': { aging: 16.1, income: 4300, trust: 0.95, s1: 0, s2: 8, s3: 92, zone: '수도권' }, 'KR-26': { aging: 19.2, income: 3600, trust: 0.9, s1: 1, s2: 22, s3: 77, zone: '영남권' },
  'KR-27': { aging: 18.0, income: 3500, trust: 0.85, s1: 1, s2: 27, s3: 72, zone: '영남권' }, 'KR-28': { aging: 15.5, income: 3900, trust: 0.9, s1: 1, s2: 28, s3: 71, zone: '수도권' },
  'KR-29': { aging: 15.6, income: 3400, trust: 0.8, s1: 1, s2: 26, s3: 73, zone: '호남권' }, 'KR-30': { aging: 15.2, income: 3600, trust: 0.8, s1: 1, s2: 21, s3: 78, zone: '충청권' },
  'KR-31': { aging: 14.7, income: 4400, trust: 0.75, s1: 1, s2: 52, s3: 47, zone: '영남권' }, 'KR-50': { aging: 11.4, income: 4000, trust: 0.55, s1: 5, s2: 24, s3: 71, zone: '충청권' },
  'KR-41': { aging: 14.5, income: 4000, trust: 0.95, s1: 2, s2: 33, s3: 65, zone: '수도권' }, 'KR-42': { aging: 22.5, income: 3300, trust: 0.6, s1: 9, s2: 17, s3: 74, zone: '강원·제주' },
  'KR-43': { aging: 20.1, income: 3700, trust: 0.6, s1: 8, s2: 41, s3: 51, zone: '충청권' }, 'KR-44': { aging: 20.0, income: 3900, trust: 0.65, s1: 9, s2: 42, s3: 49, zone: '충청권' },
  'KR-45': { aging: 23.1, income: 3300, trust: 0.5, s1: 11, s2: 27, s3: 62, zone: '호남권' }, 'KR-46': { aging: 26.0, income: 3500, trust: 0.45, s1: 14, s2: 26, s3: 60, zone: '호남권' },
  'KR-47': { aging: 24.1, income: 3600, trust: 0.55, s1: 10, s2: 38, s3: 52, zone: '영남권' }, 'KR-48': { aging: 19.6, income: 3700, trust: 0.65, s1: 7, s2: 37, s3: 56, zone: '영남권' },
  'KR-49': { aging: 18.1, income: 3300, trust: 0.4, s1: 12, s2: 5, s3: 83, zone: '강원·제주' },
}

const WAYPOINT: [number, number][] = [[37.57, 126.98], [37.27, 127.03], [36.35, 127.38], [35.87, 128.6], [35.18, 129.08], [35.16, 126.85], [36.8, 127.15]]

/** Approximate population (thousands) of the 17 provinces, used only to size glyphs in the synthetic composition data. */
const KR_POP_K: Record<string, number> = { 'KR-11': 9386, 'KR-26': 3293, 'KR-27': 2371, 'KR-28': 3022, 'KR-29': 1414, 'KR-30': 1438, 'KR-31': 1102, 'KR-50': 387, 'KR-41': 13589, 'KR-42': 1527, 'KR-43': 1595, 'KR-44': 2127, 'KR-45': 1754, 'KR-46': 1790, 'KR-47': 2600, 'KR-48': 3255, 'KR-49': 676 }

export const datasetsV5Geo: DatasetDef[] = [
  {
    id: 'terrain-hills', name: '합성 지형: 산 16곳 (가우시안 모형)', description: '우리나라 주요 산의 대략적인 위치와 높이(m)를 따서, 산마다 가우시안 언덕(반경 km)으로 만든 합성 지형입니다. 실측 고도 자료(DEM)가 아니라 학습용 모형이며, 산 주변의 모양과 골짜기는 실제와 다릅니다. 높이·반경을 고치면 지형이 다시 계산됩니다.',
    generate: () => table([cat('이름'), num('위도'), num('경도'), num('높이'), num('반경')], MOUNTAINS.map(([n, la, lo, h, r]) => [n, la, lo, h, r])),
  },
  {
    id: 'temp-stations', name: '합성 기온 관측점', description: '남한 육지와 제주 위에 임의로 둔 관측점의 연평균 기온(°C)입니다. 위도가 높고 산이 높을수록 낮아지는 매끄러운 모형에 잡음을 더한 합성 값이며 실제 관측값이 아닙니다.',
    size: sizes(70, 12, 400, 2, '관측점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      while (rows.length < n) {
        const lon = 126.1 + r() * 3.4, lat = 33.2 + r() * 5.4
        if (!onLand(lon, lat)) continue
        rows.push([round(lat, 3), round(lon, 3), round(tempField(lon, lat) + r.normal(0, 0.5), 2), `관측점 ${rows.length + 1}`])
      }
      return table([num('위도'), num('경도'), num('값'), cat('이름')], rows)
    },
  },
  {
    id: 'raster-grid', name: '격자 래스터: 합성 기온장', description: '경도 126–130°, 위도 33.5–38.5°를 규칙적인 격자(경도 24 × 위도 20)로 나눈 셀마다 합성 기온을 둔 데이터입니다. 바다와 일부 셀은 값이 없는 결측(NaN)입니다. 한 행이 한 셀입니다.',
    generate: () => {
      const rows: Cell[][] = []
      for (let j = 0; j < 20; j++) for (let i = 0; i < 24; i++) {
        const lon = 126 + (i * 4) / 23, lat = 33.5 + (j * 5) / 19
        const missing = !onLand(lon, lat) || (i * 7 + j * 3) % 29 === 0
        rows.push([round(lat, 4), round(lon, 4), missing ? null : round(tempField(lon, lat), 2)])
      }
      return table([num('위도'), num('경도'), num('값')], rows)
    },
  },
  {
    id: 'wind-sources', name: '합성 바람장: 소용돌이·발원·흡수', description: '태풍처럼 도는 소용돌이, 고기압, 해풍이 나오는 발원점과 빨려드는 흡수점을 합친 합성 바람장입니다. 세기(m/s)가 음수인 소용돌이는 시계 방향입니다. 실제 기상 관측이나 모델 결과가 아닙니다.',
    generate: () => table([cat('종류'), num('위도'), num('경도'), num('세기'), num('반경')], [
      ['소용돌이', 33.2, 128.2, 26, 120], ['소용돌이', 37.6, 127.4, -11, 170], ['발원', 36.0, 125.7, 7, 140], ['흡수', 36.9, 129.8, 6, 110],
    ]),
  },
  {
    id: 'gps-tracks', name: '합성 이동 궤적 (4개체)', description: '네 개체가 일곱 지점을 오가며 만든 합성 이동 기록입니다. 각 행이 한 번의 위치 기록(시각, 위도, 경도)이고 개체마다 속도와 경로가 다릅니다. 실제 사람이나 동물의 위치가 아닙니다.',
    size: sizes(40, 8, 200, 4, '개체당 기록 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      const t0 = Date.UTC(2024, 4, 6, 6, 0)
      for (let a = 0; a < 4; a++) {
        let w = a * 2 % WAYPOINT.length
        let [lat, lon] = WAYPOINT[w]
        let t = t0 + a * 20 * 60000
        let next = (w + 1 + a) % WAYPOINT.length
        for (let k = 0; k < n; k++) {
          rows.push([`개체 ${String.fromCharCode(65 + a)}`, formatISO(t, true), round(lat, 4), round(lon, 4)])
          const [tl, tn] = WAYPOINT[next]
          const dist = Math.hypot((tn - lon) * 0.82, tl - lat)
          const step = 0.03 + 0.012 * a
          if (dist < step * 1.2) { w = next; next = (next + 1 + (a % 2)) % WAYPOINT.length; if (next === w) next = (w + 1) % WAYPOINT.length }
          const [gl, gn] = WAYPOINT[next]
          const ang = Math.atan2(gl - lat, (gn - lon) * 0.82)
          lat += Math.sin(ang) * step + r.normal(0, 0.004)
          lon += (Math.cos(ang) * step) / 0.82 + r.normal(0, 0.004)
          t += (8 + 4 * r()) * 60000
        }
      }
      return table([cat('개체'), date('시각'), num('위도'), num('경도')], rows)
    },
  },
  {
    id: 'spatial-values', name: '합성 공간 값: 핫스팟과 콜드스팟', description: '남한 위 임의의 점 300개에 값을 붙인 합성 데이터입니다. 수도권과 부산 인근에 높은 값의 덩어리, 강원 산지에 낮은 값의 덩어리가 있고 그 밖에는 잡음입니다. 공간 자기상관 분석을 연습하기 위한 것으로, 실제 현상이 아닙니다.',
    size: sizes(300, 60, 1200, 10, '점 개수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      const hot: [number, number, number, number][] = [[37.5, 127.0, 4, 0.55], [35.2, 129.0, 3.2, 0.4], [35.85, 128.6, 2, 0.3], [37.7, 128.5, -3.2, 0.5], [35.0, 127.2, -2.4, 0.4]]
      while (rows.length < n) {
        const lon = 126.2 + r() * 3.2, lat = 33.4 + r() * 5
        if (!onLand(lon, lat)) continue
        let v = 10 + r.normal(0, 1.1)
        for (const [hl, ho, amp, sd] of hot) v += amp * Math.exp(-((lat - hl) ** 2 + ((lon - ho) * 0.82) ** 2) / (2 * sd * sd))
        rows.push([round(lat, 3), round(lon, 3), round(v, 2)])
      }
      return table([num('위도'), num('경도'), num('값')], rows)
    },
  },
  {
    id: 'kr-indicators', name: '시도별 합성 지표', description: '17개 시도의 고령화율(%), 1인당 소득 지수, 조사 신뢰도(0–1), 산업별 비중(%)과 권역입니다. 실제 통계를 흉내 낸 합성 값이며 인용하면 안 됩니다. 신뢰도는 표본이 많을수록 큰 값을 가정했습니다.',
    generate: () => table([cat('지역'), cat('ID'), num('고령화율'), num('소득'), num('신뢰도'), num('1차'), num('2차'), num('3차'), cat('권역')],
      koreaRows.map(([id, ko]) => { const k = KR_INDICATORS[id]; return [ko, id, k.aging, k.income, k.trust, k.s1, k.s2, k.s3, k.zone] })),
  },
  {
    id: 'buffer-features', name: '합성 위치·선형 시설', description: '응급센터 3곳(점)과 하천 하나, 도로 하나(선, 꼭짓점 4개)의 합성 좌표입니다. 같은 이름이 한 행이면 점, 둘 이상이면 그 순서대로 이은 선입니다. 실제 시설이 아닙니다.',
    generate: () => table([cat('이름'), num('위도'), num('경도')], [
      ['응급센터 가', 37.57, 126.98], ['응급센터 나', 35.18, 129.07], ['응급센터 다', 35.16, 126.85],
      ['하천 라', 37.9, 127.7], ['하천 라', 37.6, 127.9], ['하천 라', 37.3, 128.2], ['하천 라', 36.9, 128.6],
      ['도로 마', 35.8, 127.1], ['도로 마', 35.5, 127.6], ['도로 마', 35.1, 128.1], ['도로 마', 34.9, 128.6],
    ]),
  },
  {
    id: 'tissot-grid', name: '티소 지시도 격자 (위도 30° × 경도 30°)', description: '위도 −60°~60°, 경도 −150°~150°를 30° 간격으로 나눈 교점에 반지름 600 km의 작은 원(티소 지시도)을 놓은 표입니다. 위치와 반지름을 고칠 수 있습니다. 지구 위에서는 모두 같은 크기의 원입니다.',
    generate: () => {
      const rows: Cell[][] = []
      for (let la = -60; la <= 60; la += 30) for (let lo = -150; lo <= 150; lo += 30) rows.push([la, lo, 600])
      return table([num('위도'), num('경도'), num('반경')], rows)
    },
  },
  {
    id: 'kr-composition', name: '시도별 산업 구성 (합성)', description: '17개 시도의 인구(천 명, 근삿값)와 1차·2차·3차 산업 비중(%)입니다. 비중은 실제 통계를 흉내 낸 합성 값이며 인용하면 안 됩니다. 지도 위의 작은 차트(파이·도넛·막대)로 구성을 비교하기 위한 데이터입니다.',
    generate: () => table([cat('지역'), cat('ID'), num('규모'), num('1차'), num('2차'), num('3차')], koreaRows.map(([id, ko]) => { const k = KR_INDICATORS[id]; return [ko, id, KR_POP_K[id], k.s1, k.s2, k.s3] })),
  },
  {
    id: 'world-continents', name: '세계 국가와 대륙 (Natural Earth)', description: '176개 국가의 대륙 구분과 인구(백만 명, Natural Earth 추정)입니다. 질적 구역도에서 범주(대륙)별로 색을 칠하는 데 씁니다. 대륙 구분은 데이터에 들어 있는 값을 그대로 썼습니다.',
    generate: () => table([cat('국가'), cat('ID'), cat('대륙'), num('인구')], worldRows.map(([id, ko, , continent, pop]) => [ko, id, continent, pop])),
  },
]

export const v5GeoIds: DatasetId[] = datasetsV5Geo.map((d) => d.id)
void DAY_MS
