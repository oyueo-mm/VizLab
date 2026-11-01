import { createRng, round } from '../lib/random'
import { MOLECULES, type CrystalAtom, type Cell } from '../stats/chem'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell as TCell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: TCell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

const scalar = (n: number, lo: number, hi: number, f: (x: number, y: number, z: number) => number): DataTable => {
  const rows: TCell[][] = []
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = lo + ((hi - lo) * i) / (n - 1), y = lo + ((hi - lo) * j) / (n - 1), z = lo + ((hi - lo) * k) / (n - 1)
    rows.push([round(x, 4), round(y, 4), round(z, 4), round(f(x, y, z), 5)])
  }
  return table([num('x'), num('y'), num('z'), num('값')], rows)
}

const crystalTable = (basis: CrystalAtom[], c: Cell): DataTable => table(
  [cat('원소'), num('분율 u'), num('분율 v'), num('분율 w'), num('a (Å)'), num('b (Å)'), num('c (Å)'), num('α (°)'), num('β (°)'), num('γ (°)')],
  basis.map((a) => [a.el, a.frac[0], a.frac[1], a.frac[2], c.a, c.b, c.c, c.alpha, c.beta, c.gamma]),
)
const cubic = (a: number): Cell => ({ a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 })
const fcc = (el: string, off: [number, number, number] = [0, 0, 0]): CrystalAtom[] => ([[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]] as [number, number, number][]).map((f) => ({ el, frac: [f[0] + off[0], f[1] + off[1], f[2] + off[2]] }))

const molecule = (id: keyof typeof MOLECULES, desc: string): DatasetDef => ({
  id: `mol-${id}` as DatasetDef['id'], name: `${MOLECULES[id].name} (분자 구조)`, description: `${desc} 표준 결합 길이와 결합각으로 구성한 근사 좌표(Å)입니다. 한 행이 원자 하나이며 좌표를 고치면 결합 길이와 각도가 다시 계산됩니다. 실험 구조 데이터베이스의 값이 아닙니다.`,
  generate: () => table([cat('원소'), num('x (Å)'), num('y (Å)'), num('z (Å)')], MOLECULES[id].atoms.map((a) => [a.el, round(a.pos[0], 4), round(a.pos[1], 4), round(a.pos[2], 4)])),
})

/** 3-D scalar, vector, tensor, molecular and crystal example data. */
export const datasetsV6Field: DatasetDef[] = [
  {
    id: 'scalar-metaballs', name: '메타볼 스칼라장 (합성)', description: '세 개의 가우시안 덩어리를 더해 만든 3차원 스칼라장입니다. 한 행이 격자점 하나(x, y, z, 값)이며 값이 클수록 덩어리 중심에 가깝습니다. 등치면 값에 따라 덩어리가 합쳐지거나 갈라집니다. 합성 데이터입니다.',
    size: sizes(18, 10, 26, 2, '축당 격자점 수'),
    generate: (_seed, n) => scalar(n, -2, 2, (x, y, z) => Math.exp(-((x - 0.7) ** 2 + (y - 0.3) ** 2 + z ** 2) / 0.6) + Math.exp(-((x + 0.8) ** 2 + (y + 0.4) ** 2 + (z - 0.3) ** 2) / 0.5) + 0.8 * Math.exp(-((x) ** 2 + (y - 1.1) ** 2 + (z + 0.8) ** 2) / 0.35)),
  },
  {
    id: 'scalar-orbital', name: '3d_z² 오비탈 확률밀도 (계산)', description: '수소 꼴 3d_z² 오비탈의 확률밀도 |ψ|² ∝ (3z² − r²)² e^(−2r/3)를 격자에서 계산한 값입니다(보어 반지름 단위, 규격화하지 않음). 위아래 두 덩어리와 허리의 고리가 보이는 대표적인 오비탈 모양입니다.',
    size: sizes(22, 12, 28, 2, '축당 격자점 수'),
    generate: (_seed, n) => scalar(n, -9, 9, (x, y, z) => { const r2 = x * x + y * y + z * z; return ((3 * z * z - r2) ** 2 * Math.exp(-2 * Math.sqrt(r2) / 3)) / 800 }),
  },
  {
    id: 'scalar-gyroid', name: '자이로이드 스칼라장 (수식)', description: '삼중 주기 극소곡면인 자이로이드의 근사식 sin x cos y + sin y cos z + sin z cos x를 한 주기 [0, 2π]³에서 계산한 값입니다. 값 0의 등치면이 자이로이드 곡면이며 다른 값은 이를 부풀리거나 줄인 곡면입니다.',
    size: sizes(24, 12, 28, 2, '축당 격자점 수'),
    generate: (_seed, n) => scalar(n, 0, 2 * Math.PI, (x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x)),
  },
  {
    id: 'vector-abc', name: 'ABC 흐름 (3차원 벡터장, 수식)', description: '(A sin z + C cos y, B sin x + A cos z, C sin y + B cos x), A = 1, B = 0.7, C = 0.43인 ABC 흐름의 벡터입니다. 발산이 0이고 회전이 자기 자신과 같은(Beltrami) 흐름으로 유선이 복잡하게 감깁니다. 한 행이 격자점의 벡터 하나입니다.',
    size: sizes(7, 5, 10, 1, '축당 격자점 수'),
    generate: (_seed, n) => {
      const rows: TCell[][] = []
      for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = (2 * Math.PI * i) / (n - 1), y = (2 * Math.PI * j) / (n - 1), z = (2 * Math.PI * k) / (n - 1)
        rows.push([round(x, 4), round(y, 4), round(z, 4), round(Math.sin(z) + 0.43 * Math.cos(y), 5), round(0.7 * Math.sin(x) + Math.cos(z), 5), round(0.43 * Math.sin(y) + 0.7 * Math.cos(x), 5)])
      }
      return table([num('x'), num('y'), num('z'), num('u'), num('v'), num('w')], rows)
    },
  },
  {
    id: 'vector-dipole', name: '자기 쌍극자 장 (3차원 벡터장, 수식)', description: '원점의 자기 쌍극자 m = (0, 0, 1)이 만드는 장 B = (3(m·r̂)r̂ − m)/r³의 격자 표본입니다(원점 근처는 반지름 0.4로 잘라 특이점을 피했습니다). 장선이 위쪽 극에서 나와 아래로 돌아 들어오는 모양입니다.',
    size: sizes(7, 5, 10, 1, '축당 격자점 수'),
    generate: (_seed, n) => {
      const rows: TCell[][] = []
      for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -2 + (4 * i) / (n - 1), y = -2 + (4 * j) / (n - 1), z = -2 + (4 * k) / (n - 1)
        const r = Math.max(0.4, Math.hypot(x, y, z)), s = r / Math.max(1e-9, Math.hypot(x, y, z)) || 1
        const [px, py, pz] = Math.hypot(x, y, z) < 0.4 ? [x * s, y * s, z * s] : [x, y, z]
        const dot = pz / r
        rows.push([round(x, 4), round(y, 4), round(z, 4), round((3 * dot * (px / r)) / r ** 3, 5), round((3 * dot * (py / r)) / r ** 3, 5), round((3 * dot * (pz / r) - 1) / r ** 3, 5)])
      }
      return table([num('x'), num('y'), num('z'), num('u'), num('v'), num('w')], rows)
    },
  },
  {
    id: 'tensor-dti', name: '교차하는 섬유의 확산 텐서 (합성)', description: '확산 텐서 영상(DTI)을 흉내 낸 합성 텐서장입니다. 왼쪽은 x 방향, 오른쪽은 y 방향 섬유 다발이고 가운데는 두 다발이 교차해 이방성이 낮은 평면형이며, 위쪽 가장자리는 등방성(물) 영역입니다. 한 행이 위치 하나의 대칭 텐서(Dxx, Dyy, Dzz, Dxy, Dxz, Dyz)입니다. 실제 뇌 영상이 아닙니다.',
    size: sizes(8, 0, 40, 4, '잡음 크기 (%)'),
    generate: (seed, noise) => {
      const r = createRng(seed), rows: TCell[][] = []
      for (const z of [-1, 0, 1]) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
        const x = -2.5 + i, y = -2.5 + j
        let D: number[]
        if (y > 1.8) D = [1, 1, 1, 0, 0, 0]
        else {
          const w = x < -0.6 ? 1 : x > 0.6 ? 0 : 0.5
          const par = 1.7, perp = 0.3
          // blend of a fibre along x (weight w) and a fibre along y (weight 1 − w); the third axis is always perpendicular to both
          D = [par * w + perp * (1 - w), perp * w + par * (1 - w), perp, 0, 0, 0]
        }
        const e = (v: number) => v + r.normal(0, (noise / 100) * 0.4)
        rows.push([x, y, z, round(e(D[0]), 4), round(e(D[1]), 4), round(e(D[2]), 4), round(D[3] + r.normal(0, (noise / 100) * 0.2), 4), round(D[4] + r.normal(0, (noise / 100) * 0.1), 4), round(D[5] + r.normal(0, (noise / 100) * 0.1), 4)])
      }
      return table([num('x'), num('y'), num('z'), num('Dxx'), num('Dyy'), num('Dzz'), num('Dxy'), num('Dxz'), num('Dyz')], rows)
    },
  },
  molecule('water', '물 분자입니다.'),
  molecule('ammonia', '삼각뿔 모양의 암모니아입니다.'),
  molecule('methane', '정사면체 모양의 메테인입니다.'),
  molecule('ethene', '평면 구조의 에텐(에틸렌)입니다.'),
  molecule('benzene', '평면 육각 고리의 벤젠입니다.'),
  molecule('ethane', '두 메틸기가 엇갈린 에테인입니다.'),
  molecule('co2', '직선형 이산화탄소입니다.'),
  { id: 'crystal-nacl', name: '염화나트륨(암염) 결정 구조', description: '암염 구조의 단위포입니다(격자 상수 5.640 Å). 나트륨과 염소가 면심입방 격자 두 개를 서로 반만큼 어긋나게 겹친 구조이며 각 이온은 반대 이온 6개에 둘러싸입니다. 한 행이 단위포 안의 원자(분율 좌표)입니다.', generate: () => crystalTable([...fcc('Na'), ...fcc('Cl', [0.5, 0, 0])], cubic(5.64)) },
  { id: 'crystal-cu', name: '구리(면심입방) 결정 구조', description: '면심입방(fcc) 단위포입니다(격자 상수 3.615 Å, 원자 4개). 가장 조밀하게 쌓은 구조의 하나로 각 원자의 이웃은 12개입니다.', generate: () => crystalTable(fcc('Cu'), cubic(3.615)) },
  { id: 'crystal-fe', name: '철(체심입방) 결정 구조', description: '체심입방(bcc) 단위포입니다(격자 상수 2.866 Å, 원자 2개). 각 원자의 가장 가까운 이웃은 8개입니다.', generate: () => crystalTable([{ el: 'Fe', frac: [0, 0, 0] }, { el: 'Fe', frac: [0.5, 0.5, 0.5] }], cubic(2.866)) },
  { id: 'crystal-diamond', name: '다이아몬드 결정 구조 (탄소)', description: '다이아몬드 입방 구조의 단위포입니다(격자 상수 3.567 Å, 원자 8개). 각 탄소는 4개의 이웃과 정사면체로 결합합니다.', generate: () => crystalTable([...fcc('C'), ...fcc('C', [0.25, 0.25, 0.25])], cubic(3.567)) },
  { id: 'crystal-cscl', name: '염화세슘 결정 구조', description: '염화세슘 구조의 단위포입니다(격자 상수 4.123 Å). 단순 입방 격자 두 개를 체심 위치로 어긋나게 겹쳐 각 이온이 반대 이온 8개에 둘러싸입니다.', generate: () => crystalTable([{ el: 'Cs', frac: [0, 0, 0] }, { el: 'Cl', frac: [0.5, 0.5, 0.5] }], cubic(4.123)) },
  { id: 'crystal-mg', name: '마그네슘(육방조밀) 결정 구조', description: '육방조밀(hcp) 구조의 단위포입니다(a = 3.209 Å, c = 5.211 Å, γ = 120°, 원자 2개). 비직교 격자라 단위포가 평행육면체로 그려집니다.', generate: () => crystalTable([{ el: 'Mg', frac: [1 / 3, 2 / 3, 0.25] }, { el: 'Mg', frac: [2 / 3, 1 / 3, 0.75] }], { a: 3.209, b: 3.209, c: 5.211, alpha: 90, beta: 90, gamma: 120 }) },
]
