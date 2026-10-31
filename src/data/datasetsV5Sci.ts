import { createRng, round } from '../lib/random'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

const gauss = (r: ReturnType<typeof createRng>, m = 0, s = 1) => r.normal(m, s)

export const datasetsV5Sci: DatasetDef[] = [
  {
    id: 'surface-grid', name: '3차원 표면 격자 (x, y, z)', description: '두 변수 x, y의 규칙적인 격자 위에 높이 z를 둔 데이터입니다. z = 사인 모양의 물결(sinc)에 가우시안 언덕 두 개를 더한 합성 함수이며, 칸 수는 조절할 수 있습니다. 값을 고치면 표면이 바뀝니다.',
    size: sizes(21, 7, 41, 2, '한 변의 칸 수'),
    generate: (_s, n) => {
      const rows: Cell[][] = []
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -4 + (8 * i) / (n - 1), y = -4 + (8 * j) / (n - 1)
        const rr = Math.hypot(x, y) + 1e-9
        const z = (Math.sin(2 * rr) / rr) * 1.6 + 1.1 * Math.exp(-((x - 2) ** 2 + (y + 1.5) ** 2) / 1.2) - 0.7 * Math.exp(-((x + 2.2) ** 2 + (y - 2) ** 2) / 1.6)
        rows.push([round(x, 3), round(y, 3), round(z, 4)])
      }
      return table([num('x'), num('y'), num('z')], rows)
    },
  },
  {
    id: 'signal-chirp', name: '신호: 순음 + 파열 + 처프 (합성)', description: '표본 주파수 256 Hz로 잰 합성 신호입니다. 20 Hz 순음이 계속되고, 중간에 60 Hz 파열이 잠깐 나타나며, 전체에 걸쳐 10 Hz에서 90 Hz로 올라가는 처프(주파수가 변하는 신호)와 잡음이 섞여 있어 시간별 주파수 변화를 분석하기에 좋습니다.',
    size: sizes(1024, 256, 4096, 256, '표본 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const fs = 256
      return table([num('시간(s)'), num('신호')], Array.from({ length: n }, (_, i) => {
        const t = i / fs, T = n / fs
        const burst = t > 0.4 * T && t < 0.55 * T ? 1.2 * Math.sin(2 * Math.PI * 60 * t) : 0
        const chirp = 0.8 * Math.sin(2 * Math.PI * (10 * t + ((90 - 10) / (2 * T)) * t * t))
        return [round(t, 5), round(Math.sin(2 * Math.PI * 20 * t) + burst + chirp + gauss(r, 0, 0.25), 4)]
      }))
    },
  },
  {
    id: 'rp-series', name: '시계열: 주기 + 느린 변화 + 잡음 (합성)', description: '주기 24인 진동에 느리게 변하는 성분(중간에 위상이 바뀜)과 잡음을 더한 합성 시계열입니다. 재귀 플롯에서 주기가 대각선 줄무늬로, 위상 변화가 줄무늬의 어긋남으로 보입니다.',
    size: sizes(240, 80, 500, 20, '표본 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('시점'), num('값')], Array.from({ length: n }, (_, i) => [i, round(Math.sin((2 * Math.PI * i) / 24 + (i > n * 0.6 ? 1.5 : 0)) + 0.4 * Math.sin((2 * Math.PI * i) / 110) + gauss(r, 0, 0.12), 4)]))
    },
  },
  {
    id: 'phase-seeds', name: '위상 초상도 초기 조건', description: '위상 평면에서 출발할 점의 좌표(x₀, y₀)입니다. 행을 고치거나 지도에서 점을 끌면 궤적이 다시 계산됩니다. 값은 선택한 시스템의 평면 범위 안에서 정하세요.',
    generate: () => table([cat('이름'), num('x0'), num('y0')], [['A', 1.2, 0], ['B', -2, 1], ['C', 0.5, 2], ['D', 3, -1], ['E', -1, -2.2]]),
  },
  {
    id: 'bifurcation-marks', name: '분기 다이어그램의 관심 매개변수', description: '분기 다이어그램에 세로선으로 표시할 매개변수 r 값입니다. 로지스틱 사상에서 r = 2.8(고정점), 3.2(주기 2), 3.5(주기 4), 3.9(혼돈)를 고른 기본 표이며 값을 바꾸거나 행을 추가할 수 있습니다.',
    generate: () => table([cat('이름'), num('r')], [['고정점', 2.8], ['주기 2', 3.2], ['주기 4', 3.5], ['혼돈', 3.9]]),
  },
  {
    id: 'wind-obs', name: '풍향·풍속 관측 (합성)', description: '600개의 풍향(°, 북쪽 0°에서 시계 방향, 바람이 불어오는 방향)과 풍속(m/s) 합성 관측입니다. 북서풍이 가장 잦고 강하며 남풍은 약합니다. 실제 관측이 아닙니다.',
    size: sizes(600, 60, 4000, 20, '관측 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('풍향'), num('풍속')], Array.from({ length: n }, () => {
        const main = r() < 0.55 ? r.normal(300, 35) : r() < 0.6 ? r.normal(110, 45) : r() * 360
        const dir = ((main % 360) + 360) % 360
        const strong = 1 + 0.9 * Math.exp(-((((dir - 300 + 540) % 360) - 180) ** 2) / (2 * 60 * 60) * -1)
        return [round(dir, 1), round(Math.max(0, r.normal(4.5, 2.2) * (dir > 240 && dir < 360 ? strong : 0.8)), 2)]
      }))
    },
  },
  {
    id: 'soil-texture', name: '토양 입도 조성 (합성)', description: '모래·미사·점토 비율(%, 합 100)과 시료 종류입니다. 세 성분의 합이 일정한 조성 데이터는 삼각 좌표 그래프로 그립니다. 시료는 세 종류의 중심 주위에 만든 합성 값입니다.',
    size: sizes(60, 15, 400, 5, '시료 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const centers: [string, number, number, number][] = [['모래질', 70, 20, 10], ['미사질', 20, 65, 15], ['점토질', 20, 25, 55]]
      return table([cat('시료'), num('모래'), num('미사'), num('점토')], Array.from({ length: n }, (_, i) => {
        const c = centers[i % 3]
        const raw = [Math.max(1, c[1] + gauss(r, 0, 9)), Math.max(1, c[2] + gauss(r, 0, 7)), Math.max(1, c[3] + gauss(r, 0, 6))]
        const s = raw[0] + raw[1] + raw[2]
        const a = round((100 * raw[0]) / s, 1), b = round((100 * raw[1]) / s, 1)
        return [`${c[0]} ${Math.floor(i / 3) + 1}`, a, b, round(100 - a - b, 1)]
      }))
    },
  },
  {
    id: 'polar-curves', name: '극좌표 곡선 (장미·나선·심장)', description: '각도(°)와 반지름의 표로 적은 세 곡선입니다. 장미 곡선 r = 3 cos 3θ, 아르키메데스 나선 r = θ/2π × 4, 심장 곡선 r = 2(1 + cos θ)를 0°~360°(나선은 2바퀴)에 걸쳐 표본한 것입니다.',
    size: sizes(120, 24, 360, 12, '곡선당 점 수'),
    generate: (_s, n) => {
      const rows: Cell[][] = []
      for (let i = 0; i <= n; i++) { const th = (2 * Math.PI * i) / n; rows.push(['장미', round((th * 180) / Math.PI, 2), round(3 * Math.cos(3 * th), 4)]) }
      for (let i = 0; i <= n; i++) { const th = (4 * Math.PI * i) / n; rows.push(['나선', round((th * 180) / Math.PI, 2), round((th / (2 * Math.PI)) * 2, 4)]) }
      for (let i = 0; i <= n; i++) { const th = (2 * Math.PI * i) / n; rows.push(['심장', round((th * 180) / Math.PI, 2), round(2 * (1 + Math.cos(th)), 4)]) }
      return table([cat('곡선'), num('각도'), num('반지름')], rows)
    },
  },
  {
    id: 'points-2d', name: '평면 위의 점 (들로네·보로노이 연습)', description: '평면 위 무작위 점입니다. 점을 끌어 옮기면 들로네 삼각분할이 즉시 다시 계산됩니다. 합성 데이터입니다.',
    size: sizes(28, 4, 120, 2, '점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('x'), num('y'), cat('그룹')], Array.from({ length: n }, (_, i) => [round(5 + r() * 90, 1), round(5 + r() * 90, 1), i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C']))
    },
  },
  {
    id: 'hourly-visits', name: '요일×시간대 방문 수 (합성, 긴 형식)', description: '요일(고리)과 시각(각도, 0~23시)별 합성 방문 수입니다. 한 행이 요일·시각 조합 하나입니다. 평일은 출퇴근 시간에, 주말은 낮에 몰립니다. 주기 변수를 극좌표 히트맵으로 그리기 위한 데이터입니다.',
    generate: () => {
      const rows: Cell[][] = []
      const days = ['월', '화', '수', '목', '금', '토', '일']
      days.forEach((d, di) => { for (let h = 0; h < 24; h++) {
        const weekend = di >= 5
        const base = weekend ? 30 + 90 * Math.exp(-((h - 14) ** 2) / 30) : 20 + 110 * Math.exp(-((h - 8.5) ** 2) / 6) + 130 * Math.exp(-((h - 18) ** 2) / 8)
        rows.push([d, h, Math.round(base * (1 + 0.06 * Math.sin(di * 2 + h)) + (h < 6 ? 0 : 10))])
      } })
      return table([cat('요일'), num('시'), num('방문 수')], rows)
    },
  },
]
