import { koreaRows } from '../geo/data/stats'
import { createRng, round } from '../lib/random'
import type { DatasetDef } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const pad = (i: number, n = 2) => String(i).padStart(n, '0')

/** v1.1 datasets (all synthetic). */
export const datasetsV11: DatasetDef[] = [
  {
    id: 'signed-matrix', name: '부호가 있는 행렬 (연결 가중치, 합성)', description: '입력 8개와 출력 8개 사이의 연결 가중치(양수·음수) 행렬입니다. 한 행이 칸 하나(행, 열, 값)이며 값의 부호와 크기를 사각형의 색과 면적으로 읽는 힌턴 도표에 알맞습니다. 합성 자료입니다.',
    size: { min: 4, max: 20, default: 8, step: 1, label: '행·열 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rows.push([`입력 ${pad(i + 1)}`, `출력 ${pad(j + 1)}`, round(r.normal(0, 1) * (i === j ? 2.2 : 0.8), 2)])
      return table([cat('행'), cat('열'), num('값')], rows)
    },
  },
  {
    id: 'model-skill', name: '모형 성능 비교 (관측과 세 모형의 예측, 합성)', description: '같은 지점 여러 곳의 관측값과 세 모형(A, B, C)의 예측값입니다. 모형 A는 패턴이 잘 맞고, 모형 B는 변동이 과장되며, 모형 C는 일정한 편향이 있습니다. 상관계수·표준편차·중심화 RMS 오차를 한 도표에 비교하는 테일러·타깃 도표에 알맞습니다. 합성 자료입니다.',
    size: { min: 20, max: 400, default: 120, step: 10, label: '지점 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const o = 15 + 8 * Math.sin(i / 7) + r.normal(0, 3)
        return [`지점 ${pad(i + 1, 3)}`, round(o, 2), round(o + r.normal(0, 1.8), 2), round(15 + 1.6 * (o - 15) + r.normal(0, 4), 2), round(o + 4 + r.normal(0, 2.4), 2)]
      })
      return table([cat('지점'), num('관측'), num('모형 A'), num('모형 B'), num('모형 C')], rows)
    },
  },
  {
    id: 'water-chem', name: '지하수 이온 조성 (mg/L, 합성)', description: '네 가지 수질 유형(Ca-HCO3, Na-Cl, Ca-SO4, Na-HCO3)에서 뽑은 지하수 시료의 주요 이온 농도(mg/L)입니다. 양이온 삼각 좌표, 음이온 삼각 좌표, 중앙 마름모로 조성을 읽는 파이퍼 도표와 이온별 다각형으로 보는 스티프 도표에 알맞습니다. 합성 자료입니다.',
    size: { min: 4, max: 80, default: 24, step: 2, label: '시료 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const types: [string, number[]][] = [['Ca-HCO3', [90, 15, 12, 2, 300, 30, 18]], ['Na-Cl', [20, 8, 160, 8, 120, 40, 260]], ['Ca-SO4', [120, 30, 30, 4, 140, 260, 40]], ['Na-HCO3', [12, 4, 110, 3, 330, 35, 30]]]
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const [name, base] = types[i % 4]
        const f = Math.exp(r.normal(0, 0.25))
        return [`시료 ${pad(i + 1)}`, name, ...base.map((b) => Math.max(0.5, round(b * f * Math.exp(r.normal(0, 0.12)), 1)))]
      })
      return table([cat('시료'), cat('수질 유형'), num('Ca'), num('Mg'), num('Na'), num('K'), num('HCO3'), num('SO4'), num('Cl')], rows)
    },
  },
  {
    id: 'nomogram-model', name: '위험 예측 모형의 계수 (변수 범위와 로짓 계수, 합성)', description: '로지스틱 위험 모형의 변수별 값 범위(최솟값~최댓값)와 계수(변수 한 단위당 로그 오즈 변화), 환자 한 명의 현재 값입니다. 변수마다 점수 눈금을 만들어 총점을 확률로 바꾸는 노모그램에 알맞습니다. 임상 결론을 뜻하지 않는 합성 자료입니다.',
    generate: () => table([cat('변수'), num('최솟값'), num('최댓값'), num('계수'), num('현재 값')], [
      ['나이', 30, 90, 0.045, 64], ['종양 크기(cm)', 0.5, 10, 0.32, 3.2], ['림프절 전이 수', 0, 12, 0.21, 2], ['호르몬 수용체 양성(0/1)', 0, 1, -0.9, 1], ['운동량(주당 시간)', 0, 10, -0.12, 3],
    ]),
  },
  {
    id: 'sounding', name: '대기 연직 관측 (기압·기온·이슬점, 합성)', description: '기구가 올라가며 잰 기압(hPa)별 기온과 이슬점(°C)입니다. 지표 부근이 따뜻하고 습하며 중간층에 건조한 층이 있는 가상의 여름 오후 프로파일입니다. 기울어진 온도축과 로그 기압축 위에 단열선과 함께 그리는 스큐-T 로그-P 도표에 알맞습니다. 합성 자료입니다.',
    size: { min: 12, max: 60, default: 30, step: 2, label: '관측 층 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const p = 1000 - (800 * i) / (n - 1)
        const z = Math.log(1000 / p)
        const t = 27 - 52 * z + (p < 300 ? 18 * (0.3 - z) : 0) + r.normal(0, 0.25)
        const dry = p < 700 && p > 500 ? 14 : 0
        const td = Math.min(t - 1, 18 - 45 * z - dry + r.normal(0, 0.3))
        return [round(p, 0), round(t, 1), round(td, 1)]
      })
      return table([num('기압'), num('기온'), num('이슬점')], rows)
    },
  },
  {
    id: 'poset', name: '부분순서 관계 (약수 관계, 수식)', description: '자연수의 약수 관계(a가 b의 약수이면 a ≤ b)를 한 행에 한 쌍씩 적은 자료입니다. 이행적으로 따라오는 관계도 일부 적혀 있어, 피복 관계(바로 위 원소)만 남기는 하세 도표의 이행적 축약을 확인하기에 알맞습니다.',
    size: { min: 6, max: 30, default: 12, step: 1, label: '원소 수 (1…N)' },
    generate: (_seed, n) => {
      const rows: Cell[][] = []
      for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) if (b % a === 0) rows.push([`${a}`, `${b}`])
      return table([cat('아래 원소'), cat('위 원소')], rows)
    },
  },
  {
    id: 'org-links', name: '계층과 연결 관계 (부서 › 팀 › 담당과 협업 연결, 합성)', description: '가상 조직의 담당자(부문 › 팀 › 담당)와 담당자 사이의 협업 연결입니다. 한 행이 연결 하나(출발 담당 → 도착 담당)이며 같은 부문 안의 연결이 더 많습니다. 계층 구조를 선인장 모양으로 배치하고 계층 밖 연결을 묶어서 그리는 캑터스트리에 알맞습니다.',
    size: { min: 20, max: 120, default: 48, step: 4, label: '연결 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const units = ['연구', '제품', '영업', '운영']
      const people = units.flatMap((u, ui) => [0, 1].flatMap((t) => [0, 1, 2].map((k) => ({ u, team: `${u}${t + 1}팀`, name: `${u}${t + 1}-${k + 1}`, ui }))))
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const a = people[r.int(0, people.length - 1)]
        const same = r() < 0.55
        const pool = people.filter((p) => p.name !== a.name && (same ? p.u === a.u : p.u !== a.u))
        const b = pool[r.int(0, pool.length - 1)]
        rows.push([a.u, a.team, a.name, b.name])
      }
      return table([cat('부문'), cat('팀'), cat('담당'), cat('연결 대상')], rows)
    },
  },
  {
    id: 'doc-revisions', name: '문서 편집 이력 (버전별 구간과 저자, 합성)', description: '문서 한 편의 버전 열 개에서 문단(구간)별 저자와 길이입니다. 구간 ID가 같으면 같은 문단이며, 새 구간은 삽입, 사라진 구간은 삭제, 순서가 바뀐 구간은 이동입니다. 저자의 기여와 편집 과정을 연결된 색 띠로 보는 히스토리 플로에 알맞습니다. 합성 자료입니다.',
    size: { min: 4, max: 20, default: 10, step: 1, label: '버전 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const authors = ['가온', '나래', '다솜', '라온']
      let segs = Array.from({ length: 6 }, (_, i) => ({ id: `P${pad(i + 1)}`, author: '가온', len: r.int(3, 8) }))
      let next = 7
      const rows: Cell[][] = []
      for (let v = 1; v <= n; v++) {
        if (v > 1) {
          const author = authors[r.int(0, 3)]
          const op = r()
          if (op < 0.4) segs.splice(r.int(0, segs.length), 0, { id: `P${pad(next++)}`, author, len: r.int(2, 8) })
          else if (op < 0.6 && segs.length > 4) segs.splice(r.int(0, segs.length - 1), 1)
          else if (op < 0.8) { const i = r.int(0, segs.length - 1); segs[i] = { ...segs[i], author, len: Math.max(1, segs[i].len + r.int(-2, 3)) } }
          else { const i = r.int(0, segs.length - 1); const [s] = segs.splice(i, 1); segs.splice(r.int(0, segs.length), 0, s) }
          segs = segs.map((s) => ({ ...s }))
        }
        segs.forEach((s, i) => rows.push([v, s.id, s.author, s.len, i]))
      }
      return table([num('버전'), cat('구간'), cat('저자'), num('길이'), num('순서')], rows)
    },
  },
  {
    id: 'dynamic-network', name: '동적 네트워크 (시점별 간선과 가중치, 합성)', description: '노드 24개가 세 공동체로 나뉜 네트워크가 열두 시점에 걸쳐 변하는 자료입니다. 한 행이 시점 t의 간선 하나(노드 A, 노드 B, 가중치)이며, 공동체 안의 연결이 시간에 따라 켜지고 꺼지고 세 번째 시점 이후 공동체 사이 연결이 생깁니다. 시점마다 인접 행렬을 쌓은 행렬 큐브와 시간 띠에 간선을 밀도로 모은 평행 간선 스플래팅에 알맞습니다. 합성 자료입니다.',
    size: { min: 12, max: 60, default: 24, step: 3, label: '노드 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const T = 12
      const comm = (i: number) => Math.floor((i * 3) / n)
      const rows: Cell[][] = []
      for (let t = 1; t <= T; t++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const same = comm(i) === comm(j)
        const p = same ? 0.22 + 0.16 * Math.sin((t + comm(i) * 4) / 2) : t > 3 ? 0.025 * (t - 3) : 0
        if (r() < Math.max(0, p)) rows.push([t, `노드 ${pad(i + 1)}`, `노드 ${pad(j + 1)}`, r.int(1, 4)])
      }
      return table([num('시점'), cat('노드 A'), cat('노드 B'), num('가중치')], rows)
    },
  },
  {
    id: 'multi-field', name: '다변량 연속 필드 (격자 위 세 속성, 수식)', description: '평면 격자의 점마다 세 가지 속성(속성 1~3)이 정해진 연속 필드입니다. 속성 1은 두 봉우리, 속성 2는 대각선 기울기와 물결, 속성 3은 중심에서의 거리로 만든 수식이고, 격자 사이는 선형 보간으로 이어집니다. 필드의 속성 공간 밀도를 그리는 연속 산점도와 연속 평행 좌표에 알맞습니다.',
    size: { min: 10, max: 40, default: 24, step: 2, label: '축당 격자점 수' },
    generate: (_seed, n) => {
      const rows: Cell[][] = []
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = i / (n - 1), y = j / (n - 1)
        const a1 = Math.exp(-(((x - 0.3) ** 2 + (y - 0.35) ** 2) / 0.04)) + 0.7 * Math.exp(-(((x - 0.72) ** 2 + (y - 0.68) ** 2) / 0.05))
        const a2 = 0.6 * x - 0.4 * y + 0.12 * Math.sin(6 * x + 2 * y)
        const a3 = Math.hypot(x - 0.5, y - 0.5)
        rows.push([i, j, round(a1, 4), round(a2, 4), round(a3, 4)])
      }
      return table([num('x'), num('y'), num('속성 1'), num('속성 2'), num('속성 3')], rows)
    },
  },
  {
    id: 'road-network', name: '도로망 (지점 좌표와 구간 소요 시간, 합성)', description: '가상 도시의 지점 25곳(5×5 격자를 흔든 좌표)과 구간별 소요 시간(분)입니다. 가운데 가로선과 세로선은 고속도로라 같은 거리를 훨씬 빨리 갑니다. 한 행이 구간 하나(출발과 좌표, 도착과 좌표, 시간)이며, 출발지에서의 이동 시간에 맞춰 지도를 다시 그리는 이동시간 카토그램에 알맞습니다. 합성 자료입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const G = 5
      const pos = Array.from({ length: G * G }, (_, k) => [round((k % G) * 20 + r.normal(0, 3), 1), round(Math.floor(k / G) * 20 + r.normal(0, 3), 1)] as [number, number])
      const name = (k: number) => `지점 ${pad(k + 1)}`
      const rows: Cell[][] = []
      const link = (a: number, b: number) => {
        const d = Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1])
        const fast = (Math.floor(a / G) === 2 && Math.floor(b / G) === 2) || (a % G === 2 && b % G === 2)
        rows.push([name(a), pos[a][0], pos[a][1], name(b), pos[b][0], pos[b][1], round((d / (fast ? 2.4 : 0.35)) * (1 + 0.1 * r()), 1)])
      }
      for (let k = 0; k < G * G; k++) { if (k % G < G - 1) link(k, k + 1); if (k + G < G * G) link(k, k + G) }
      return table([cat('출발'), num('출발 x'), num('출발 y'), cat('도착'), num('도착 x'), num('도착 y'), num('시간')], rows)
    },
  },
  {
    id: 'kr-series', name: '시도별 연도 지표 (지수, 합성)', description: '17개 시도의 여섯 해(2018~2023) 지표 값(기준 연도 = 100인 지수)입니다. 지역마다 추세와 변동이 달라 지도 가장자리의 고리(연도별 한 겹)로 비교하기에 알맞습니다. 합성 자료이며 실제 통계가 아닙니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const rows: Cell[][] = koreaRows.map(([id, ko]) => {
        const trend = r.normal(1.5, 3), base = 100 + r.normal(0, 6)
        return [ko, id, ...[0, 1, 2, 3, 4, 5].map((y) => round(base + trend * y + r.normal(0, 2.2), 1))]
      })
      return table([cat('지역'), cat('ID'), ...[2018, 2019, 2020, 2021, 2022, 2023].map((y) => num(`${y}년`))], rows)
    },
  },
]
