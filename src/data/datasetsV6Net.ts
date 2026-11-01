import { createRng } from '../lib/random'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

/** 방향 그래프 · 흐름 · 군집 예제(모두 합성). */
export const datasetsV6Net: DatasetDef[] = [
  {
    id: 'dag-release', name: '제품 출시 작업의 선행 관계 (합성)', description: '가상의 제품 출시 프로젝트 16개 작업이 서로 먼저 끝나야 하는 관계(선행 → 후행)와 작업 기간(일)입니다. 순환이 없는 방향 그래프라 층별 배치와 임계 경로를 보기에 알맞습니다. 표에 되돌아가는 간선 하나를 추가하면 순환을 어떻게 끊는지 볼 수 있습니다. 실제 프로젝트가 아닙니다.',
    generate: () => {
      const E: [string, string, number, string][] = [
        ['요구 분석', '설계', 5, '기획'], ['요구 분석', '시장 조사', 3, '기획'], ['시장 조사', '가격 정책', 4, '기획'], ['설계', '백엔드', 10, '개발'], ['설계', '프런트엔드', 8, '개발'], ['설계', '디자인', 6, '개발'],
        ['디자인', '프런트엔드', 6, '개발'], ['백엔드', '통합 시험', 4, '개발'], ['프런트엔드', '통합 시험', 4, '개발'], ['가격 정책', '결제 연동', 3, '사업'], ['백엔드', '결제 연동', 3, '개발'],
        ['결제 연동', '통합 시험', 2, '사업'], ['통합 시험', '보안 점검', 3, '품질'], ['통합 시험', '성능 시험', 4, '품질'], ['보안 점검', '출시 승인', 2, '품질'], ['성능 시험', '출시 승인', 2, '품질'],
        ['가격 정책', '마케팅 준비', 5, '사업'], ['마케팅 준비', '출시 승인', 3, '사업'], ['출시 승인', '배포', 1, '운영'], ['설계', '문서화', 4, '개발'], ['문서화', '출시 승인', 1, '개발'],
      ]
      return table([cat('선행 작업'), cat('후행 작업'), num('선행 작업 기간(일)'), cat('부서')], E.map(([a, b, w, g]) => [a, b, w, g]))
    },
  },
  {
    id: 'flow-supply', name: '공급망 최대 유량 (CLRS 예제와 같은 구조)', description: '공장(S)에서 소매점(T)까지 물량이 흐르는 6개 지점 네트워크와 각 구간의 운송 용량입니다. 알고리즘 교재(CLRS)의 최대 유량 예제와 같은 구조라 최대 유량이 23임을 직접 확인할 수 있습니다. 한 행이 간선 하나(출발, 도착, 용량)입니다.',
    generate: () => {
      const E: [string, string, number][] = [['S', 'A', 16], ['S', 'B', 13], ['A', 'B', 10], ['B', 'A', 4], ['A', 'C', 12], ['C', 'B', 9], ['B', 'D', 14], ['D', 'C', 7], ['C', 'T', 20], ['D', 'T', 4]]
      return table([cat('출발'), cat('도착'), num('용량')], E.map(([a, b, c]) => [a, b, c]))
    },
  },
  {
    id: 'flow-grid', name: '격자형 물류망 (합성)', description: '창고 한 곳에서 배송 거점 한 곳으로 가는 4×4 격자 모양 도로망입니다. 구간 용량을 무작위로 정했으며 병목(최소 절단)이 어디에 생기는지 용량을 바꿔 가며 볼 수 있습니다.',
    size: sizes(4, 3, 6, 1, '격자 한 변'),
    generate: (seed, n) => {
      const r = createRng(seed), E: Cell[][] = [], id = (i: number, j: number) => `(${i},${j})`
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (j + 1 < n) E.push([id(i, j), id(i, j + 1), 2 + Math.floor(r() * 9)])
        if (i + 1 < n) E.push([id(i, j), id(i + 1, j), 2 + Math.floor(r() * 9)])
      }
      E.unshift(['창고', id(0, 0), 14])
      E.push([id(n - 1, n - 1), '거점', 14])
      return table([cat('출발'), cat('도착'), num('용량')], E)
    },
  },
  {
    id: 'net-hubs', name: '허브가 서로 뭉친 네트워크 (합성)', description: '연결 수가 큰 노드끼리 서로 이어지는 경향이 있는 가상 네트워크입니다(선호적 연결에 허브 사이의 연결을 더했습니다). 부자 클럽 계수가 같은 차수를 가진 무작위 그래프보다 높게 나오도록 만들었습니다.',
    size: sizes(60, 30, 200, 10, '노드 수'),
    generate: (seed, n) => {
      const r = createRng(seed), edges = new Set<string>(), deg = new Array<number>(n).fill(0)
      const add = (a: number, b: number) => { if (a === b) return; const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (edges.has(k)) return; edges.add(k); deg[a]++; deg[b]++ }
      const core = Math.max(4, Math.round(n * 0.08))
      for (let i = 0; i < core; i++) for (let j = i + 1; j < core; j++) if (r() < 0.9) add(i, j)
      for (let v = core; v < n; v++) {
        for (let k = 0; k < 2; k++) {
          const total = deg.slice(0, v).reduce((s, d) => s + d + 1, 0)
          let t = r() * total, u = 0
          for (; u < v - 1; u++) { t -= deg[u] + 1; if (t <= 0) break }
          add(v, u)
        }
      }
      // hubs also link to each other more often than preferential attachment alone would give (a rich club)
      const top = deg.map((d, i) => [d, i] as const).sort((x, y) => y[0] - x[0]).slice(0, Math.max(6, Math.round(n * 0.15))).map(([, i]) => i)
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) if (r() < 0.75) add(top[i], top[j])
      const rows: Cell[][] = [...edges].map((k) => { const [a, b] = k.split('-').map(Number); return [`노드 ${a + 1}`, `노드 ${b + 1}`, 1] })
      return table([cat('노드 A'), cat('노드 B'), num('가중치')], rows)
    },
  },
  {
    id: 'net-communities', name: '네 군집의 네트워크 (확률 블록 모형, 합성)', description: '네 군집(각 10~14명)이 군집 안에서는 촘촘히, 군집 사이에서는 드물게 이어진 가상 친구 관계망입니다. 군집 안 연결 확률 0.55, 군집 사이 0.05의 확률 블록 모형에서 뽑았고, 출발 노드 열의 그룹은 실제로 심은 군집입니다(탐지한 군집과 비교할 수 있습니다).',
    size: sizes(12, 6, 24, 1, '군집당 노드 수'),
    generate: (seed, n) => {
      const r = createRng(seed), k = 4, N = k * n
      const label = (i: number) => `${'ABCD'[Math.floor(i / n)]}${(i % n) + 1}`
      const group = (i: number) => `군집 ${'ABCD'[Math.floor(i / n)]}`
      const E: [number, number][] = []
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (r() < (Math.floor(i / n) === Math.floor(j / n) ? 0.55 : 0.05)) E.push((i + j) % 2 ? [i, j] : [j, i])
      // a node without any edge is joined to the next node of its cluster
      const touched = new Set(E.flat())
      for (let i = 0; i < N; i++) if (!touched.has(i)) E.push([i, Math.floor(i / n) * n + ((i + 1) % n)])
      // the group column belongs to the source node, so every node should appear as a source at least once: flip an edge where a node has none
      for (let pass = 0; pass < 6; pass++) {
        const count = new Array<number>(N).fill(0)
        E.forEach(([a]) => count[a]++)
        for (let v = 0; v < N; v++) {
          if (count[v] > 0) continue
          const e = E.find(([a, b]) => b === v && count[a] > 1)
          if (e) { count[e[0]]--; count[v]++; const t = e[0]; e[0] = e[1]; e[1] = t }
        }
      }
      const rows: Cell[][] = E.map(([a, b]) => [label(a), label(b), 1, group(a)])
      return table([cat('노드 A'), cat('노드 B'), num('가중치'), cat('그룹')], rows)
    },
  },
]
