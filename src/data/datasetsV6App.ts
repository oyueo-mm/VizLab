import { createRng, round } from '../lib/random'
import { buildBackbone } from '../stats/applied'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

const weibullSample = (r: () => number, beta: number, eta: number) => eta * (-Math.log(1 - r())) ** (1 / beta)

function lifeData(beta: number, eta: number, cut: number) {
  return (seed: number, n: number) => {
    const r = createRng(seed)
    const rows: Cell[][] = Array.from({ length: n }, () => { const t = weibullSample(r, beta, eta); return t > cut ? [cut, '중단'] : [round(t, 1), '고장'] })
    return table([num('수명(시간)'), cat('상태')], rows)
  }
}

const CORPUS_TOPICS: Record<string, string[]> = {
  날씨: ['비', '구름', '기온', '바람', '태풍', '습도', '맑음', '안개', '폭우', '한파', '일교차', '강수량'],
  경제: ['금리', '물가', '환율', '수출', '성장률', '소비', '투자', '고용', '부채', '무역', '주가', '예산'],
  스포츠: ['경기', '선수', '득점', '감독', '우승', '리그', '수비', '공격', '훈련', '부상', '관중', '기록'],
}
const FUNCTION_WORDS = ['오늘', '올해', '최근', '전문가', '관계자', '전망', '발표', '확대', '증가', '감소']

const SYL = ['ka', 'mi', 'to', 'ru', 'se', 'no', 'va', 'li', 'ge', 'po', 'da', 'ni', 'zu', 'he', 'bo', 'fa']

export const datasetsV6App: DatasetDef[] = [
  { id: 'life-wearout', name: '베어링 수명 시험 (마모 고장, 합성)', description: '형상 β = 2.4, 척도 η = 1200시간인 와이블 분포에서 뽑은 가상 베어링 수명입니다. 1500시간에 시험을 중단해 그때까지 고장 나지 않은 개체는 \'중단\'(우측 중도절단)으로 표시했습니다. 실제 시험 자료가 아닙니다.', size: sizes(20, 8, 200, 4, '시험 개체 수'), generate: lifeData(2.4, 1200, 1500) },
  { id: 'life-early', name: '전자 부품 수명 시험 (초기 불량, 합성)', description: '형상 β = 0.7, 척도 η = 800시간인 와이블 분포에서 뽑은 가상 부품 수명입니다. β < 1이라 사용 초기에 고장이 몰립니다(영아 사망). 1000시간에서 시험을 중단했습니다. 합성 자료입니다.', size: sizes(25, 8, 200, 4, '시험 개체 수'), generate: lifeData(0.7, 800, 1000) },
  {
    id: 'stack-gearbox', name: '기어박스 조립 공차 (합성)', description: '축 방향 틈새를 이루는 다섯 부품의 공칭 치수와 공차입니다. 방향 +1은 틈새를 줄이고 −1은 늘립니다(하우징은 +, 나머지는 −). 한 행이 부품 하나이며 합성 값입니다.',
    generate: () => table([cat('부품'), num('공칭(mm)'), num('상한 공차(+)'), num('하한 공차(−)'), cat('분포'), num('방향')], [
      ['하우징', 62.0, 0.12, 0.12, 'normal', 1], ['베어링 A', 12.0, 0.05, 0.05, 'normal', -1], ['스페이서', 25.0, 0.08, 0.08, 'uniform', -1], ['기어', 12.5, 0.06, 0.06, 'normal', -1], ['베어링 B', 12.0, 0.05, 0.05, 'triangular', -1],
    ]),
  },
  {
    id: 'queue-orders', name: '창구 도착·서비스 기록 (합성)', description: '한 지점 창구에 고객이 도착한 시각(분)과 처리에 걸린 시간(분) 기록입니다. 도착 간격은 평균 1.5분의 지수분포에 점심시간 몰림을 더했고 서비스 시간은 평균 2.4분의 지수분포입니다. 합성 자료입니다.',
    size: sizes(200, 30, 2000, 10, '고객 수'),
    generate: (seed, n) => {
      const r = createRng(seed); let t = 0
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const rush = i > n * 0.4 && i < n * 0.6 ? 0.55 : 1
        t += -Math.log(1 - r()) * 1.5 * rush
        return [round(t, 2), round(-Math.log(1 - r()) * 2.4, 2)]
      })
      return table([num('도착 시각(분)'), num('처리 시간(분)')], rows)
    },
  },
  {
    id: 'log-orders', name: '주문 처리 이벤트 로그 (합성)', description: '주문 접수부터 배송 완료까지의 처리 기록입니다. 한 행이 이벤트 하나(건, 활동, 시각(시간))이며 재고 부족으로 재입고를 기다리거나 신용 심사를 거치는 변형이 섞여 있습니다. 합성 자료입니다.',
    size: sizes(80, 10, 500, 10, '주문 건수'),
    generate: (seed, n) => {
      const r = createRng(seed), rows: Cell[][] = []
      for (let c = 0; c < n; c++) {
        let t = c * 0.7; const id = `주문 ${String(c + 1).padStart(3, '0')}`
        const push = (a: string, dt: number) => { t += dt * (0.6 + 0.8 * r()); rows.push([id, a, round(t, 2)]) }
        push('주문 접수', 0)
        push('재고 확인', 0.5)
        if (r() < 0.25) { push('재입고 대기', 20); push('재고 확인', 1) }
        push(r() < 0.3 ? '신용 심사' : '결제 확인', 1.5)
        if (r() < 0.08) { push('주문 취소', 2); continue }
        push('포장', 3); push('출하', 4)
        if (r() < 0.1) push('재포장', 2)
        push('배송 완료', 24)
      }
      return table([cat('건'), cat('활동'), num('시각(시간)')], rows)
    },
  },
  {
    id: 'tree-pump', name: '냉각 펌프 계통 고장 수목 (합성)', description: '냉각수 공급 상실(최상위 사건)에 이르는 고장 수목입니다. 한 행이 연결 하나(상위 게이트, 하위 사건, 상위 게이트 유형, 하위가 기본 사건일 때의 고장 확률)입니다. 유형은 AND, OR 또는 2/3처럼 k/n 표결 게이트입니다. 확률은 합성 값입니다.',
    generate: () => table([cat('상위'), cat('하위'), cat('게이트'), num('고장 확률')], [
      ['냉각수 공급 상실', '펌프 계통 고장', 'OR', 0], ['냉각수 공급 상실', '전원 상실', 'OR', 0], ['냉각수 공급 상실', '배관 막힘', 'OR', 0.002],
      ['펌프 계통 고장', '주 펌프 고장', 'AND', 0.05], ['펌프 계통 고장', '예비 펌프 고장', 'AND', 0.08],
      ['전원 상실', '외부 전력 상실', 'AND', 0.03], ['전원 상실', '비상 발전기 고장', 'AND', 0.04],
      ['외부 전력 상실', '선로 고장', '2/3', 0.02], ['외부 전력 상실', '변압기 고장', '2/3', 0.015], ['외부 전력 상실', '차단기 오작동', '2/3', 0.01],
    ].map(([a, b, g, p]) => [a, b, g, p] as Cell[])),
  },
  {
    id: 'gsea-expr', name: '순위화한 유전자 목록과 유전자 집합 (합성)', description: '발현 변화 통계량으로 순위를 매긴 가상 유전자 목록입니다. 경로 A는 위쪽(상향)에, 경로 B는 아래쪽(하향)에 몰려 있고 경로 C는 무작위입니다(1 = 집합에 속함). 실제 유전자 자료가 아니며 이름은 G0001 같은 번호입니다.',
    size: sizes(1500, 300, 6000, 100, '유전자 수'),
    generate: (seed, n) => {
      const r = createRng(seed), setN = Math.max(20, Math.round(n * 0.03))
      const score = Array.from({ length: n }, () => r.normal() * 1.2)
      const order = score.map((_, i) => i).sort((a, b) => score[b] - score[a])
      const rank = new Array<number>(n)
      order.forEach((g, k) => { rank[g] = k })
      const pick = (bias: (k: number) => number) => { const s = new Set<number>(); while (s.size < setN) { const g = Math.floor(r() * n); if (r() < bias(rank[g])) s.add(g) } return s }
      const A = pick((k) => (k < n * 0.25 ? 1 : 0.12)), B = pick((k) => (k > n * 0.75 ? 1 : 0.12)), C = pick(() => 1)
      return table([cat('유전자'), num('점수'), num('경로 A'), num('경로 B'), num('경로 C')], order.map((g) => [`G${String(g + 1).padStart(4, '0')}`, round(score[g], 3), A.has(g) ? 1 : 0, B.has(g) ? 1 : 0, C.has(g) ? 1 : 0]))
    },
  },
  {
    id: 'msa-kinase', name: '단백질 가족 다중 서열 정렬 (합성)', description: '가상의 단백질 가족 14개 서열을 하나의 조상 서열에서 부위마다 다른 속도로 돌연변이시켜 만든 정렬입니다. 보존된 모티프(GXGXXG, DFG, HRD)가 있고 일부에 삽입·결실(−)이 있습니다. 실제 단백질이 아닙니다.',
    size: sizes(14, 6, 40, 1, '서열 수'),
    generate: (seed, n) => {
      const r = createRng(seed), AA = 'ACDEFGHIKLMNPQRSTVWY'
      const anc = Array.from({ length: 70 }, () => AA[Math.floor(r() * 20)])
      const motif = (at: number, s: string) => [...s].forEach((ch, i) => { anc[at + i] = ch })
      motif(10, 'GAGSFG'); motif(38, 'HRD'); motif(52, 'DFG'); motif(60, 'APE')
      const rate = anc.map((_, i) => ((i >= 10 && i < 16) || (i >= 38 && i < 41) || (i >= 52 && i < 55) || (i >= 60 && i < 63) ? 0.03 : 0.25 + 0.5 * r()))
      const rows: Cell[][] = Array.from({ length: n }, (_, k) => {
        const seq = anc.map((a, i) => (r() < rate[i] ? AA[Math.floor(r() * 20)] : a))
        if (r() < 0.3) { const at = 20 + Math.floor(r() * 12); for (let i = 0; i < 3; i++) seq[at + i] = '-' }
        return [`서열 ${k + 1}`, seq.join('')]
      })
      return table([cat('이름'), cat('서열')], rows)
    },
  },
  {
    id: 'backbone-bundle', name: '합성 단백질 골격 좌표 (나선–턴–나선–가닥)', description: '잔기마다 φ/ψ 이각을 정해 이상적인 결합 길이·각도로 쌓은 가상 펩타이드 골격의 N·Cα·C 좌표(Å)입니다. 나선 두 개와 가닥 하나를 턴으로 이었습니다. 실제 단백질 구조(PDB)가 아닙니다.',
    generate: () => {
      const r = createRng(7)
      const seg = (n: number, phi: number, psi: number) => Array.from({ length: n }, () => [phi + r.normal() * 7, psi + r.normal() * 7] as const)
      const angles = [...seg(14, -57, -47), ...seg(1, -80, 150), ...seg(1, 60, 40), ...seg(1, -90, 0), ...seg(12, -57, -47), ...seg(2, -70, 140), ...seg(8, -120, 130)]
      const atoms = buildBackbone(angles.map((a) => a[0]), angles.map((a) => a[1]))
      return table([num('잔기'), cat('원자'), num('x'), num('y'), num('z')], atoms.map((a) => [a.residue + 1, a.atom, round(a.xyz[0], 3), round(a.xyz[1], 3), round(a.xyz[2], 3)]))
    },
  },
  {
    id: 'corpus-topics', name: '주제가 바뀌는 합성 뉴스 문장 (날씨·경제·스포츠)', description: '날씨, 경제, 스포츠 세 주제의 어휘에서 문장을 만든 가상 말뭉치입니다. 앞부분은 날씨, 중간은 경제, 뒷부분은 스포츠 문장이 많아 단어의 분포가 한쪽에 몰리고 같은 주제의 단어가 함께 나타납니다. 한 행이 문장 하나이며 실제 기사가 아닙니다.',
    size: sizes(150, 30, 600, 10, '문장 수'),
    generate: (seed, n) => {
      const r = createRng(seed), names = Object.keys(CORPUS_TOPICS)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const u = i / n, w = [Math.max(0.05, 1 - 2.5 * u), 0.25 + 0.5 * Math.exp(-((u - 0.5) ** 2) / 0.05), Math.max(0.05, 2.5 * u - 1.5)]
        let x = r() * (w[0] + w[1] + w[2]), k = 0
        while (k < 2 && x > w[k]) { x -= w[k]; k++ }
        const vocab = CORPUS_TOPICS[names[k]]
        const words = Array.from({ length: 6 }, () => (r() < 0.8 ? vocab[Math.floor(r() * vocab.length)] : FUNCTION_WORDS[Math.floor(r() * FUNCTION_WORDS.length)]))
        return [i + 1, words.join(' ')]
      })
      return table([num('번호'), cat('문장')], rows)
    },
  },
  {
    id: 'corpus-zipf', name: '지프 법칙을 따르는 합성 말뭉치', description: '800개의 가상 단어(음절 조합)를 순위 r에 반비례하는 확률(r^−1.05)로 뽑아 이은 합성 텍스트입니다. 한 행이 10단어짜리 줄입니다. 실제 언어 자료가 아닙니다.',
    size: sizes(300, 40, 3000, 20, '줄 수'),
    generate: (seed, n) => {
      const r = createRng(seed), V = 800
      const vocab = Array.from({ length: V }, (_, i) => `${SYL[i % 16]}${SYL[Math.floor(i / 16) % 16]}${i >= 256 ? SYL[Math.floor(i / 256) % 16] : ''}`)
      const cdf: number[] = []; let acc = 0
      for (let i = 1; i <= V; i++) { acc += i ** -1.05; cdf.push(acc) }
      const draw = () => { const x = r() * acc; let lo = 0, hi = V - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < x) lo = m + 1; else hi = m } return vocab[lo] }
      return table([num('번호'), cat('줄')], Array.from({ length: n }, (_, i) => [i + 1, Array.from({ length: 10 }, draw).join(' ')]))
    },
  },
]
