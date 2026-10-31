import { createRng, round } from '../lib/random'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

export const datasetsV5Fin: DatasetDef[] = [
  {
    id: 'yield-curves', name: '합성 수익률 곡선 (3개 시점)', description: '정상(우상향), 평탄, 역전(단기가 장기보다 높음) 세 시점의 만기별 국채 수익률(%)을 흉내 낸 합성 데이터입니다. 실제 시장 금리가 아니며 형태만 닮게 만들었습니다.',
    generate: () => {
      const tenors = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30]
      const make = (label: string, b0: number, b1: number, b2: number, lam: number, wiggle: number): Cell[][] => tenors.map((t, i) => { const x = t / lam; const f = (1 - Math.exp(-x)) / x; return [label, t, round(b0 + b1 * f + b2 * (f - Math.exp(-x)) + wiggle * Math.sin(i * 1.7) * 0.03, 3)] })
      return table([cat('시점'), num('만기'), num('수익률')], [...make('정상 (예: 경기 확장)', 4.6, -3.8, 0.6, 2.4, 1), ...make('평탄 (예: 전환기)', 3.9, -0.6, -0.4, 2.4, -1), ...make('역전 (예: 긴축기)', 3.7, 1.5, 0.4, 2.0, 1)])
    },
  },
  {
    id: 'order-book', name: '합성 호가창 (매수·매도 잔량)', description: '한 종목의 호가별 잔량 합성 데이터입니다. 매수 호가는 현재가 아래, 매도 호가는 위에 있으며 현재가에서 멀수록 잔량이 늘고 몇 곳에 큰 잔량(벽)이 있습니다. 실제 거래 자료가 아닙니다.',
    size: sizes(18, 5, 60, 1, '호가 단계 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      const mid = 100
      for (let i = 0; i < n; i++) {
        const wall = i === Math.floor(n * 0.45) || i === Math.floor(n * 0.7) ? 2.6 : 1
        rows.push(['매수', round(mid - 0.05 - i * 0.1, 2), Math.round((120 + 60 * i ** 0.7 + r() * 90) * wall)])
        const wall2 = i === Math.floor(n * 0.55) ? 2.4 : 1
        rows.push(['매도', round(mid + 0.05 + i * 0.1, 2), Math.round((110 + 55 * i ** 0.7 + r() * 90) * wall2)])
      }
      return table([cat('방향'), num('가격'), num('수량')], rows)
    },
  },
]
