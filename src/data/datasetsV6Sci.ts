import { createRng, round } from '../lib/random'
import { fccLattice, ljMonteCarlo } from '../stats/physics'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

const ljCache = new Map<string, { pos: [number, number, number][]; box: number }>()

/** Physics, chemistry and mathematics example data. */
export const datasetsV6Sci: DatasetDef[] = [
  {
    id: 'mandelbrot-sites', name: '망델브로 집합의 알려진 지점', description: '망델브로 집합에서 잘 알려진 지점의 복소 좌표입니다(공개된 수학 자료). 배율은 그 지점을 볼 때 권장하는 확대 배율입니다. 행을 고치거나 추가해 자기만의 관심 지점을 표시할 수 있습니다.',
    generate: () => table([cat('이름'), num('실수부'), num('허수부'), num('배율')], [
      ['주 심장형', -0.5, 0, 1], ['원형 구근(주기 2)', -1, 0, 4], ['바다 해마 계곡', -0.75, 0.1, 30], ['코끼리 계곡', 0.275, 0, 40], ['삼중 나선', -0.088, 0.654, 60],
      ['첨점(0.25, 0)', 0.25, 0, 20], ['미니 망델브로', -1.7497, 0, 300], ['번개', -0.1011, 0.9563, 100], ['머리(주기 3)', -0.1226, 0.7449, 30],
    ]),
  },
  {
    id: 'julia-presets', name: '줄리아 집합의 대표 매개변수', description: '줄리아 집합 z → z² + c에서 모양이 뚜렷이 다른 대표적인 c 값입니다(공개된 수학 자료). c가 망델브로 집합 안에 있으면 연결된 집합, 밖에 있으면 먼지처럼 흩어진 칸토어 집합이 됩니다.',
    generate: () => table([cat('이름'), num('c 실수부'), num('c 허수부')], [
      ['Douady 토끼', -0.123, 0.745], ['덴드라이트', 0, 1], ['Siegel 원판', -0.391, -0.587], ['산 마르코', -0.75, 0], ['컬리플라워', 0.25, 0], ['나선 은하', -0.8, 0.156], ['번개', -0.4, 0.6], ['먼지(칸토어)', 0.3, 0.55],
    ]),
  },
  {
    id: 'newton-z3', name: '다항식 z³ − 1', description: '뉴턴 프랙탈의 다항식입니다. 한 행이 항 하나(계수 × z^지수)이며 z³ − 1에는 세 개의 단위근이 있습니다. 행을 고치거나 항을 추가해 다른 다항식으로 바꿀 수 있습니다.',
    generate: () => table([num('지수'), num('계수 실수부'), num('계수 허수부')], [[3, 1, 0], [0, -1, 0]]),
  },
  {
    id: 'newton-z5', name: '다항식 z⁵ − 1', description: '다섯 개의 5차 단위근을 가진 다항식 z⁵ − 1입니다. 근이 많아질수록 흡인 영역의 경계가 더 복잡해집니다.',
    generate: () => table([num('지수'), num('계수 실수부'), num('계수 허수부')], [[5, 1, 0], [0, -1, 0]]),
  },
  {
    id: 'newton-nova', name: '다항식 z³ − 2z + 2', description: '뉴턴법이 근으로 수렴하지 않고 주기 2 순환에 갇히는 시작점이 있는 고전적 예(z³ − 2z + 2)입니다. 근에 수렴하지 못하는 영역은 검은색으로 표시됩니다.',
    generate: () => table([num('지수'), num('계수 실수부'), num('계수 허수부')], [[3, 1, 0], [1, -2, 0], [0, 2, 0]]),
  },
  {
    id: 'zeros-poles-a', name: '영점 ±1, 극점 ±i (복소 함수)', description: '유리함수 f(z) = (z − 1)(z + 1) / ((z − i)(z + i))의 영점과 극점입니다. 한 행이 영점 또는 극점 하나이며, 행을 고치거나 추가하면 함수가 바뀝니다.',
    generate: () => table([cat('종류'), num('실수부'), num('허수부')], [['영점', 1, 0], ['영점', -1, 0], ['극점', 0, 1], ['극점', 0, -1]]),
  },
  {
    id: 'zeros-poles-b', name: '단위근 영점과 이중 극점 (복소 함수)', description: '세 개의 3차 단위근을 영점으로, 원점과 2를 극점으로 둔 유리함수입니다. 영점 주위의 색은 시계 방향의 한 바퀴, 극점 주위는 반대 방향으로 한 바퀴 돕니다.',
    generate: () => table([cat('종류'), num('실수부'), num('허수부')], [['영점', 1, 0], ['영점', -0.5, 0.866], ['영점', -0.5, -0.866], ['극점', 0, 0], ['극점', 2, 0], ['극점', 2, 0]]),
  },
  {
    id: 'attractor-params', name: '혼돈 계의 모수', description: '혼돈 미분방정식의 모수입니다. 한 행이 모수 하나(이름, 값)이며 로렌츠(σ, ρ, β), 뢰슬러(a, b, c), 토마스(b), 아이자와(a~f)의 기본값(공개된 표준 값)이 들어 있습니다. 값을 바꾸면 궤적이 다시 계산됩니다. 예: 로렌츠 ρ를 20으로 낮추면 혼돈 대신 고정점으로 수렴합니다.',
    generate: () => table([cat('모수'), num('값')], [
      ['Lorenz σ', 10], ['Lorenz ρ', 28], ['Lorenz β', 2.6667], ['Rössler a', 0.2], ['Rössler b', 0.2], ['Rössler c', 5.7], ['Thomas b', 0.208],
      ['Aizawa a', 0.95], ['Aizawa b', 0.7], ['Aizawa c', 0.6], ['Aizawa d', 3.5], ['Aizawa e', 0.25], ['Aizawa f', 0.1],
    ]),
  },
  {
    id: 'particles-liquid', name: '레나드–존스 액체의 입자 좌표 (시뮬레이션)', description: '레나드–존스 유체(입자 지름 σ = 1, 온도 1.2, 수 밀도 0.8)를 주기 경계의 상자에서 몬테카를로로 평형화한 입자 좌표입니다. 한 행이 입자 하나이며 ‘상자’는 정육면체 한 변의 길이입니다. 컴퓨터에서 직접 계산한 시뮬레이션 데이터이며 실제 측정이 아닙니다.',
    size: sizes(64, 32, 108, 4, '입자 수'),
    generate: (seed, n) => {
      const key = `${seed}|${n}`
      let r = ljCache.get(key)
      if (!r) { r = ljMonteCarlo(n, 0.8, 1.2, 40, seed); ljCache.set(key, r) }
      return table([num('x'), num('y'), num('z'), num('상자')], r.pos.map((p) => [round(p[0], 4), round(p[1], 4), round(p[2], 4), round(r!.box, 4)]))
    },
  },
  {
    id: 'particles-fcc', name: '면심입방 결정의 입자 좌표 (열 진동 포함)', description: '3×3×3 단위포의 면심입방(fcc) 격자 위치에 무작위 열 진동을 더한 입자 좌표입니다. 진동이 작을수록 방사 분포 함수의 봉우리가 날카롭습니다. 합성 데이터입니다.',
    size: sizes(6, 0, 20, 1, '열 진동 크기 (격자 상수의 %)'),
    generate: (seed, n) => {
      const r = createRng(seed), a = 1.6
      const { pos, box } = fccLattice(3, a)
      return table([num('x'), num('y'), num('z'), num('상자')], pos.map((p) => [round(p[0] + r.normal(0, (n / 100) * a), 4), round(p[1] + r.normal(0, (n / 100) * a), 4), round(p[2] + r.normal(0, (n / 100) * a), 4), round(box, 4)]))
    },
  },
  {
    id: 'particles-gas', name: '이상 기체의 입자 좌표 (무작위)', description: '정육면체 상자 안에 균일하게 무작위로 놓은 입자입니다. 입자 사이에 상관이 없으므로 방사 분포 함수가 모든 거리에서 1에 가깝습니다. 합성 데이터입니다.',
    size: sizes(400, 100, 1200, 100, '입자 수'),
    generate: (seed, n) => { const r = createRng(seed), L = 10; return table([num('x'), num('y'), num('z'), num('상자')], Array.from({ length: n }, () => [round(r() * L, 4), round(r() * L, 4), round(r() * L, 4), L])) },
  },
  {
    id: 'tb-params', name: '강한 결합 모형의 호핑 모수 (eV)', description: '강한 결합(tight-binding) 모형의 모수입니다. ε은 원자 준위, t₁은 최근접 호핑, t₂는 이원자 사슬의 두 번째 호핑, Δ는 두 부격자의 에너지 차의 절반입니다. 단위는 eV이며 교육용 값(실제 물질의 측정값이 아님)입니다.',
    generate: () => table([cat('모수'), num('값')], [['ε', 0], ['t1', 1], ['t2', 0.6], ['Δ', 0]]),
  },
  {
    id: 'tb-params-gapped', name: '갭이 열린 호핑 모수 (eV, Δ = 0.5)', description: '부격자의 에너지 차 Δ = 0.5 eV를 준 모수입니다. 그래핀의 디랙점에 갭이 열리는(질량이 생기는) 효과와 이원자 사슬의 갭 확대를 보여 줍니다. 교육용 값입니다.',
    generate: () => table([cat('모수'), num('값')], [['ε', 0], ['t1', 1], ['t2', 0.6], ['Δ', 0.5]]),
  },
  {
    id: 'phase-bi-cd', name: '비스무트–카드뮴 (녹는점·융해열)', description: '두 성분의 녹는점(K)과 융해열(kJ/mol)의 근삿값입니다(Bi 544.5 K, 11.1 kJ/mol · Cd 594.2 K, 6.19 kJ/mol; 일반적인 화학 편람 값). 이상용액 공정 모형으로 계산한 공정점이 실제 Bi–Cd의 공정(약 413 K)과 잘 맞는 예입니다.',
    generate: () => table([cat('성분'), num('녹는점 (K)'), num('융해열 (kJ/mol)')], [['Bi', 544.5, 11.1], ['Cd', 594.2, 6.19]]),
  },
  {
    id: 'phase-sn-pb', name: '주석–납 (녹는점·융해열)', description: '주석(Sn 505.1 K, 7.03 kJ/mol)과 납(Pb 600.6 K, 4.77 kJ/mol)의 근삿값입니다. 실제 Sn–Pb 합금은 고용체가 생겨 공정이 456 K, Sn 62%이지만 이 이상용액·순수 고체 모형은 더 낮은 공정 온도를 줍니다. 모형의 한계를 확인하는 예입니다.',
    generate: () => table([cat('성분'), num('녹는점 (K)'), num('융해열 (kJ/mol)')], [['Sn', 505.1, 7.03], ['Pb', 600.6, 4.77]]),
  },
]
