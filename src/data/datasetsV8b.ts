import { createRng, round } from '../lib/random'
import type { DatasetDef } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })

export const REGION_POS: Record<string, [number, number]> = {
  서울경기: [45, 15], 강원: [72, 22], 충청: [42, 38], 전북: [35, 58], 전남: [32, 78], 경북: [74, 44], 경남: [66, 70], 제주: [30, 95],
}

const DOCS: Record<string, string[]> = {
  지도: [
    '지도는 위치와 값을 함께 보여줍니다', '코로플레스 지도는 지역의 값을 색으로 표현합니다', '면적의 왜곡은 지도의 대표적인 문제입니다', '점 지도는 위치의 분포를 보여줍니다',
    '카토그램은 지도의 면적을 값으로 바꿉니다', '투영법과 좌표계는 지도의 모양을 결정합니다', '지도의 색은 값과 범주를 구분합니다', '위치와 거리를 정확히 읽을 때 지도가 좋습니다',
    '흐름 지도는 이동의 방향과 크기를 보여줍니다', '지도의 범례는 색과 값을 연결합니다', '지역의 크기는 값의 크기와 다를 수 있습니다', '시간의 변화를 지도와 함께 봅니다',
  ],
  통계: [
    '분포는 히스토그램과 상자그림으로 보여줍니다', '평균과 분산은 분포의 요약입니다', '불확실성은 구간과 확률로 표현합니다', '신뢰구간은 추정의 불확실성을 보여줍니다',
    '분포의 모양은 평균이 놓치는 것을 알려줍니다', '이상치와 치우침은 분포의 중요한 특징입니다', '표본의 크기는 불확실성의 크기를 결정합니다', '밀도 추정은 분포의 모양을 부드럽게 보여줍니다',
    '상관과 인과를 구분해야 합니다', '확률의 해석은 불확실성의 이해를 돕습니다', '구간과 분포를 함께 그리면 불확실성이 보입니다', '평균의 차이는 분산과 표본의 크기에 달려 있습니다',
  ],
  네트워크: [
    '네트워크는 노드와 연결로 구성됩니다', '연결의 수는 노드의 중요도를 나타냅니다', '공동체는 연결이 조밀한 노드의 집단입니다', '인접 행렬과 노드링크는 네트워크의 표현입니다',
    '간선의 겹침은 네트워크의 가독성을 떨어뜨립니다', '노드의 배치는 연결의 구조를 드러냅니다', '계층과 연결을 함께 보여줍니다', '중심성은 노드의 역할을 요약합니다',
    '연결의 방향과 가중치를 함께 표현합니다', '시간의 변화에 따라 네트워크의 연결이 바뀝니다', '집단과 집단 사이의 연결을 확인합니다', '노드와 간선의 속성을 색으로 표현합니다',
  ],
}

/** v0.8 datasets for attribute-driven networks, dynamic networks, flows, sequences and text. */
export const datasetsV8b: DatasetDef[] = [
  {
    id: 'people-network', name: '사람 관계망과 속성 (부서·직급·경력·성과, 합성)', description: '가상 회사 직원들의 협업 관계입니다. 한 행이 관계 하나이며, 뒤쪽 네 열(부서·직급·경력·성과)은 출발 노드(사람 A)의 속성입니다. 같은 부서끼리 더 자주 협업하고 경력이 길수록 직급이 높습니다. Semantic Substrates와 PivotGraph처럼 속성으로 배치하는 네트워크 기법용입니다. 실제 인물과 무관합니다.',
    size: { min: 16, max: 70, default: 36, step: 2, label: '직원 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const depts = ['연구', '개발', '영업', '운영'], levels = ['사원', '대리', '과장', '부장']
      const people = Array.from({ length: n }, (_, i) => {
        const lv = Math.min(3, Math.floor(Math.pow(r(), 1.6) * 4))
        const dept = depts[i % depts.length]
        return { name: `직원 ${String(i + 1).padStart(2, '0')}`, dept, level: levels[lv], career: round(1 + lv * 4 + r() * 6, 1), perf: round(Math.min(99, Math.max(40, 55 + (depts.indexOf(dept) * 6) + lv * 4 + r.normal(0, 9))), 1) }
      })
      const E: [number, number][] = []
      const have = new Set<string>()
      const add = (a: number, b: number) => { const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (a !== b && !have.has(k)) { have.add(k); E.push([a, b]) } }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < (people[i].dept === people[j].dept ? 0.2 : 0.035)) add(i, j)
      const count = new Array<number>(n).fill(0)
      E.forEach(([a]) => count[a]++)
      // every person appears as the source of at least one row so that the attributes are available
      for (let v = 0; v < n; v++) {
        if (count[v] > 0) continue
        const idx = E.findIndex(([a, b]) => b === v && count[a] > 1)
        if (idx >= 0) { const [a, b] = E[idx]; E[idx] = [b, a]; count[a]--; count[b]++ } else { let w = r.int(0, n - 1); if (w === v) w = (v + 1) % n; add(v, w); if (E[E.length - 1][0] === v) count[v]++ }
      }
      return table([cat('사람 A'), cat('사람 B'), num('가중치'), cat('부서'), cat('직급'), num('경력'), num('성과')], E.map(([a, b]) => [people[a].name, people[b].name, 1 + r.int(0, 2), people[a].dept, people[a].level, people[a].career, people[a].perf]))
    },
  },
  {
    id: 'dynamic-links', name: '시간에 따라 변하는 관계 (세 모임, 합성)', description: '열두 명이 세 모임(A·B·C)으로 나뉘어 시점마다 주고받은 상호작용입니다. 한 행이 한 시점의 상호작용 하나입니다. 중반에는 B와 C 모임이 섞이고 후반에는 A와 C 사이에 다리가 생깁니다. 실제 기록이 아닙니다.',
    size: { min: 12, max: 40, default: 24, step: 2, label: '시점 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const groups = ['A', 'B', 'C'].map((g) => [1, 2, 3, 4].map((k) => `${g}${k}`))
      const rows: Cell[][] = []
      for (let t = 1; t <= n; t++) {
        const frac = t / n
        const mixBC = frac > 0.35 && frac < 0.7
        const bridgeAC = frac >= 0.75
        const pairs = (g: string[]) => g.flatMap((a, i) => g.slice(i + 1).map((b) => [a, b] as [string, string]))
        for (const g of groups) for (const [a, b] of pairs(g)) if (r() < 0.35) rows.push([t, a, b, 1 + r.int(0, 3)])
        if (mixBC) for (let k = 0; k < 4; k++) if (r() < 0.6) rows.push([t, groups[1][r.int(0, 3)], groups[2][r.int(0, 3)], 1 + r.int(0, 2)])
        if (bridgeAC) for (let k = 0; k < 2; k++) if (r() < 0.5) rows.push([t, groups[0][r.int(0, 3)], groups[2][r.int(0, 3)], 1 + r.int(0, 2)])
      }
      return table([num('시점'), cat('노드 A'), cat('노드 B'), num('가중치')], rows)
    },
  },
  {
    id: 'od-timeseries', name: '지역 간 이동량 시계열 (여덟 권역, 합성)', description: '여덟 권역 사이의 월별 이동량입니다. 한 행이 한 달의 출발 → 도착 이동 하나이고, 출발·도착 권역의 평면 좌표(0~100)가 함께 들어 있습니다. 쌍마다 계절 변동의 위상과 크기가 다릅니다. 합성 자료이며 실제 통계가 아닙니다.',
    size: { min: 6, max: 24, default: 12, step: 1, label: '월 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const names = Object.keys(REGION_POS)
      const pairs: [string, string][] = [['서울경기', '강원'], ['강원', '서울경기'], ['서울경기', '충청'], ['충청', '서울경기'], ['서울경기', '경북'], ['충청', '전북'], ['전북', '전남'], ['전남', '서울경기'], ['경북', '경남'], ['경남', '경북'], ['경남', '제주'], ['서울경기', '제주'], ['제주', '서울경기'], ['충청', '경북'], ['전북', '서울경기']]
      const rows: Cell[][] = []
      pairs.forEach(([o, d], k) => {
        const base = 40 + r() * 160, amp = 0.15 + r() * 0.5, phase = r() * 12
        for (let m = 1; m <= n; m++) rows.push([o, d, REGION_POS[o][0], REGION_POS[o][1], REGION_POS[d][0], REGION_POS[d][1], m, Math.max(1, Math.round(base * (1 + amp * Math.sin((2 * Math.PI * (m - phase)) / 12)) + r.normal(0, base * 0.05)))])
        void k
      })
      void names
      return table([cat('출발'), cat('도착'), num('출발 x'), num('출발 y'), num('도착 x'), num('도착 y'), num('월'), num('이동량')], rows)
    },
  },
  {
    id: 'care-pathways', name: '진료 경로 기록 (접수→검사→진단→치료, 합성)', description: '환자 기록마다 사건과 시점(일)이 쌓인 합성 자료입니다. 접수 이후 검사·처방이 갈리고, 진단·재검사·치료·경과관찰을 거쳐 퇴원하는 마르코프 과정에서 뽑았습니다. 여러 기록의 시퀀스를 집계하는 LifeFlow용이며 실제 의료 기록이 아닙니다.',
    size: { min: 20, max: 200, default: 80, step: 10, label: '기록 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const next: Record<string, [string, number][]> = {
        접수: [['검사', 0.78], ['처방', 0.22]], 검사: [['진단', 0.68], ['재검사', 0.32]], 재검사: [['진단', 1]], 진단: [['치료', 0.82], ['퇴원', 0.18]],
        처방: [['퇴원', 0.65], ['검사', 0.35]], 치료: [['경과관찰', 0.6], ['퇴원', 0.4]], 경과관찰: [['퇴원', 0.72], ['치료', 0.28]],
      }
      const gap: Record<string, number> = { 검사: 2, 재검사: 4, 진단: 1.5, 처방: 1, 치료: 3, 경과관찰: 6, 퇴원: 2 }
      const rows: Cell[][] = []
      for (let i = 1; i <= n; i++) {
        const id = `기록 ${String(i).padStart(3, '0')}`
        let t = 0, ev = '접수'
        rows.push([id, ev, 0])
        for (let step = 0; step < 8 && ev !== '퇴원'; step++) {
          const opts = next[ev]
          let u = r(), pick = opts[opts.length - 1][0]
          for (const [e, p] of opts) { if (u < p) { pick = e; break } u -= p }
          t = round(t + Math.max(0.5, gap[pick] * (0.6 + r() * 0.8)), 1)
          ev = pick
          rows.push([id, ev, t])
        }
      }
      return table([cat('기록'), cat('사건'), num('시점')], rows)
    },
  },
  {
    id: 'timed-events', name: '시점이 있는 사건과 집합 소속 (세 사안, 합성)', description: '시점(일)이 있는 사건 스물네 개가 세 사안(A·B·C) 중 어디에 속하는지를 0/1 열로 적은 합성 자료입니다. 한 사건이 둘 이상의 사안에 걸칠 수 있고 사안마다 활발한 시기가 다릅니다. 시간 축 위에 집합 영역을 그리는 TimeSets용입니다.',
    size: { min: 12, max: 48, default: 24, step: 2, label: '사건 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const centers = [18, 45, 72]
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const t = round(3 + (i / Math.max(1, n - 1)) * 94 + r.normal(0, 2), 0)
        const m = centers.map((c) => (r() < Math.exp(-((t - c) ** 2) / (2 * 14 * 14)) * 0.9 ? 1 : 0))
        if (!m.some((x) => x)) m[centers.map((c) => Math.abs(t - c)).indexOf(Math.min(...centers.map((c) => Math.abs(t - c))))] = 1
        return [`사건 ${String(i + 1).padStart(2, '0')}`, t, ...m]
      })
      return table([cat('사건'), num('시점'), num('사안 A'), num('사안 B'), num('사안 C')], rows)
    },
  },
  {
    id: 'corpus-articles', name: '세 문서의 문장 모음 (지도·통계·네트워크)', description: '시각화 해설 세 문서(지도, 통계·불확실성, 네트워크)에서 열두 문장씩 모은 서른여섯 문장입니다. 같은 구문(“X와 Y”, “X의 Y”)이 반복되고 문서마다 고유한 단어가 있어 Parallel Tag Clouds·TextArc·Phrase Net용입니다. 직접 고치면 결과가 바뀝니다.',
    generate: () => table([cat('문서'), cat('문장')], Object.entries(DOCS).flatMap(([doc, ss]) => ss.map((s) => [doc, s] as Cell[]))),
  },
]
