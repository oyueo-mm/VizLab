import { createRng, round } from '../lib/random'
import type { DatasetDef } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })

export const SET_POINT_SETS = ['집합 A', '집합 B', '집합 C', '집합 D']

/** v0.8 datasets. */
export const datasetsV8: DatasetDef[] = [
  {
    id: 'set-points', name: '평면 위 점의 집합 소속 (4개 집합, 합성)', description: '평면(0~100 × 0~70)에 흩어진 점들이 네 집합 중 어디에 속하는지를 0/1 열로 적은 합성 데이터입니다. 집합마다 중심이 있어 소속 점은 대체로 뭉치지만, 중심에서 떨어진 점도 확률적으로 섞이고 어디에도 속하지 않는 점도 있습니다. 점을 끌어 옮기거나 소속 값을 고치면 영역이 다시 계산됩니다.',
    size: { min: 16, max: 90, default: 36, step: 2, label: '점 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const centers: [number, number][] = [[28, 22], [66, 20], [40, 50], [78, 50]]
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const x = round(6 + r() * 88, 1), y = round(6 + r() * 58, 1)
        const m = centers.map(([cx, cy]) => {
          const d = Math.hypot(x - cx, y - cy)
          return r() < Math.exp(-(d * d) / (2 * 15 * 15)) * 0.95 ? 1 : 0
        })
        return [`점 ${String(i + 1).padStart(2, '0')}`, x, y, ...m]
      })
      // every set keeps at least three members so each region is meaningful
      centers.forEach(([cx, cy], s) => {
        const have = rows.filter((row) => row[3 + s] === 1).length
        if (have >= 3) return
        const near = rows.map((row, i) => ({ i, d: Math.hypot((row[1] as number) - cx, (row[2] as number) - cy) })).sort((a, b) => a.d - b.d)
        let need = 3 - have
        for (const { i } of near) { if (!need) break; if (rows[i][3 + s] !== 1) { rows[i][3 + s] = 1; need-- } }
      })
      return table([cat('이름'), num('x'), num('y'), ...SET_POINT_SETS.map(num)], rows)
    },
  },
  {
    id: 'dense-modules', name: '조밀한 의존 관계망 (이분 완전연결 + 완전그래프, 합성)', description: '앱 6개가 공용 서비스 5개를 모두 호출하는 완전 이분 구조, 팀원 6명이 서로 모두 연결된 완전그래프, 같은 모양의 작은 이분 구조와 몇 개의 잡음 연결로 이루어진 합성 네트워크입니다. 간선은 많지만 중복되는 연결 구조가 뚜렷해 Power Graph와 Confluent Drawing으로 크게 압축됩니다. 실제 서비스의 관계가 아닙니다.',
    size: { min: 0, max: 12, default: 4, step: 1, label: '잡음 연결 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const E: [string, string][] = []
      const apps = ['앱1', '앱2', '앱3', '앱4', '앱5', '앱6'], svc = ['인증', '결제', '알림', '검색', '로그']
      for (const a of apps) for (const b of svc) E.push([a, b])
      const team = ['가', '나', '다', '라', '마', '바']
      for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) E.push([`팀${team[i]}`, `팀${team[j]}`])
      const xs = ['배치1', '배치2', '배치3'], ys = ['큐', '저장소', '캐시', '모니터']
      for (const a of xs) for (const b of ys) E.push([a, b])
      const all = [...apps, ...svc, ...team.map((t) => `팀${t}`), ...xs, ...ys]
      const have = new Set(E.map(([a, b]) => `${a}|${b}`))
      for (let k = 0; k < n; k++) {
        const a = all[r.int(0, all.length - 1)], b = all[r.int(0, all.length - 1)]
        if (a !== b && !have.has(`${a}|${b}`) && !have.has(`${b}|${a}`)) { have.add(`${a}|${b}`); E.push([a, b]) }
      }
      const kind = (id: string) => (apps.includes(id) || xs.includes(id) ? '호출 측' : svc.includes(id) || ys.includes(id) ? '제공 측' : '팀')
      return table([cat('노드 A'), cat('노드 B'), num('가중치'), cat('그룹')], E.map(([a, b]) => [a, b, 1, kind(a)]))
    },
  },
]
