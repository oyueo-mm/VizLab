import { createRng, round } from '../lib/random'
import type { DatasetDef } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })

/** v1.0 datasets (all synthetic). */
export const datasetsV10: DatasetDef[] = [
  {
    id: 'modular-graph', name: '공동체 구조가 있는 네트워크 (간선 목록, 합성)', description: '노드가 네 공동체로 나뉘고 같은 공동체 안에서 훨씬 촘촘하게 연결된 합성 네트워크입니다. 한 행이 간선 하나(노드 A, 노드 B, 가중치)입니다. 노드 수를 키워 인접 행렬이 점점 커지는 상황에서 다중 해상도 집계 행렬(ZAME)을 시험하기에 알맞습니다.',
    size: { min: 40, max: 600, default: 160, step: 20, label: '노드 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      const k = 4
      const comm = (i: number) => Math.min(k - 1, Math.floor((i * k) / n))
      const pIn = Math.min(0.5, 14 / (n / k)), pOut = Math.min(0.02, 0.8 / n)
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < (comm(i) === comm(j) ? pIn : pOut)) rows.push([`노드 ${String(i + 1).padStart(3, '0')}`, `노드 ${String(j + 1).padStart(3, '0')}`, r.int(1, 3)])
      return table([cat('노드 A'), cat('노드 B'), num('가중치')], rows)
    },
  },
  {
    id: 'label-points', name: '라벨이 있는 점 구름 (이름·위치·분류, 합성)', description: '평면(0~100)에 군집을 이루며 흩어진 점마다 이름과 분류가 붙은 합성 자료입니다. 점이 많아 이름을 모두 쓰면 겹치므로, 커서 주변의 점에만 이름을 붙이는 Excentric Labeling을 시험하기에 알맞습니다.',
    size: { min: 60, max: 1200, default: 320, step: 20, label: '점 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const centers: [number, number, string][] = [[25, 30, '가'], [68, 25, '나'], [45, 72, '다'], [80, 70, '라']]
      const names = ['강', '산', '들', '바다', '숲', '호수', '언덕', '마을', '다리', '섬']
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const c = centers[r.int(0, 3)]
        return [`${names[r.int(0, names.length - 1)]}${String(i + 1).padStart(3, '0')}`, round(Math.min(99, Math.max(1, r.normal(c[0], 9))), 1), round(Math.min(99, Math.max(1, r.normal(c[1], 9))), 1), c[2]]
      })
      return table([cat('이름'), num('x'), num('y'), cat('분류')], rows)
    },
  },
  {
    id: 'univ-ranking', name: '대학 평가 지표 (여섯 지표, 합성)', description: '가상 대학 스물네 곳의 여섯 평가 지표(연구, 교육, 취업, 재정, 국제화, 교수 1인당 학생 수)입니다. 마지막 지표는 낮을수록 좋습니다. 지표마다 가중치를 바꿔 순위가 어떻게 달라지는지 보는 다중 속성 순위 시각화(LineUp)의 입력입니다.',
    size: { min: 8, max: 60, default: 24, step: 2, label: '대학 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const q = r.normal(0, 1)
        const f = (base: number, w: number) => round(Math.min(100, Math.max(5, base + w * q * 10 + r.normal(0, 9))), 1)
        return [`${'가나다라마바사아자차카타파하'[i % 14]}${'대학교'}${Math.floor(i / 14) ? Math.floor(i / 14) + 1 : ''}`.trim(), f(60, 1), f(62, 0.8), f(58, 1.1), f(55, 0.6), f(50, 0.9), round(Math.min(40, Math.max(8, 22 - q * 3 + r.normal(0, 4))), 1)]
      })
      return table([cat('대학'), num('연구'), num('교육'), num('취업'), num('재정'), num('국제화'), num('교수당 학생 수')], rows)
    },
  },
  {
    id: 'survey-units', name: '직원 설문 응답 (부서·직급·만족도, 합성)', description: '직원 한 명이 한 행인 합성 설문입니다. 부서, 직급, 성별과 만족도 점수(0~100)가 있습니다. 응답 하나하나를 하나의 단위로 그려 부서·직급별로 나누는 단위 시각화(Atom 문법)에 알맞습니다.',
    size: { min: 40, max: 400, default: 120, step: 10, label: '응답 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const depts = ['개발', '디자인', '영업', '운영'], ranks = ['사원', '대리', '과장'], bias: Record<string, number> = { 개발: 66, 디자인: 72, 영업: 58, 운영: 62 }
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const d = depts[Math.min(3, Math.floor(r() ** 1.2 * 4))], rk = ranks[r.int(0, 2)]
        return [`응답 ${String(i + 1).padStart(3, '0')}`, d, rk, r() < 0.5 ? '여' : '남', Math.round(Math.min(100, Math.max(5, bias[d] + (rk === '과장' ? 6 : rk === '사원' ? -4 : 0) + r.normal(0, 14))))]
      })
      return table([cat('응답'), cat('부서'), cat('직급'), cat('성별'), num('만족도')], rows)
    },
  },
  {
    id: 'terrain-field', name: '봉우리가 여럿인 스칼라장 (격자, 수식)', description: '여러 개의 봉우리와 골짜기가 겹친 이차원 스칼라장을 정사각 격자에 표본한 자료입니다. 한 행이 한 격자점의 위치(x, y)와 값입니다. 극대·극소·안장점 같은 위상 구조를 해석하는 데 알맞습니다. 시드가 바뀌면 봉우리의 위치와 높이가 달라집니다.',
    size: { min: 20, max: 64, default: 40, step: 2, label: '축당 격자점 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const peaks = Array.from({ length: 6 }, () => [r() * n, r() * n, 0.3 + r() * 0.8, n * (0.07 + r() * 0.06)] as const)
      const rows: Cell[][] = []
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) rows.push([i, j, round(peaks.reduce((a, [cx, cy, h, s]) => a + h * Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / (2 * s * s)), 0) + 0.004 * Math.sin(i * 1.7) * Math.cos(j * 1.3), 5)])
      return table([num('x'), num('y'), num('값')], rows)
    },
  },
  {
    id: 'noisy-field', name: '불확실한 스칼라장 (평균과 표준편차 격자, 수식)', description: '이차원 스칼라장의 평균과 격자점마다 다른 표준편차(왼쪽이 정밀하고 오른쪽이 불확실)를 정사각 격자에 적은 자료입니다. 한 행이 한 격자점입니다. 격자점의 값이 독립적인 정규분포를 따른다고 가정하고 등치선의 위치가 얼마나 불확실한지 보는 데 알맞습니다.',
    size: { min: 16, max: 60, default: 32, step: 2, label: '축당 격자점 수' },
    generate: (_seed, n) => {
      const rows: Cell[][] = []
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = i / (n - 1), y = j / (n - 1)
        rows.push([i, j, round(0.5 + 0.35 * Math.sin(3.2 * x) * Math.cos(2.6 * y) + 0.18 * Math.exp(-((x - 0.7) ** 2 + (y - 0.3) ** 2) / 0.03), 5), round(0.015 + 0.1 * x * x, 5)])
      }
      return table([num('x'), num('y'), num('평균'), num('표준편차')], rows)
    },
  },
  {
    id: 'ensemble-curves', name: '앙상블 시뮬레이션 곡선 (멤버별 시계열, 합성)', description: '같은 모형을 초기값만 바꿔 여러 번 돌린 앙상블의 결과입니다. 한 행이 ‘한 멤버, 한 시점’의 값이고, 대부분의 멤버는 비슷하게 움직이지만 몇 개는 크게 벗어납니다. 곡선 묶음의 중앙값·대표 범위·이상 곡선을 보는 함수형 상자그림에 알맞습니다.',
    size: { min: 20, max: 120, default: 50, step: 5, label: '멤버 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const T = 48
      const rows: Cell[][] = []
      for (let m = 0; m < n; m++) {
        const out = m % 17 === 5
        const amp = 1 + r.normal(0, 0.12) + (out ? 0.9 : 0), ph = r.normal(0, 0.25) + (out ? 0.7 : 0), off = r.normal(0, 0.35) + (out ? 1.4 : 0)
        for (let t = 0; t < T; t++) rows.push([`멤버 ${String(m + 1).padStart(3, '0')}`, t, round(off + amp * Math.sin(t / 7 + ph) + 0.02 * t + r.normal(0, 0.05), 3)])
      }
      return table([cat('멤버'), num('시점'), num('값')], rows)
    },
  },
  {
    id: 'class-scatter', name: '빽빽한 세 분류의 산점도 (이상치 포함, 합성)', description: '세 분류가 크게 겹치는 점 천오백 개와 멀리 떨어진 이상치 몇 개입니다. 한 행이 한 점의 위치(x, y)와 분류입니다. 점이 겹쳐 그려지는 문제(overdraw)를 분류별 밀도 윤곽과 바깥 점으로 해결하는 스플래터플롯에 알맞습니다.',
    size: { min: 200, max: 6000, default: 1500, step: 100, label: '점 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const cl: [number, number, number, number, string][] = [[40, 45, 9, 7, '가'], [55, 50, 8, 9, '나'], [48, 62, 7, 6, '다']]
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const c = cl[i % 3]
        return [round(r.normal(c[0], c[2]), 2), round(r.normal(c[1], c[3]), 2), c[4]]
      })
      for (let k = 0; k < 6; k++) rows.push([round(8 + r() * 84, 2), round(8 + r() * 84, 2), '가나다'[k % 3]])
      return table([num('x'), num('y'), cat('분류')], rows)
    },
  },
  {
    id: 'discrete-pairs', name: '정수 점수 쌍 (겹치는 점이 많은 두 변수, 합성)', description: '1~10의 정수로 된 두 점수(예: 수업 만족도와 추천 의향)를 학생마다 적은 자료입니다. 같은 값의 점이 많이 겹치므로 점 하나하나가 아니라 겹친 개수를 해바라기 꽃잎 수로 표시하는 선플라워 플롯에 알맞습니다.',
    size: { min: 40, max: 800, default: 300, step: 20, label: '응답 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, () => {
        const a = Math.min(10, Math.max(1, Math.round(r.normal(6.3, 1.9))))
        return [a, Math.min(10, Math.max(1, Math.round(0.7 * a + 2 + r.normal(0, 1.3))))]
      })
      return table([num('만족도'), num('추천 의향')], rows)
    },
  },
  {
    id: 'exam-scores', name: '시험 점수 (정수, 합성)', description: '학생 육십 명의 시험 점수(정수)입니다. 두 개의 봉우리가 있는 분포라 값 자체를 줄기와 잎으로 늘어놓는 줄기-잎 그림에서 분포의 모양이 그대로 보입니다.',
    size: { min: 20, max: 300, default: 60, step: 5, label: '학생 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => [`학생 ${String(i + 1).padStart(3, '0')}`, Math.round(Math.min(100, Math.max(20, r() < 0.62 ? r.normal(72, 9) : r.normal(48, 8))))])
      return table([cat('학생'), num('점수')], rows)
    },
  },
  {
    id: 'count-data', name: '사건 횟수 (과분산된 계수 자료, 합성)', description: '개체마다 일정 기간에 일어난 사건 횟수(0, 1, 2, …)입니다. 평균은 같아도 포아송 분포보다 흩어짐이 큰(과분산) 자료로, 포아송 적합의 기대 빈도와 관측 빈도의 차이를 보는 걸린 루트그램에 알맞습니다.',
    size: { min: 50, max: 1000, default: 300, step: 50, label: '개체 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const lam = Math.exp(r.normal(0.55, 0.75))
        let k = 0, p = 1; const L = Math.exp(-lam)
        do { k++; p *= r() } while (p > L)
        return [`개체 ${String(i + 1).padStart(3, '0')}`, k - 1]
      })
      return table([cat('개체'), num('사건 수')], rows)
    },
  },
  {
    id: 'income-dist', name: '가구 소득 (치우친 분포, 합성)', description: '가구 백 곳의 연 소득(만원)입니다. 오른쪽으로 길게 치우친 로그정규 분포라 소수의 가구가 큰 몫을 차지합니다. 누적 인구 비율에 대한 누적 소득 비율을 그리는 로렌츠 곡선과 지니계수에 알맞습니다.',
    size: { min: 20, max: 1000, default: 100, step: 10, label: '가구 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([cat('가구'), num('소득')], Array.from({ length: n }, (_, i) => [`가구 ${String(i + 1).padStart(3, '0')}`, Math.round(Math.exp(r.normal(8.1, 0.65)))]))
    },
  },
  {
    id: 'sensitivity', name: '민감도 분석 (변수별 낮은·높은 값의 결과, 합성)', description: '사업 모형의 입력 변수를 하나씩만 낮은 값·높은 값으로 바꿨을 때의 결과(순이익, 억 원)입니다. 변수마다 영향이 크게 다르고, ‘기준’ 열은 모든 변수를 기준값으로 둔 결과입니다. 영향이 큰 변수부터 보여 주는 토네이도 차트에 알맞습니다.',
    generate: () => table([cat('변수'), num('낮은 값 결과'), num('높은 값 결과'), num('기준')], [['판매 단가', 62, 146, 100], ['판매량', 71, 131, 100], ['원가율', 128, 78, 100], ['환율', 88, 117, 100], ['인건비', 109, 91, 100], ['광고비', 96, 108, 100], ['임대료', 103, 97, 100], ['금리', 101, 99, 100]]),
  },
  {
    id: 'bag-points', name: '두 변수 표본 (이상점 포함, 합성)', description: '상관이 있는 두 변수(키 대신 임의 단위)의 표본 점들입니다. 몇 개의 점이 중심에서 멀리 떨어져 있어, 가운데 절반을 감싸는 가방과 이상점을 가르는 울타리를 그리는 이변량 상자그림(백플롯)에 알맞습니다.',
    size: { min: 30, max: 300, default: 100, step: 10, label: '점 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const out = i % 25 === 24
        const a = r.normal(0, 1), b = 0.7 * a + r.normal(0, 0.7)
        return [`표본 ${String(i + 1).padStart(3, '0')}`, round(50 + 10 * a * (out ? 2.6 : 1), 2), round(50 + 10 * b * (out ? 2.6 : 1) + (out ? 8 : 0), 2)]
      })
      return table([cat('표본'), num('변수 X'), num('변수 Y')], rows)
    },
  },
  {
    id: 'likert-survey', name: '5점 척도 설문 (문항·응답 수, 합성)', description: '문항 여덟 개에 대한 5점 척도(1 = 전혀 아니다, 5 = 매우 그렇다) 응답 수입니다. 한 행이 문항·응답 단계 한 쌍이며, 가운데(3)를 기준으로 부정과 긍정이 양쪽으로 뻗는 발산형 쌓은 막대에 알맞습니다.',
    size: { min: 40, max: 1000, default: 200, step: 20, label: '문항당 응답자 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const items = ['업무 만족', '동료 관계', '급여 수준', '성장 기회', '업무 강도', '상사 신뢰', '복지 제도', '조직 문화']
      const rows: Cell[][] = []
      items.forEach((name, k) => {
        const mu = 2.2 + 0.4 * ((k * 5) % 7) / 2, counts = [0, 0, 0, 0, 0]
        for (let i = 0; i < n; i++) counts[Math.min(4, Math.max(0, Math.round(r.normal(mu, 1.15)) - 1))]++
        counts.forEach((c, l) => rows.push([name, l + 1, c]))
      })
      return table([cat('문항'), num('응답 단계'), num('응답 수')], rows)
    },
  },
  {
    id: 'risk-prediction', name: '위험 예측 모형 (결과·예측 위험, 합성)', description: '환자 한 명이 한 행이며 실제 결과(1 = 사건 발생)와 두 예측 모형이 낸 위험 확률(0~1)이 있습니다. 모형 A는 변별력이 좋고 모형 B는 약한 모형이라, 어떤 임계 확률에서 모형을 따르는 것이 이득인지를 순이득 곡선으로 비교하기에 알맞습니다.',
    size: { min: 100, max: 2000, default: 500, step: 50, label: '환자 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v))
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const z = r.normal(0, 1), p = 1 / (1 + Math.exp(-(-1.6 + 1.3 * z))), y = r() < p ? 1 : 0
        const a = clamp(1 / (1 + Math.exp(-(-1.6 + 1.3 * z + 0.5 * r.normal(0, 1)))))
        const b = clamp(1 / (1 + Math.exp(-(-1.4 + 0.5 * z + 0.9 * r.normal(0, 1)))))
        return [`환자 ${String(i + 1).padStart(4, '0')}`, y, round(a, 3), round(b, 3)]
      })
      return table([cat('환자'), num('결과'), num('모형 A 위험'), num('모형 B 위험')], rows)
    },
  },
]
