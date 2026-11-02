import { createRng, round, type Rng } from '../lib/random'
import { datasetsV3 } from './datasetsV3'
import { datasetsV4 } from './datasetsV4'
import { datasetsV5 } from './datasetsV5'
import { datasetsV6 } from './datasetsV6'
import type { DatasetIdV6 } from './datasetIdsV6'
import type { DatasetIdV7 } from './datasetIdsV7'
import type { DatasetIdV8 } from './datasetIdsV8'
import { datasetsV7 } from './datasetsV7'
import { datasetsV7b } from './datasetsV7b'
import { datasetsV8 } from './datasetsV8'
import { datasetsV8b } from './datasetsV8b'
import type { Cell, Column, DataTable } from './table'

export type DatasetId =
  | 'normal' | 'uniform' | 'bimodal' | 'skewed' | 'groups' | 'outliers'
  | 'pos-corr' | 'neg-corr' | 'dense' | 'timeseries' | 'categorical' | 'votes'
  | 'flowers' | 'cars' | 'players' | 'budget' | 'activity'
  | 'temps' | 'before-after' | 'cashflow' | 'streams' | 'league' | 'daily' | 'energy' | 'migration' | 'nutrition'
  | 'visits-dated' | 'sensors' | 'ohlc' | 'forecast' | 'pca-students' | 'pyramid' | 'defects' | 'kpi' | 'stage-flow' | 'network' | 'folders'
  | 'scores' | 'scores-imbalanced' | 'survey' | 'trajectory' | 'big-groups' | 'inventory'
  | 'kr-regions' | 'world-regions' | 'kr-flows' | 'world-flows' | 'geo-points' | 'studies' | 'studies-biased' | 'paired' | 'risk-model' | 'process' | 'process-counts'
  | 'conversion' | 'process-flow' | 'projects' | 'market' | 'profile' | 'affiliations' | 'modules'
  | 'terrain-hills' | 'temp-stations' | 'raster-grid' | 'wind-sources' | 'gps-tracks' | 'spatial-values' | 'kr-indicators' | 'kr-composition' | 'world-continents' | 'buffer-features' | 'tissot-grid'
  | 'regression-demo' | 'survival-trial' | 'process-shift' | 'forecast-overconfident' | 'forecast-calibrated'
  | 'surface-grid' | 'signal-chirp' | 'rp-series' | 'phase-seeds' | 'bifurcation-marks' | 'wind-obs' | 'soil-texture' | 'polar-curves' | 'points-2d' | 'hourly-visits' | 'yield-curves' | 'order-book' | 'spike-trials' | 'event-log' | 'lifelines' | 'kanban'
  | 'de-genes' | 'gwas-synth' | 'binding-sites' | 'coverage-synth' | 'microbiome-dist' | 'expression-matrix' | 'species-dist' | 'set-members'
  | DatasetIdV6
  | DatasetIdV7
  | DatasetIdV8

export interface DatasetSize { min: number; max: number; default: number; step: number; label: string }

export interface DatasetDef {
  id: DatasetId
  name: string
  description: string
  /** Generated datasets can be resampled with a seed and size; fixed ones ignore both. */
  size?: DatasetSize
  generate: (seed: number, n: number) => DataTable
}

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const date = (name: string): Column => ({ name, type: 'date' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })

const sizes = (def: number, min = 10, max = 2000, step = 10, label = '표본 수'): DatasetSize => ({ default: def, min, max, step, label })

/** Box–Muller pair with correlation ρ. */
function correlated(rng: Rng, rho: number): [number, number] {
  const a = rng.normal()
  const b = rng.normal()
  return [a, rho * a + Math.sqrt(1 - rho * rho) * b]
}

const univariate = (n: number, sample: () => number) => table([num('값')], Array.from({ length: n }, () => [round(sample(), 2)]))

export const datasets: DatasetDef[] = [
  {
    id: 'normal', name: '정규분포', description: '평균 50, 표준편차 10인 정규분포에서 뽑은 표본입니다.', size: sizes(200),
    generate: (seed, n) => { const r = createRng(seed); return univariate(n, () => r.normal(50, 10)) },
  },
  {
    id: 'uniform', name: '균등분포', description: '0부터 100 사이에서 모든 값이 같은 확률로 나오는 표본입니다.', size: sizes(200),
    generate: (seed, n) => { const r = createRng(seed); return univariate(n, () => r() * 100) },
  },
  {
    id: 'bimodal', name: '이봉분포', description: '평균 35와 68을 중심으로 두 봉우리가 있는 혼합 정규분포 표본입니다.', size: sizes(240),
    generate: (seed, n) => { const r = createRng(seed); return univariate(n, () => (r() < 0.55 ? r.normal(35, 6) : r.normal(68, 8))) },
  },
  {
    id: 'skewed', name: '치우친 분포', description: '오른쪽으로 긴 꼬리를 갖는 로그정규분포 표본입니다 (예: 소득, 대기 시간).', size: sizes(200),
    generate: (seed, n) => { const r = createRng(seed); return univariate(n, () => Math.exp(r.normal(3.2, 0.5))) },
  },
  {
    id: 'groups', name: '그룹별 점수', description: '네 반의 시험 점수입니다. 반마다 평균·퍼짐·모양이 다릅니다 (D반은 이봉형).', size: sizes(160, 20, 2000, 4, '전체 학생 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const groups = ['A반', 'B반', 'C반', 'D반']
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const g = groups[i % 4]
        let v = g === 'A반' ? r.normal(72, 8) : g === 'B반' ? r.normal(64, 14) : g === 'C반' ? r.normal(80, 5) : r() < 0.5 ? r.normal(55, 6) : r.normal(85, 5)
        v = Math.max(0, Math.min(100, v))
        rows.push([g, round(v, 1)])
      }
      return table([cat('반'), num('점수')], rows)
    },
  },
  {
    id: 'outliers', name: '이상치가 포함된 데이터', description: '세 생산 라인의 부품 무게입니다. 약 5%는 측정 오류처럼 크게 벗어난 값입니다.', size: sizes(150, 15, 2000, 3, '측정 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const lines = ['1라인', '2라인', '3라인']
      const base = [100, 104, 98]
      const sd = [3, 5, 2.5]
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const k = i % 3
        let v = r.normal(base[k], sd[k])
        if (r() < 0.05) v += (r() < 0.5 ? -1 : 1) * (18 + r() * 14)
        rows.push([lines[k], round(v, 2)])
      }
      return table([cat('라인'), num('무게')], rows)
    },
  },
  {
    id: 'pos-corr', name: '양의 상관관계', description: '광고비가 늘수록 매출도 늘어나는 경향(ρ ≈ 0.8)을 가진 매장 데이터입니다.', size: sizes(80, 5, 1000, 5, '매장 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const regions = ['수도권', '영남', '호남', '충청']
      const rows: Cell[][] = Array.from({ length: n }, () => {
        const [a, b] = correlated(r, 0.8)
        const staff = Math.max(3, Math.round(12 + 4 * a + r.normal(0, 3)))
        return [round(50 + 15 * a, 1), round(120 + 30 * b, 1), staff, r.pick(regions)]
      })
      return table([num('광고비'), num('매출'), num('직원 수'), cat('지역')], rows)
    },
  },
  {
    id: 'neg-corr', name: '음의 상관관계', description: '가격이 높을수록 판매량이 줄어드는 경향(ρ ≈ −0.75)을 가진 제품 데이터입니다.', size: sizes(80, 5, 1000, 5, '제품 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const channels = ['온라인', '오프라인']
      const rows: Cell[][] = Array.from({ length: n }, () => {
        const [a, b] = correlated(r, -0.75)
        return [round(Math.max(1, 30 + 8 * a), 1), Math.max(0, Math.round(500 + 120 * b)), Math.max(1, Math.round(40 + 15 * r.normal())), r.pick(channels)]
      })
      return table([num('가격'), num('판매량'), num('재고'), cat('채널')], rows)
    },
  },
  {
    id: 'dense', name: '대규모 2차원 데이터', description: '세 개의 군집이 겹쳐 있는 2차원 점 데이터입니다. 점이 많아 겹침이 심합니다.', size: sizes(2500, 100, 20000, 100, '점 개수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const centers = [[30, 35, 8, 0.6], [62, 60, 10, -0.3], [45, 75, 5, 0.2]]
      const rows: Cell[][] = Array.from({ length: n }, () => {
        const c = centers[r() < 0.5 ? 0 : r() < 0.6 ? 1 : 2]
        const [a, b] = correlated(r, c[3])
        return [round(c[0] + c[2] * a, 2), round(c[1] + c[2] * b, 2)]
      })
      return table([num('x'), num('y')], rows)
    },
  },
  {
    id: 'timeseries', name: '시계열 데이터', description: '세 유입 채널의 월별 방문자 수입니다. 추세·계절성·잡음이 섞여 있습니다.', size: sizes(36, 6, 240, 6, '개월 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const series = [
        { name: '검색', base: 1200, trend: 18, amp: 220 },
        { name: 'SNS', base: 600, trend: 30, amp: 120 },
        { name: '직접 유입', base: 900, trend: 4, amp: 60 },
      ]
      const rows: Cell[][] = []
      for (let m = 1; m <= n; m++)
        for (const s of series) {
          const seasonal = s.amp * Math.sin(((m - 1) / 12) * 2 * Math.PI)
          rows.push([m, s.name, Math.max(0, Math.round(s.base + s.trend * m + seasonal + r.normal(0, s.amp * 0.35)))])
        }
      return table([num('월'), cat('채널'), num('방문자')], rows)
    },
  },
  {
    id: 'categorical', name: '범주형 데이터', description: '다섯 제품의 분기별 판매량(천 대)입니다. 제품 × 분기마다 한 행씩 있습니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const products = ['노트북', '태블릿', '스마트폰', '이어폰', '스마트워치']
      const base = [42, 28, 95, 60, 22]
      const growth = [1.02, 0.97, 1.04, 1.12, 1.18]
      const rows: Cell[][] = []
      products.forEach((p, i) => {
        for (let q = 0; q < 4; q++) rows.push([p, `${q + 1}분기`, Math.round(base[i] * growth[i] ** q * (0.9 + 0.2 * r()))])
      })
      return table([cat('제품'), cat('분기'), num('판매량')], rows)
    },
  },
  {
    id: 'votes', name: '선호도 조사', description: '좋아하는 과일을 하나씩 고른 설문 응답 수입니다. 범주마다 한 행입니다.',
    generate: () =>
      table([cat('과일'), num('응답 수')], [['사과', 48], ['바나나', 31], ['딸기', 66], ['포도', 27], ['귤', 39], ['수박', 22], ['복숭아', 17]]),
  },
  {
    id: 'flowers', name: '다변량 데이터: 꽃 측정값', description: '세 품종의 꽃받침·꽃잎 길이와 너비(cm)를 모방한 합성 데이터입니다.', size: sizes(150, 15, 1500, 15, '꽃 개수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const species = [
        { name: '품종 A', m: [5.0, 3.4, 1.5, 0.25], s: [0.35, 0.38, 0.17, 0.1] },
        { name: '품종 B', m: [5.9, 2.8, 4.3, 1.3], s: [0.5, 0.31, 0.47, 0.2] },
        { name: '품종 C', m: [6.6, 3.0, 5.55, 2.0], s: [0.63, 0.32, 0.55, 0.27] },
      ]
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const sp = species[i % 3]
        // A shared "size" factor induces realistic within-species correlation between measurements.
        const size = r.normal()
        const v = sp.m.map((m, k) => round(Math.max(0.1, m + sp.s[k] * (0.6 * size + 0.8 * r.normal())), 1))
        rows.push([sp.name, ...v])
      }
      return table([cat('품종'), num('꽃받침 길이'), num('꽃받침 너비'), num('꽃잎 길이'), num('꽃잎 너비')], rows)
    },
  },
  {
    id: 'cars', name: '다변량 데이터: 자동차 성능', description: '배기량·마력·무게·연비·가속 시간이 서로 얽혀 있는 합성 자동차 데이터입니다.', size: sizes(90, 10, 1000, 10, '차량 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const types = ['경차', '세단', 'SUV']
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const t = i % 3
        const sizeFactor = [-1.1, 0, 1][t] + 0.45 * r.normal()
        const disp = Math.max(800, 1900 + 650 * sizeFactor + 150 * r.normal())
        const hp = Math.max(60, 150 + 55 * sizeFactor + 15 * r.normal())
        const weight = Math.max(800, 1500 + 330 * sizeFactor + 80 * r.normal())
        const mpg = Math.max(5, 14 - 3.1 * sizeFactor + 1.1 * r.normal())
        const accel = Math.max(5, 10.5 - 1.6 * (hp - 150) / 55 + 0.6 * r.normal() + 0.4 * sizeFactor)
        return [types[t], Math.round(disp), Math.round(hp), Math.round(weight), round(mpg, 1), round(accel, 1)]
      })
      return table([cat('차종'), num('배기량'), num('마력'), num('무게'), num('연비'), num('가속 시간')], rows)
    },
  },
  {
    id: 'players', name: '선수 능력치', description: '세 선수의 여섯 가지 능력을 0–100 점수로 평가한 데이터입니다.',
    generate: () =>
      table([cat('선수'), num('속도'), num('힘'), num('기술'), num('체력'), num('시야'), num('수비')], [
        ['선수 A', 88, 62, 79, 74, 70, 45],
        ['선수 B', 60, 85, 58, 82, 55, 90],
        ['선수 C', 72, 70, 92, 65, 88, 60],
      ]),
  },
  {
    id: 'budget', name: '계층형 데이터', description: '가상 회사의 연간 예산(억 원)을 부문 › 부서 › 항목의 3단계로 나눈 데이터입니다.',
    generate: () => {
      const spec: [string, string, [string, number][]][] = [
        ['연구개발', '플랫폼', [['인건비', 42], ['장비', 15], ['클라우드', 22]]],
        ['연구개발', '신사업', [['인건비', 18], ['시제품', 9], ['외주', 6]]],
        ['연구개발', '데이터', [['인건비', 16], ['클라우드', 12]]],
        ['영업', '국내 영업', [['인건비', 24], ['출장', 6], ['판촉', 10]]],
        ['영업', '해외 영업', [['인건비', 14], ['출장', 9], ['현지 법인', 12]]],
        ['마케팅', '브랜드', [['광고', 26], ['행사', 8]]],
        ['마케팅', '디지털', [['검색 광고', 14], ['SNS 광고', 11], ['콘텐츠', 5]]],
        ['경영지원', '인사', [['교육', 6], ['복리후생', 9]]],
        ['경영지원', '재무', [['감사', 3], ['시스템', 4]]],
        ['경영지원', '총무', [['임대료', 17], ['시설', 5]]],
      ]
      const rows: Cell[][] = []
      for (const [a, b, items] of spec) for (const [c, v] of items) rows.push([a, b, c, v])
      return table([cat('부문'), cat('부서'), cat('항목'), num('예산')], rows)
    },
  },
  {
    id: 'activity', name: '행렬 데이터: 요일 × 시간대', description: '요일과 시간대별 평균 앱 접속자 수(백 명)입니다. 각 행이 요일, 각 열이 시간대입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const days = ['월', '화', '수', '목', '금', '토', '일']
      const hours = [6, 9, 12, 15, 18, 21, 24]
      const rows: Cell[][] = days.map((d, di) => {
        const weekend = di >= 5
        return [d, ...hours.map((h) => {
          const commute = weekend ? 0 : 14 * Math.exp(-(((h - 9) / 1.6) ** 2)) + 12 * Math.exp(-(((h - 18) / 1.6) ** 2))
          const evening = (weekend ? 20 : 16) * Math.exp(-(((h - 21) / 2.5) ** 2))
          const midday = (weekend ? 18 : 9) * Math.exp(-(((h - 13) / 3) ** 2))
          return round(4 + commute + evening + midday + r.normal(0, 1.2), 1)
        })]
      })
      return table([cat('요일'), ...hours.map((h) => num(`${h}시`))], rows)
    },
  },
  {
    id: 'temps', name: '월별 기온 분포', description: '서울의 계절 변화를 본뜬 월별 일 최고기온(°C) 합성 데이터입니다. 달마다 분포의 위치와 퍼짐이 다릅니다.', size: sizes(360, 48, 3600, 12, '관측 일수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const mu = [1.6, 4.6, 11.0, 18.1, 23.6, 27.4, 29.3, 30.4, 26.4, 20.3, 11.9, 4.2]
      const sd = [4.2, 4.4, 4.6, 4.1, 3.4, 2.8, 2.6, 2.4, 2.9, 3.4, 4.3, 4.4]
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const m = i % 12
        return [`${m + 1}월`, round(r.normal(mu[m], sd[m]), 1)]
      })
      return table([cat('월'), num('최고기온')], rows)
    },
  },
  {
    id: 'before-after', name: '두 시점 비교', description: '가상 회사의 팀별 직원 만족도 점수(100점 만점)를 작년과 올해 두 번 조사한 결과입니다.',
    generate: () =>
      table([cat('팀'), num('작년'), num('올해')], [
        ['기획', 62, 71], ['개발', 70, 74], ['디자인', 75, 69], ['영업', 58, 66],
        ['마케팅', 66, 63], ['인사', 72, 78], ['재무', 64, 65], ['고객지원', 55, 68],
      ]),
  },
  {
    id: 'cashflow', name: '손익 항목', description: '가상 회사의 분기 손익 항목(억 원)입니다. 양수는 이익을 늘리고 음수는 줄입니다.',
    generate: () =>
      table([cat('항목'), num('증감')], [
        ['매출', 420], ['매출원가', -185], ['인건비', -96], ['마케팅비', -38], ['임대료', -22], ['기타 수익', 17], ['이자 비용', -9], ['법인세', -21],
      ]),
  },
  {
    id: 'streams', name: '장르별 주간 재생 수', description: '가상 음원 서비스의 여섯 장르별 주간 재생 수(만 회)입니다. 장르마다 유행 시기가 다릅니다.', size: sizes(40, 8, 156, 4, '주 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const genres: { name: string; base: number; peaks: [number, number][] }[] = [
        { name: '발라드', base: 38, peaks: [[0.15, 22], [0.8, 16]] },
        { name: '힙합', base: 26, peaks: [[0.45, 30]] },
        { name: '댄스', base: 30, peaks: [[0.3, 18], [0.65, 24]] },
        { name: '록', base: 14, peaks: [[0.55, 12]] },
        { name: '재즈', base: 9, peaks: [[0.9, 8]] },
        { name: '트로트', base: 18, peaks: [[0.05, 10], [0.5, 14]] },
      ]
      const rows: Cell[][] = []
      for (let w = 1; w <= n; w++) {
        const t = (w - 1) / Math.max(1, n - 1)
        for (const g of genres) {
          const bump = g.peaks.reduce((s, [c, a]) => s + a * Math.exp(-(((t - c) / 0.09) ** 2)), 0)
          rows.push([w, g.name, round(Math.max(0, g.base + bump + r.normal(0, g.base * 0.08)), 1)])
        }
      }
      return table([num('주'), cat('장르'), num('재생 수')], rows)
    },
  },
  {
    id: 'league', name: '리그 순위표', description: '가상 축구 리그 여덟 팀의 라운드별 누적 승점입니다 (승 3점, 무 1점, 패 0점). 승점이 같은 팀이 자주 나옵니다.', size: sizes(14, 4, 38, 1, '라운드 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const teams = ['가람', '나래', '다솜', '라온', '마루', '바다', '새봄', '아라']
      const strength = teams.map(() => r.normal(0, 0.6))
      const points = teams.map(() => 0)
      const rows: Cell[][] = []
      for (let round = 1; round <= n; round++) {
        // Fisher–Yates shuffle pairs the teams differently every round.
        const order = teams.map((_, i) => i)
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
        for (let k = 0; k < order.length; k += 2) {
          const a = order[k]
          const b = order[k + 1]
          const diff = strength[a] - strength[b] + r.normal(0, 1)
          if (diff > 0.45) points[a] += 3
          else if (diff < -0.45) points[b] += 3
          else { points[a] += 1; points[b] += 1 }
        }
        teams.forEach((t, i) => rows.push([round, t, points[i]]))
      }
      return table([num('라운드'), cat('팀'), num('승점')], rows)
    },
  },
  {
    id: 'daily', name: '일별 걸음 수', description: '2023년 1월 1일부터 2024년 12월 31일까지(2024년은 윤년) 한 사람의 하루 걸음 수 합성 데이터입니다. 기록이 빠진 날이 있습니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2024, 11, 31); t += 86400000) {
        const d = new Date(t)
        if (r() < 0.035) continue
        const dow = d.getUTCDay()
        const doy = (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000
        const season = 1200 * Math.cos(((doy - 130) / 365) * 2 * Math.PI)
        const weekend = dow === 0 ? -1800 : dow === 6 ? 1500 : 0
        rows.push([d.toISOString().slice(0, 10), Math.round(Math.max(300, 7600 + season + weekend + r.normal(0, 1900)))])
      }
      return table([date('날짜'), num('걸음 수')], rows)
    },
  },
  {
    id: 'energy', name: '흐름 데이터: 에너지', description: '가상 국가의 에너지가 원천에서 전력·직접 연소를 거쳐 용도로 흘러가는 양(PJ)입니다. 중간 노드에서는 들어온 양과 나간 양이 같습니다.',
    generate: () =>
      table([cat('출발'), cat('도착'), num('양')], [
        ['석탄', '전력', 40], ['천연가스', '전력', 28], ['천연가스', '직접 연소', 22], ['원자력', '전력', 30], ['재생에너지', '전력', 12], ['석유', '직접 연소', 48],
        ['전력', '가정', 26], ['전력', '상업', 24], ['전력', '산업', 44], ['전력', '손실', 16],
        ['직접 연소', '산업', 22], ['직접 연소', '수송', 38], ['직접 연소', '가정', 10],
      ]),
  },
  {
    id: 'migration', name: '관계 행렬: 지역 간 이동', description: '가상 국가의 다섯 지역 사이 연간 이동 인구(천 명)입니다. 행이 출발 지역, 열이 도착 지역이며 같은 지역 안 이동(대각선)은 0입니다.',
    generate: () => {
      const regions = ['수도권', '충청', '호남', '영남', '강원']
      const m = [
        [0, 62, 38, 71, 24],
        [70, 0, 12, 14, 5],
        [44, 11, 0, 9, 2],
        [79, 13, 8, 0, 6],
        [27, 4, 2, 5, 0],
      ]
      return table([cat('출발 지역'), ...regions.map(num)], regions.map((name, i) => [name, ...m[i]]))
    },
  },
  {
    id: 'nutrition', name: '과일 영양 성분', description: '열네 가지 과일의 100g당 영양 성분 근삿값입니다 (공개 영양 성분표 참고, 품종·숙성도에 따라 달라집니다). 단위: 열량 kcal, 당류·식이섬유 g, 비타민C·칼륨 mg.',
    generate: () =>
      table([cat('과일'), num('열량'), num('당류'), num('식이섬유'), num('비타민C'), num('칼륨')], [
        ['사과', 52, 10.4, 2.4, 4.6, 107], ['바나나', 89, 12.2, 2.6, 8.7, 358], ['딸기', 32, 4.9, 2.0, 58.8, 153], ['포도', 69, 15.5, 0.9, 3.2, 191],
        ['귤', 53, 10.6, 1.8, 26.7, 166], ['오렌지', 47, 9.4, 2.4, 53.2, 181], ['키위', 61, 9.0, 3.0, 92.7, 312], ['블루베리', 57, 10.0, 2.4, 9.7, 77],
        ['수박', 30, 6.2, 0.4, 8.1, 112], ['망고', 60, 13.7, 1.6, 36.4, 168], ['아보카도', 160, 0.7, 6.7, 10.0, 485], ['배', 57, 9.8, 3.1, 4.3, 116],
        ['복숭아', 39, 8.4, 1.5, 6.6, 190], ['파인애플', 50, 9.9, 1.4, 47.8, 109],
      ]),
  },
  ...datasetsV3,
  ...datasetsV4,
  ...datasetsV5,
  ...datasetsV6,
  ...datasetsV7,
  ...datasetsV7b,
  ...datasetsV8,
  ...datasetsV8b,
]

export const datasetById = new Map(datasets.map((d) => [d.id, d]))
export const DEFAULT_SEED = 7

export function generateDataset(id: DatasetId, seed = DEFAULT_SEED, n?: number): DataTable {
  const def = datasetById.get(id)
  if (!def) throw new Error(`알 수 없는 데이터셋: ${id}`)
  const size = def.size ? Math.max(def.size.min, Math.min(def.size.max, n ?? def.size.default)) : 0
  return def.generate(seed, size)
}
