import { createRng, round } from '../lib/random'
import type { DatasetDef } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })

/** v0.7 datasets for hierarchies, edge bundling and storylines. */
export const datasetsV7b: DatasetDef[] = [
  {
    id: 'org-tree', name: '조직 계층 (4단계, 약 120개 잎)', description: '가상 회사의 부문 › 팀 › 파트 › 담당 네 단계 조직과 인원입니다. 잎이 많아 쌍곡 트리처럼 초점+맥락 기법이 필요한 크기입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const divisions = ['연구', '제품', '영업', '운영']
      const teams = ['플랫폼', '데이터', '모바일', '보안', '인프라', '디자인', '기획', '품질']
      const parts = ['A', 'B', 'C', 'D']
      const rows: Cell[][] = []
      divisions.forEach((d, di) => {
        const nt = 3 + (di % 2)
        for (let t = 0; t < nt; t++) {
          const team = `${teams[(di * 2 + t) % teams.length]}${t > 3 ? t : ''}`
          const np = 2 + ((di + t) % 3)
          for (let p = 0; p < np; p++) {
            const nl = 2 + ((di + t + p) % 3)
            for (let l = 0; l < nl; l++) rows.push([d, team, `${parts[p]}파트`, `담당 ${l + 1}`, 2 + r.int(0, 9)])
          }
        }
      })
      return table([cat('부문'), cat('팀'), cat('파트'), cat('담당'), num('인원')], rows)
    },
  },
  {
    id: 'flow-edges', name: '연결선 좌표 (세 줄기 이동)', description: '평면 위 두 지역 군 사이를 오가는 이동 경로 약 90개입니다. 한 행이 간선 하나이며 출발·도착 좌표, 경로 묶음, 물량이 들어 있습니다. 같은 방향의 선들이 서로 가까이 있어 묶음 효과를 볼 수 있습니다.',
    size: { min: 20, max: 300, default: 90, step: 10, label: '간선 수' },
    generate: (seed, n) => {
      const r = createRng(seed)
      const corridors: { name: string; a: [number, number]; b: [number, number] }[] = [
        { name: '북부 축', a: [10, 14], b: [90, 20] }, { name: '남부 축', a: [12, 86], b: [88, 80] }, { name: '대각 축', a: [14, 50], b: [86, 52] },
      ]
      const rows: Cell[][] = []
      for (let i = 0; i < n; i++) {
        const c = corridors[i % corridors.length]
        const j = (v: number, s: number) => round(v + r.normal(0, s), 1)
        rows.push([j(c.a[0], 3), j(c.a[1], 5), j(c.b[0], 3), j(c.b[1], 5), c.name, round(1 + r() * 9, 1)])
      }
      return table([num('출발 x'), num('출발 y'), num('도착 x'), num('도착 y'), cat('경로'), num('물량')], rows)
    },
  },
  {
    id: 'story-scenes', name: '인물 장면 (스토리라인)', description: '아홉 인물이 열두 장면에서 어느 장소에 함께 있었는지 기록한 합성 이야기입니다. 같은 장소의 인물은 같은 모임입니다.',
    generate: (seed) => {
      const r = createRng(seed)
      const names = ['민아', '준호', '서연', '도현', '하은', '지후', '수빈', '태오', '예린']
      const places = ['성', '숲', '마을', '항구']
      const home = names.map((_, i) => i % places.length)
      const rows: Cell[][] = []
      for (let t = 1; t <= 12; t++) {
        names.forEach((nm, i) => {
          if (r() < 0.08) return
          // characters mostly stay near their home place; as the story advances they mix
          const drift = Math.min(0.75, t / 14)
          const p = r() < drift ? r.int(0, places.length - 1) : home[i]
          rows.push([nm, t, places[p]])
        })
      }
      return table([cat('인물'), num('장면'), cat('장소')], rows)
    },
  },
]
