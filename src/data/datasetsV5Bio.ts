import { createRng, round } from '../lib/random'
import { erfc } from '../stats/distributions'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

/** Approximate lengths (Mb) of human chromosomes 1–22 (GRCh37), used only to lay out synthetic association results. */
export const CHROM_MB = [249, 243, 198, 191, 181, 171, 159, 146, 141, 136, 135, 134, 115, 107, 102, 90, 81, 78, 59, 63, 48, 51]

const pTwoSided = (z: number) => erfc(Math.abs(z) / Math.SQRT2)

export const datasetsV5Bio: DatasetDef[] = [
  {
    id: 'de-genes', name: '차등 발현 유전자 (합성)', description: '두 조건을 비교한 가상의 유전자별 결과입니다: log₂ 배수 변화(log2FC), p 값, 평균 발현량입니다. 약 8%의 유전자가 실제로 변하도록 만든 합성 데이터이며 실제 유전체 자료가 아닙니다. 발현량이 낮을수록 변동이 커서 p 값이 덜 유의해집니다.',
    size: sizes(2000, 200, 10000, 200, '유전자 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const a = Math.exp(r.normal(5.2, 1.7))
        const real = r() < 0.08
        const effect = real ? (r() < 0.5 ? -1 : 1) * (0.7 + 1.8 * r()) : 0
        const se = 1.15 / Math.sqrt(Math.sqrt(a + 1)) + 0.04
        const bias = 0.1 * Math.max(0, 5 - Math.log2(a + 1))
        const fc = effect + bias + r.normal(0, se)
        rows.push([`G${String(i + 1).padStart(4, '0')}`, round(fc, 3), Math.max(1e-300, pTwoSided((fc - bias) / se)), Math.round(a)])
      }
      return table([cat('유전자'), num('log2FC'), num('p값'), num('평균 발현')], rows.map((x) => [x[0], x[1], Number((x[2] as number).toPrecision(4)), x[3]]))
    },
  },
  {
    id: 'gwas-synth', name: '전장 유전체 연관 분석 결과 (합성)', description: '염색체 1~22에 흩어진 가상의 변이(SNP)별 연관 검정 p 값입니다. 대부분은 무작위(균일 분포)이고 다섯 곳에 연관 신호(봉우리)를 심은 합성 데이터이며, 염색체 길이는 사람 상염색체와 비슷한 규모로 정했습니다. 실제 환자나 유전체 자료가 아닙니다.',
    size: sizes(4000, 500, 40000, 500, 'SNP 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const peaks: [number, number, number][] = [[6, 32, 14], [11, 60, 9], [16, 28, 7.5], [2, 135, 10], [19, 33, 6.5]]
      const total = CHROM_MB.reduce((a, b) => a + b, 0)
      const rows: Cell[][] = []
      const snps: [number, number][] = []
      for (let i = 0; i < n; i++) {
        let u = r() * total, c = 0
        while (c < 21 && u > CHROM_MB[c]) { u -= CHROM_MB[c]; c++ }
        snps.push([c + 1, u])
      }
      // dense clusters at the peaks so the signals have several supporting SNPs
      for (const [pc, pm] of peaks) for (let k = 0; k < 22; k++) snps.push([pc, Math.max(0.1, pm + r.normal(0, 0.6))])
      snps.forEach(([c, mb], i) => {
        let logp = -Math.log10(Math.max(1e-300, r()))
        for (const [pc, pm, h] of peaks) if (pc === c) logp = Math.max(logp, h * Math.exp(-((mb - pm) ** 2) / (2 * 0.5 ** 2)) * (0.65 + 0.35 * r()))
        rows.push([`rs${100000 + i}`, c, Math.round(mb * 1e6), Number((10 ** -logp).toPrecision(4))])
      })
      return table([cat('SNP'), num('염색체'), num('위치'), num('p값')], rows)
    },
  },
  {
    id: 'binding-sites', name: '전사인자 결합 부위 서열 (합성)', description: '같은 길이로 정렬한 DNA 서열(14염기) 여러 개입니다. 가운데 8염기는 가상의 결합 모티프 TATAAGCT 주위로 보존되고 양쪽 끝은 무작위인 합성 데이터입니다. 서열 로고가 보존된 위치를 어떻게 보여 주는지 연습합니다.',
    size: sizes(40, 5, 300, 5, '서열 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const motif = 'TATAAGCT'
      const cons = [0.95, 0.9, 0.85, 0.8, 0.6, 0.7, 0.85, 0.9]
      const L = 'ACGT'
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        let s = ''
        for (let k = 0; k < 3; k++) s += L[Math.floor(r() * 4)]
        for (let k = 0; k < 8; k++) s += r() < cons[k] ? motif[k] : L[Math.floor(r() * 4)]
        for (let k = 0; k < 3; k++) s += L[Math.floor(r() * 4)]
        return [`seq${String(i + 1).padStart(3, '0')}`, s]
      })
      return table([cat('이름'), cat('서열')], rows)
    },
  },
  {
    id: 'coverage-synth', name: '시퀀싱 깊이 (합성, 한 영역)', description: '한 유전체 영역을 위치별로 읽은 깊이(몇 번 읽혔는가)의 합성 데이터입니다. 평균 약 30배이며 GC 함량 같은 편향으로 완만하게 오르내리고, 읽히지 않는 구간 두 곳과 중복 증폭 구간 한 곳이 들어 있습니다. 실제 시퀀싱 자료가 아닙니다.',
    size: sizes(1500, 300, 6000, 100, '구간(bin) 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const x = i / n
        let mu = 30 + 6 * Math.sin(x * 14) + 3 * Math.sin(x * 41)
        if (x > 0.22 && x < 0.26) mu = 1.5
        if (x > 0.61 && x < 0.64) mu = 3
        if (x > 0.8 && x < 0.86) mu *= 2
        const d = Math.max(0, Math.round(mu + r.normal(0, Math.sqrt(Math.max(mu, 1)) * 1.1)))
        rows.push([i * 100 + 1, d])
      }
      return table([num('위치'), num('깊이')], rows)
    },
  },
  {
    id: 'microbiome-dist', name: '군집 간 거리 행렬 (합성, Bray–Curtis)', description: '세 환경에서 모은 가상의 미생물 군집 시료들 사이의 Bray–Curtis 비유사도를 한 행이 시료 하나, 한 열이 다른 시료까지의 거리인 정방 행렬로 적은 표입니다. 환경마다 군집 구성이 다르게 만든 합성 데이터입니다.',
    size: sizes(18, 6, 36, 3, '시료 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const taxa = 30
      const env = [0, 1, 2]
      const prof = env.map(() => Array.from({ length: taxa }, () => Math.exp(r.normal(0, 1.2))))
      const ab = Array.from({ length: n }, (_, i) => { const e = i % 3; return prof[e].map((p) => Math.max(0, Math.round(p * 40 * (0.6 + 0.8 * r())))) })
      const bc = (a: number[], b: number[]) => { let num2 = 0, den = 0; for (let k = 0; k < taxa; k++) { num2 += Math.abs(a[k] - b[k]); den += a[k] + b[k] } return den ? num2 / den : 0 }
      const names = ab.map((_, i) => `S${String(i + 1).padStart(2, '0')}`)
      const names2 = ['토양', '하천', '장 내']
      const cols: Column[] = [cat('시료'), cat('환경'), ...names.map(num)]
      return table(cols, ab.map((a, i) => [names[i], names2[i % 3], ...ab.map((b) => round(bc(a, b), 4))]))
    },
  },
  {
    id: 'expression-matrix', name: '유전자 × 시료 발현 행렬 (합성)', description: '가상의 유전자(행) 여러 개의 12개 시료(열) 발현량입니다. 유전자는 세 묶음으로 서로 다른 발현 패턴(시료 1~6에서 높음, 7~12에서 높음, 일정)을 따르도록 만들었습니다. 군집화 히트맵이 이 묶음을 찾는지 확인하는 합성 데이터입니다.',
    size: sizes(36, 9, 120, 3, '유전자 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const cols: Column[] = [cat('유전자'), ...Array.from({ length: 12 }, (_, j) => num(`시료${j + 1}`))]
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const g = i % 3
        return [`Gene${String(i + 1).padStart(3, '0')}`, ...Array.from({ length: 12 }, (_, j) => { const base = 8 + (g === 0 ? (j < 6 ? 3 : -2) : g === 1 ? (j < 6 ? -2.5 : 3.2) : 0.4 * Math.sin(j)); return round(base + r.normal(0, 0.9) + (i % 7) * 0.15, 2) })]
      })
      return table(cols, rows)
    },
  },
  {
    id: 'species-dist', name: '종 사이의 유전적 거리 행렬 (합성)', description: '가상의 10개 종 사이 거리를 정방 행렬로 적은 표입니다. 두 개의 큰 가지로 갈라지는 진화 나무에서 가지마다 진화 속도를 다르게 줘 만든 합성 데이터이며, UPGMA(속도 일정 가정)와 이웃 연결법의 결과가 다를 수 있습니다. 실제 종이나 서열이 아닙니다.',
    generate: () => {
      const names = ['종 A', '종 B', '종 C', '종 D', '종 E', '종 F', '종 G', '종 H', '종 I', '종 J']
      // an additive tree: leaf-to-leaf distances = sum of branch lengths along the path
      const branch = [0.4, 0.5, 1.4, 0.8, 0.3, 0.9, 1.1, 0.5, 0.35, 2.0]
      const inner = [[0, 1, 0.6], [2, 3, 1.0], [4, 5, 0.7], [6, 7, 0.9], [8, 9, 0.5]]
      const pairOf = (i: number) => inner.findIndex((p) => p[0] === i || p[1] === i)
      const side = (g: number) => (g <= 1 ? 0 : 1)
      const d = (i: number, j: number) => {
        if (i === j) return 0
        const gi = pairOf(i), gj = pairOf(j)
        if (gi === gj) return branch[i] + branch[j]
        const gl = (g: number) => inner[g][2]
        const sameSide = side(gi) === side(gj)
        return branch[i] + branch[j] + gl(gi) + gl(gj) + (sameSide ? 0.5 : 2.2)
      }
      const cols: Column[] = [cat('종'), ...names.map(num)]
      return table(cols, names.map((nm, i) => [nm, ...names.map((_, j) => round(d(i, j), 3))]))
    },
  },
]
