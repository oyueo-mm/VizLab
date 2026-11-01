import { createRng, round } from '../lib/random'
import { addMonths, formatISO } from '../stats/datetime'
import { bsPrice, sviVariance } from '../stats/finance2'
import { nelsonSiegelCurve } from './nsCurve'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const date = (name: string): Column => ({ name, type: 'date' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

const ASSETS = ['주식 A', '주식 B', '채권', '원자재', '리츠']
const MU = [0.011, 0.008, 0.003, 0.005, 0.007] // monthly mean returns
const VOL = [0.055, 0.07, 0.015, 0.06, 0.045]
const CORR = [[1, 0.65, -0.1, 0.3, 0.55], [0.65, 1, -0.05, 0.35, 0.5], [-0.1, -0.05, 1, 0.0, 0.1], [0.3, 0.35, 0, 1, 0.25], [0.55, 0.5, 0.1, 0.25, 1]]

/** Correlated normal returns through a Cholesky factor of the correlation matrix. */
function chol(c: number[][]) { const n = c.length, L = c.map(() => new Array<number>(n).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = c[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j] } return L }

/** Finance example data (all synthetic: no real prices, returns, option quotes or order books). */
export const datasetsV6Fin: DatasetDef[] = [
  {
    id: 'asset-returns', name: '다섯 자산의 월별 수익률 (합성)', description: '다섯 가상 자산(주식 A·B, 채권, 원자재, 리츠)의 월별 수익률을 상관을 준 정규분포에서 만든 합성 데이터입니다(표본 평균은 모형 값에 맞춰 짧은 표본의 우연한 쏠림을 줄였습니다). 주식끼리는 상관이 높고 채권은 거의 무관(약한 음의 상관)하도록 했습니다. 실제 시장 자료가 아니며 투자 조언이 아닙니다.',
    size: sizes(120, 36, 360, 12, '개월 수'),
    generate: (seed, n) => {
      const r = createRng(seed), L = chol(CORR), t0 = Date.UTC(2014, 0, 1)
      const draws = Array.from({ length: n }, () => { const z = ASSETS.map(() => r.normal()); return ASSETS.map((_, i) => L[i].reduce((s, v, k) => s + v * z[k], 0)) })
      // moment matching: the sample mean of every asset is set to the model value so that a short sample does not produce a wildly different drift
      const mean = ASSETS.map((_, i) => draws.reduce((s, d) => s + d[i], 0) / n)
      return table([date('월'), ...ASSETS.map(num)], draws.map((e, t) => [formatISO(addMonths(t0, t)), ...e.map((v, i) => round(MU[i] + VOL[i] * (v - mean[i]), 4))]))
    },
  },
  {
    id: 'option-chain', name: '옵션 시세 (합성, 스마일이 있는 만기 4개)', description: '현물 100, 무위험 이자율 3%, 배당 0%에서 만기 1·3·6·12개월 옵션의 가격입니다. 내재변동성이 행사가에 따라 왼쪽 위로 기울어진(스큐) SVI 곡면에서 블랙–숄즈 가격을 계산한 뒤 호가 단위 잡음을 더했습니다. 한 행이 옵션 하나(만기, 행사가, 유형, 가격)입니다. 실제 시세가 아닙니다.',
    size: sizes(13, 7, 25, 2, '만기당 행사가 수'),
    generate: (seed, n) => {
      const r = createRng(seed), S = 100, rate = 0.03
      const rows: Cell[][] = []
      for (const T of [1 / 12, 0.25, 0.5, 1]) {
        const p = { a: 0.012 * T + 0.005, b: 0.09 * Math.sqrt(T) + 0.03, rho: -0.55, m: 0.0, s: 0.12 + 0.1 * T }
        for (let i = 0; i < n; i++) {
          const k = -0.28 + (0.56 * i) / (n - 1), K = Math.round(S * Math.exp(k) * 2) / 2
          const sigma = Math.sqrt(Math.max(1e-4, sviVariance(Math.log(K / S), p) / T))
          const call = K >= S * Math.exp(rate * T) // out-of-the-money side of the forward
          rows.push([T, K, call ? '콜' : '풋', round(Math.max(0.01, bsPrice({ S, K, T, r: rate, sigma, call }) + r.normal() * 0.004), 3)])
        }
      }
      return table([num('만기(년)'), num('행사가'), cat('유형'), num('가격')], rows)
    },
  },
  {
    id: 'trade-footprint', name: '체결 푸트프린트 (합성 틱 집계)', description: '10개 캔들의 가격 수준별 매수·매도 체결량입니다. 한 행이 캔들·가격 수준 하나이며 위로 가는 캔들은 매수 체결량이, 아래로 가는 캔들은 매도 체결량이 한쪽으로 몰리도록 합성했습니다. 실제 체결 자료가 아닙니다.',
    size: sizes(10, 4, 20, 1, '캔들 수'),
    generate: (seed, n) => {
      const r = createRng(seed), rows: Cell[][] = []
      let mid = 100
      for (let c = 0; c < n; c++) {
        const dir = r() < 0.5 ? 1 : -1, move = 0.4 + r() * 0.9, lo = mid - (dir > 0 ? 0.2 : move), hi = mid + (dir > 0 ? move : 0.2)
        for (let p = Math.round(lo * 10); p <= Math.round(hi * 10); p++) {
          const price = p / 10, pos = (price - lo) / Math.max(0.1, hi - lo)
          const base = 20 + 80 * Math.exp(-(((pos - 0.5) * 3) ** 2))
          const bias = dir > 0 ? 0.3 + 0.5 * pos : 0.8 - 0.5 * pos
          rows.push([c + 1, price, Math.round(base * bias * (0.6 + r())), Math.round(base * (1 - bias) * (0.6 + r()))])
        }
        mid = dir > 0 ? hi : lo
      }
      return table([num('캔들'), num('가격'), num('매수 체결'), num('매도 체결')], rows)
    },
  },
  {
    id: 'book-snapshots', name: '호가 잔량의 시간 변화 (합성)', description: '60개 시점의 가격 수준별 호가 잔량입니다. 한 행이 시점·가격·잔량·측(매수/매도) 하나이며, 가격이 서서히 움직이는 동안 매수 쪽에 큰 벽이 쌓였다가 사라지도록 합성했습니다. 실제 호가 자료가 아닙니다.',
    size: sizes(60, 20, 120, 5, '시점 수'),
    generate: (seed, n) => {
      const r = createRng(seed), rows: Cell[][] = []
      let mid = 100
      for (let t = 0; t < n; t++) {
        mid += r.normal(0, 0.05) + 0.2 * Math.sin(t / 9) * 0.1
        const bestBid = Math.floor(mid * 10) / 10
        for (let k = 1; k <= 12; k++) for (const side of ['매수', '매도'] as const) {
          const px = Math.round((side === '매수' ? bestBid - (k - 1) * 0.1 : bestBid + 0.1 + (k - 1) * 0.1) * 10) / 10
          const wall = side === '매수' && k === 7 && t > 15 && t < 42 ? 260 : side === '매도' && k === 5 && t > 30 ? 180 : 0
          rows.push([t + 1, px, Math.round(30 + 60 * Math.exp(-k / 5) * (0.5 + r()) + wall * (0.8 + 0.4 * r())), side])
        }
      }
      return table([num('시점'), num('가격'), num('잔량'), cat('측')], rows)
    },
  },
  {
    id: 'event-returns', name: '사건 전후 수익률 (합성 8개 사건)', description: '여덟 개 가상 사건 각각의 사건일(0일) 전 40일부터 후 10일까지 개별 종목 수익률과 시장 수익률입니다. 개별 종목은 베타 약 1.1의 시장모형을 따르고 사건일에 평균 +3%의 초과 수익이 나타나도록 합성했습니다. 실제 종목·사건이 아닙니다.',
    size: sizes(8, 3, 30, 1, '사건 수'),
    generate: (seed, n) => {
      const r = createRng(seed), rows: Cell[][] = []
      for (let e = 1; e <= n; e++) {
        const beta = 0.8 + 0.6 * r(), shock = 0.03 + r.normal(0, 0.012)
        for (let d = -40; d <= 10; d++) { const m = r.normal(0.0004, 0.01); rows.push([`사건 ${e}`, d, round(0.0002 + beta * m + (d === 0 ? shock : d === 1 ? shock * 0.25 : 0) + r.normal(0, 0.006), 4), round(m, 4)]) }
      }
      return table([cat('사건'), num('일'), num('종목 수익률'), num('시장 수익률')], rows)
    },
  },
  {
    id: 'pnl-fat', name: '일별 손익 분포 (합성, 두꺼운 꼬리)', description: '변동성이 군집하는 일별 손익(백만 원)의 합성 표본입니다. 대부분 평온하고 가끔 변동성이 커져 정규분포보다 꼬리가 두껍고 약간 왼쪽으로 치우쳐 있습니다. 위험 측정이 가정에 따라 얼마나 다른지 비교하기 위한 데이터이며 실제 손익이 아닙니다.',
    size: sizes(750, 250, 3000, 50, '일 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      let s2 = 1, eps = 0
      // GARCH(1,1) variance recursion with occasional left-tail jumps
      return table([num('일'), num('손익')], Array.from({ length: n }, (_, i) => {
        s2 = 0.05 + 0.1 * eps * eps + 0.85 * s2
        const z = r.normal() - (r() < 0.03 ? 2.5 : 0)
        eps = Math.sqrt(s2) * z
        return [i + 1, round(0.04 + eps, 3)]
      }))
    },
  },
  {
    id: 'yield-history', name: '수익률 곡선의 시간 변화 (합성, 월별 7개 만기)', description: '월별 3개월~30년 수익률(%)을 Nelson–Siegel 수준·기울기·곡률 요인이 무작위로 움직이는 모형으로 만든 합성 데이터입니다. 한 행이 월 하나이며 중간에 단기금리가 장기금리보다 높아지는 역전 구간이 포함됩니다. 실제 금리가 아닙니다.',
    size: sizes(72, 24, 180, 6, '개월 수'),
    generate: (seed, n) => {
      const r = createRng(seed), t0 = Date.UTC(2018, 0, 1), ten = [0.25, 1, 2, 5, 10, 20, 30]
      let level = 3.2, slope = -1.8, curv = 0.5
      return table([date('월'), ...['3개월', '1년', '2년', '5년', '10년', '20년', '30년'].map(num)], Array.from({ length: n }, (_, t) => {
        level += 0.01 * (3.6 - level) + r.normal(0, 0.1)
        slope += 0.04 * (-1.8 - slope) + r.normal(0, 0.1)
        curv += -0.05 * curv + r.normal(0, 0.08)
        const inverted = t > n * 0.5 && t < n * 0.72 // short rates above long rates in this stretch
        const y = nelsonSiegelCurve(ten, level, inverted ? Math.max(0.6, slope + 3) : slope, curv, 2.4)
        return [formatISO(addMonths(t0, t)), ...y.map((v) => round(Math.max(0.05, v + r.normal(0, 0.02)), 3))]
      }))
    },
  },
]

