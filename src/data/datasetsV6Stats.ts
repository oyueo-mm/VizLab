import { createRng, round } from '../lib/random'
import { addMonths, formatISO } from '../stats/datetime'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const date = (name: string): Column => ({ name, type: 'date' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

/** Time-series, Bayesian, survival and extreme-value example data. All are synthetic. */
export const datasetsV6Stats: DatasetDef[] = [
  {
    id: 'ts-seasonal', name: '월별 판매량 (합성: 추세 + 계절 + 잡음)', description: '2015년 1월부터 시작하는 월별 판매량입니다. 선형 추세 위에 연 주기(12개월)의 계절 변동과 무작위 잡음을 더해 만든 합성 데이터이며, 계절 변동은 해마다 조금씩 커지도록 했습니다. 실제 매출이 아닙니다.',
    size: sizes(120, 36, 240, 12, '개월 수'),
    generate: (seed, n) => {
      const r = createRng(seed), t0 = Date.UTC(2015, 0, 1)
      return table([date('월'), num('판매량')], Array.from({ length: n }, (_, t) => [formatISO(addMonths(t0, t)), round(200 + 1.6 * t + (28 + 0.12 * t) * Math.sin((2 * Math.PI * (t - 2)) / 12) + 9 * Math.cos((4 * Math.PI * t) / 12) + r.normal(0, 7), 1)]))
    },
  },
  {
    id: 'ts-ar2', name: '준주기적 시계열 (합성 AR(2))', description: '2차 자기회귀 과정 x_t = 1.4·x_{t−1} − 0.75·x_{t−2} + 잡음에서 만든 시계열입니다. 약 11시점 주기로 흔들리며 차츰 흩어지는 모양이라 자기상관이 사인파처럼 감쇠하고 편자기상관은 2시차에서 끊깁니다. 합성 데이터입니다.',
    size: sizes(240, 60, 800, 20, '시점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const x = [0, 0]
      for (let t = 2; t < n + 50; t++) x.push(1.4 * x[t - 1] - 0.75 * x[t - 2] + r.normal())
      return table([num('시점'), num('값')], x.slice(50).map((v, i) => [i + 1, round(v, 3)]))
    },
  },
  {
    id: 'ts-hourly', name: '시간별 방문 수 (합성, 4주)', description: '2024년 3월 4일(월)부터 시간 단위로 기록한 방문 수입니다. 하루 중 낮에 많고 주말에는 적은 이중 주기(24시간, 7일)에 잡음을 더해 만든 합성 데이터입니다. 계절 부분계열 도표를 요일·시간 단위로 묶어 볼 수 있습니다.',
    size: sizes(672, 168, 1344, 168, '시간 수'),
    generate: (seed, n) => {
      const r = createRng(seed), t0 = Date.UTC(2024, 2, 4)
      return table([date('시각'), num('방문 수')], Array.from({ length: n }, (_, h) => { const hr = h % 24, dow = Math.floor(h / 24) % 7; const day = Math.max(0, Math.sin(((hr - 6) / 24) * 2 * Math.PI * 1)); return [formatISO(t0 + h * 3600000, true), Math.max(0, Math.round((dow >= 5 ? 40 : 70) * (0.25 + day) + r.normal(0, 6)))] }))
    },
  },
  {
    id: 'ts-pair', name: '선행·후행 두 시계열 (합성)', description: '두 계열 중 하나(선행 지표)가 4시점 뒤에 다른 계열(결과)에 영향을 주도록 만든 합성 데이터입니다. 선행 지표는 AR(1) 과정이며 결과 = 0.8 × (4시점 전의 선행 지표) + 잡음입니다.',
    size: sizes(200, 60, 600, 20, '시점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const x: number[] = [0]
      for (let t = 1; t < n; t++) x.push(0.75 * x[t - 1] + r.normal())
      return table([num('시점'), num('선행 지표'), num('결과')], x.map((v, t) => [t + 1, round(v, 3), round(0.8 * (t >= 4 ? x[t - 4] : 0) + r.normal(0, 0.6), 3)]))
    },
  },
  {
    id: 'bayes-sample', name: '정밀 측정값 (합성 정규)', description: '평균 50, 표준편차 8인 정규분포에서 뽑은 측정값입니다. 표본이 적을수록 평균의 사후분포가 넓습니다. 합성 데이터입니다.',
    size: sizes(30, 5, 300, 5, '측정 수'),
    generate: (seed, n) => { const r = createRng(seed); return table([num('측정값')], Array.from({ length: n }, () => [round(r.normal(50, 8), 2)])) },
  },
  {
    id: 'bayes-skewed', name: '오른쪽으로 치우친 측정값 (합성 로그정규)', description: '로그정규분포에서 뽑은 오른쪽으로 긴 꼬리를 가진 값입니다(예: 대기 시간, 소득). 정규분포 모형은 이 치우침을 설명하지 못하므로 사후예측 점검에서 모형의 한계가 드러납니다. 합성 데이터입니다.',
    size: sizes(80, 20, 400, 10, '측정 수'),
    generate: (seed, n) => { const r = createRng(seed); return table([num('대기 시간')], Array.from({ length: n }, () => [round(Math.exp(r.normal(2.4, 0.6)), 2)])) },
  },
  {
    id: 'bayes-trials', name: '성공·실패 시행 기록 (합성)', description: '참 성공 확률이 0.35인 베르누이 시행을 순서대로 기록한 것입니다(1 = 성공, 0 = 실패). 사전분포와 관측이 합쳐져 사후분포가 되는 과정을 시행 수를 늘려 가며 볼 수 있습니다. 합성 데이터입니다.',
    size: sizes(40, 5, 400, 5, '시행 수'),
    generate: (seed, n) => { const r = createRng(seed); return table([num('시행'), num('성공')], Array.from({ length: n }, (_, i) => [i + 1, r() < 0.35 ? 1 : 0])) },
  },
  {
    id: 'bayes-counts', name: '일별 사건 건수 (합성 푸아송)', description: '하루에 일어난 사건 건수입니다. 참 발생률이 하루 평균 3.2건인 푸아송 분포에서 뽑았습니다. 합성 데이터입니다.',
    size: sizes(30, 5, 300, 5, '관측 일수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('일'), num('건수')], Array.from({ length: n }, (_, i) => { const L = Math.exp(-3.2); let k = 0, p = 1; do { k++; p *= r() } while (p > L); return [i + 1, k - 1] }))
    },
  },
  {
    id: 'sbc-design', name: '반복 측정값 (SBC 실험 설계용, 합성)', description: '시뮬레이션 기반 보정(SBC)은 데이터를 새로 시뮬레이션하므로, 이 표는 실험의 ‘설계’를 정합니다. 행 수가 관측 개수 n, 값의 표준편차가 잡음 크기 σ로 쓰입니다. 합성 데이터입니다.',
    size: sizes(10, 3, 100, 1, '측정 수'),
    generate: (seed, n) => { const r = createRng(seed); return table([num('측정값')], Array.from({ length: n }, () => [round(r.normal(0, 1), 3)])) },
  },
  {
    id: 'competing-risks', name: '경쟁 위험 추적 자료 (합성)', description: '추적 기간(개월)과 종료 사유입니다(0 = 검열, 1 = 질병 재발, 2 = 다른 원인으로 사망). 두 사건이 서로를 가리는 경쟁 위험으로, 집단 B는 재발 위험이 낮고 다른 사망 위험이 높습니다. 실제 환자 자료가 아닌 합성 데이터입니다.',
    size: sizes(150, 30, 600, 10, '집단당 인원'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (const [g, l1, l2] of [['집단 A', 0.045, 0.012], ['집단 B', 0.02, 0.03]] as const) {
        for (let i = 0; i < n; i++) {
          const t1 = -Math.log(1 - r()) / l1, t2 = -Math.log(1 - r()) / l2, c = 12 + r() * 36
          const t = Math.min(t1, t2, c)
          rows.push([round(t, 2), t === c ? 0 : t === t1 ? 1 : 2, g])
        }
      }
      return table([num('기간'), num('종료 사유'), cat('집단')], rows)
    },
  },
  {
    id: 'extreme-annual', name: '연 최대 일강수량 (합성 GEV)', description: '해마다의 최대 일강수량(mm)입니다. 위치 100, 척도 22, 꼬리 모양(ξ)이 약간 양수(0.1)인 일반화 극단값(GEV) 분포에서 뽑았으므로 극단 사건 쪽으로 꼬리가 두껍습니다. 실제 관측 자료가 아닙니다.',
    size: sizes(60, 15, 200, 5, '연 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('연도'), num('연 최대 강수량')], Array.from({ length: n }, (_, i) => { const u = r(); const xi = 0.1; return [1960 + i, round(100 + (22 / xi) * ((-Math.log(u)) ** -xi - 1), 1)] }))
    },
  },
  {
    id: 'joint-demo', name: '비선형 관계와 군집 (합성 2변수)', description: '세 군집으로 이루어진 두 변수입니다. 군집 A는 위로 휘는 곡선, 군집 B는 우상향 직선, 군집 C는 퍼진 구름이라 전체 상관계수는 낮아도 변수 사이의 의존성은 큽니다. 결합분포와 주변분포를 함께 비교하기 위한 합성 데이터입니다.',
    size: sizes(240, 60, 800, 20, '전체 점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('X'), num('Y'), cat('군집')], Array.from({ length: n }, (_, i) => {
        const c = i % 3
        const x = c === 0 ? r.normal(-1.5, 0.9) : c === 1 ? r.normal(1.2, 1.0) : r.normal(0.6, 1.4)
        const y = c === 0 ? 0.5 * x * x + r.normal(0, 0.35) : c === 1 ? 1.1 * x + r.normal(0, 0.5) : r.normal(-1.5, 1.1)
        return [round(x, 3), round(y, 3), 'ABC'[c]]
      }))
    },
  },
]
