import { createRng, round } from '../lib/random'
import { DAY_MS, formatISO } from '../stats/datetime'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const date = (name: string): Column => ({ name, type: 'date' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

export const datasetsV5Misc: DatasetDef[] = [
  {
    id: 'spike-trials', name: '반복 시행의 사건 시각 (합성)', description: '같은 자극을 여러 번 반복한(시행) 실험에서 사건(예: 신경 발화)이 일어난 시각(ms)입니다. 두 조건 중 하나는 자극(0 ms) 뒤 100~200 ms에 반응이 늘도록 만든 합성 데이터이며 한 행이 사건 하나입니다.',
    size: sizes(20, 4, 60, 2, '조건당 시행 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (const [cond, boost] of [['자극 A', 1], ['자극 B', 0]] as const) {
        for (let k = 0; k < n; k++) {
          const trial = `${cond[cond.length - 1]}${String(k + 1).padStart(2, '0')}`
          // baseline firing 8 Hz over −200..400 ms, plus a response burst of ~40 Hz at 100–200 ms for condition A
          for (let t = -200; t < 400; t += 2) {
            const rate = 8 + (boost && t >= 100 && t < 200 ? 40 : 0) + (boost && t >= 200 && t < 260 ? 15 : 0)
            if (r() < (rate / 1000) * 2) rows.push([trial, t + r() * 2, cond])
          }
        }
      }
      return table([cat('시행'), num('시각'), cat('조건')], rows.map((x) => [x[0], round(x[1] as number, 1), x[2]]))
    },
  },
  {
    id: 'event-log', name: '이벤트 기록 (합성)', description: '서버의 세 종류 이벤트가 일어난 시각입니다. 한 행이 이벤트 하나이고, 오류는 특정 시간대에 몰려서 일어나도록 만든 합성 데이터입니다.',
    size: sizes(260, 40, 1500, 20, '이벤트 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const t0 = Date.UTC(2024, 4, 1)
      const rows: Cell[][] = []
      const bursts = [3.2, 7.4, 7.55, 11.9]
      while (rows.length < n) {
        const kind = r()
        if (kind < 0.6) rows.push(['요청', formatISO(t0 + Math.floor(r() * 14 * DAY_MS / 600000) * 600000, true)])
        else if (kind < 0.85) rows.push(['경고', formatISO(t0 + Math.floor(r() * 14 * DAY_MS / 600000) * 600000, true)])
        else { const b = bursts[Math.floor(r() * bursts.length)]; rows.push(['오류', formatISO(t0 + Math.floor((b + r.normal(0, 0.05)) * DAY_MS / 60000) * 60000, true)]) }
      }
      return table([cat('유형'), date('시각')], rows)
    },
  },
  {
    id: 'lifelines', name: '코호트 생명선 (합성)', description: '1980~2010년에 가입한 사람들의 가입 연도, 종료 연도, 종료 사유(1 = 사건 발생, 0 = 관찰 종료)입니다. 렉시스 도표에서 한 사람이 45° 선 하나입니다. 합성 데이터입니다.',
    size: sizes(60, 10, 300, 5, '인원'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('시작'), num('종료'), num('사건')], Array.from({ length: n }, () => {
        const start = 1980 + r() * 30
        const t = -Math.log(1 - r()) * 18
        const end = Math.min(2020, start + t)
        return [round(start, 2), round(end, 2), start + t <= 2020 ? 1 : 0]
      }))
    },
  },
  {
    id: 'kanban', name: '작업 흐름 누적 기록 (합성)', description: '가상 팀의 일별 작업 상태 변화입니다. 하루에 새로 대기열에 들어온 건수, 진행에 들어간 건수, 검토에 들어간 건수, 완료된 건수를 단계별 한 행으로 적었습니다. 중간에 검토가 병목이 되도록 만든 합성 데이터입니다.',
    size: sizes(60, 20, 200, 5, '일 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const t0 = Date.UTC(2024, 1, 5)
      const stages = ['대기', '진행', '검토', '완료']
      const rows: Cell[][] = []
      for (let d = 0; d < n; d++) {
        const bottleneck = d > n * 0.45 && d < n * 0.75
        const rates = [4 + r() * 3, 3.6 + r() * 2.6, bottleneck ? 1.6 + r() : 3.2 + r() * 2, bottleneck ? 1.2 + r() * 1.5 : 3 + r() * 2]
        stages.forEach((s, k) => rows.push([formatISO(t0 + d * DAY_MS), s, Math.round(rates[k])]))
      }
      return table([date('날짜'), cat('단계'), num('건수')], rows)
    },
  },
]
