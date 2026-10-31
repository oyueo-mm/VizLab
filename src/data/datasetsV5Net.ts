import { createRng } from '../lib/random'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

const CLUBS = ['음악', '운동', '독서', '코딩', '미술']

export const datasetsV5Net: DatasetDef[] = [
  {
    id: 'set-members', name: '동아리 가입 (집합 소속)', description: '가상 학생들이 다섯 동아리(음악·운동·독서·코딩·미술) 중 어디에 가입했는지를 1(가입)과 0(미가입) 열로 적은 합성 데이터입니다. 독서와 코딩, 음악과 미술에 함께 가입하는 경향을 넣었고 어디에도 가입하지 않은 학생도 있습니다. 실제 학생 자료가 아닙니다.',
    size: sizes(120, 20, 600, 10, '학생 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const rows: Cell[][] = Array.from({ length: n }, (_, i) => {
        const taste = [r(), r()] // two latent tastes: analytical (reading, coding) and expressive (music, art)
        const p = [0.12 + 0.5 * taste[1], 0.28 + 0.1 * r(), 0.1 + 0.5 * taste[0], 0.06 + 0.5 * taste[0] * taste[0], 0.05 + 0.45 * taste[1] * taste[1]]
        return [`학생 ${String(i + 1).padStart(3, '0')}`, ...p.map((q) => (r() < q ? 1 : 0))]
      })
      return table([cat('이름'), ...CLUBS.map(num)], rows)
    },
  },
]
