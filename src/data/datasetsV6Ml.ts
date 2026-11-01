import { createRng, round } from '../lib/random'
import type { DatasetDef, DatasetSize } from './datasets'
import type { Cell, Column, DataTable } from './table'

const num = (name: string): Column => ({ name, type: 'number' })
const cat = (name: string): Column => ({ name, type: 'category' })
const table = (columns: Column[], rows: Cell[][]): DataTable => ({ columns, rows })
const sizes = (def: number, min: number, max: number, step: number, label: string): DatasetSize => ({ default: def, min, max, step, label })

/** Machine-learning example data. Everything is generated from a seed and is synthetic. */
export const datasetsV6Ml: DatasetDef[] = [
  {
    id: 'ml-clusters', name: '겹치는 세 군집 (합성)', description: '2차원 평면에 정규분포로 만든 세 개의 군집(A·B·C)입니다. 군집 중심이 가까워 경계 부근에서 서로 겹칩니다. 분류 모델이 실수하는 영역을 보기 위한 합성 데이터이며 시드로 다시 만들 수 있습니다.',
    size: sizes(150, 30, 600, 15, '전체 점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const centers = [[0, 0], [2.6, 0.4], [1.3, 2.6]]
      return table([num('특징 1'), num('특징 2'), cat('클래스')], Array.from({ length: n }, (_, i) => { const c = i % 3; return [round(centers[c][0] + r.normal(0, 0.85), 3), round(centers[c][1] + r.normal(0, 0.85), 3), 'ABC'[c]] }))
    },
  },
  {
    id: 'ml-moons', name: '두 개의 초승달 (합성)', description: '서로 맞물린 두 초승달 모양의 점 구름에 잡음을 더한 이진 분류 데이터입니다. 직선으로는 나눌 수 없어 모델의 유연성을 비교하기 좋은 합성 데이터입니다.',
    size: sizes(200, 40, 600, 20, '전체 점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('특징 1'), num('특징 2'), cat('클래스')], Array.from({ length: n }, (_, i) => {
        const c = i % 2, t = r() * Math.PI
        const x = c === 0 ? Math.cos(t) : 1 - Math.cos(t), y = c === 0 ? Math.sin(t) : 0.5 - Math.sin(t)
        return [round(x + r.normal(0, 0.18), 3), round(y + r.normal(0, 0.18), 3), c === 0 ? '양성' : '음성']
      }))
    },
  },
  {
    id: 'ml-spiral', name: '두 팔 나선 (합성)', description: '중심에서 바깥으로 감겨 나가는 두 팔 나선을 두 클래스로 만든 합성 데이터입니다. 단순한 모델은 거의 맞히지 못하고, 충분히 유연한 모델만 경계를 따라갈 수 있습니다.',
    size: sizes(240, 60, 600, 20, '전체 점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('특징 1'), num('특징 2'), cat('클래스')], Array.from({ length: n }, (_, i) => {
        const c = i % 2, t = 0.25 + r() * 3.2, a = t * 2.1 + c * Math.PI
        return [round(t * Math.cos(a) * 0.55 + r.normal(0, 0.12), 3), round(t * Math.sin(a) * 0.55 + r.normal(0, 0.12), 3), c === 0 ? '팔 1' : '팔 2']
      }))
    },
  },
  {
    id: 'ml-highdim', name: '고차원 군집 (합성)', description: '10차원 공간에 네 개의 군집을 만든 합성 데이터입니다. 군집마다 평균이 높은 축이 다르고 나머지 축은 잡음이어서, 2차원 투영으로 군집 구조가 얼마나 보존되는지 살필 수 있습니다.',
    size: sizes(160, 40, 400, 20, '전체 점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      const cols = Array.from({ length: 10 }, (_, j) => num(`축 ${j + 1}`))
      return table([...cols, cat('군집')], Array.from({ length: n }, (_, i) => {
        const c = i % 4
        return [...Array.from({ length: 10 }, (_, j) => round((j % 4 === c ? 4 : 0) + (j === 9 ? c * 1.5 : 0) + r.normal(0, 1.1), 3)), `군집 ${c + 1}`]
      }))
    },
  },
  {
    id: 'ml-swissroll', name: '스위스롤 (합성)', description: '3차원에서 두루마리처럼 말린 얇은 면 위의 점입니다. 색(구간)은 두루마리를 따라 펼친 위치를 뜻합니다. 가까운 점끼리의 관계(이웃 구조)를 지키는 차원 축소가 면을 펼 수 있는지 확인하는 고전적인 합성 데이터입니다.',
    size: sizes(220, 60, 400, 20, '전체 점 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('x'), num('y'), num('z'), cat('위치 구간')], Array.from({ length: n }, () => {
        const t = 1.5 * Math.PI * (1 + 2 * r()), h = r() * 10
        return [round(t * Math.cos(t), 3), round(h, 3), round(t * Math.sin(t), 3), `구간 ${Math.min(3, Math.floor(((t - 1.5 * Math.PI) / (3 * Math.PI)) * 4)) + 1}`]
      }))
    },
  },
  {
    id: 'ml-tabular', name: '가상 주택 가격 (합성)', description: '면적·건축 연수·역과의 거리·층수·방 수로 가격(만 원)을 만든 합성 표 데이터입니다. 가격은 면적에 대해 거의 선형으로 오르고, 건축 연수에는 내려가는 비선형 효과가, 역과의 거리에는 가까울수록 오르는 효과가 있으며 층수·방 수는 거의 영향이 없도록 설계했습니다. 실제 시장 자료가 아닙니다.',
    size: sizes(300, 80, 800, 20, '전체 행 수'),
    generate: (seed, n) => {
      const r = createRng(seed)
      return table([num('가격'), num('면적'), num('건축 연수'), num('역과의 거리'), num('층수'), num('방 수')], Array.from({ length: n }, () => {
        const area = 30 + r() * 90, age = r() * 40, dist = 0.1 + r() * 3.9, floor = 1 + Math.floor(r() * 20), rooms = Math.max(1, Math.min(6, Math.round(area / 28 + r.normal(0, 0.6))))
        const price = 1500 + 520 * area ** 0.95 / 10 * 1.0 - 90 * Math.sqrt(age) * 5 * (age > 25 ? 1.3 : 1) + 2600 / (0.6 + dist) + 3 * floor + r.normal(0, 700)
        return [round(price, 0), round(area, 1), round(age, 1), round(dist, 2), floor, rooms]
      }))
    },
  },
  {
    id: 'ml-tokens', name: '짧은 문장의 토큰 (직접 쓴 예문)', description: '어텐션 지도를 그리기 위한 짧은 문장의 토큰 목록입니다. 한 행이 토큰 하나이며 순서가 문장 속 위치입니다. ‘패딩’ 열이 1이면 채우기용 토큰으로, 어텐션의 대상에서 가려집니다.',
    generate: () => {
      const toks = ['고양이가', '소파 위에서', '잠을', '자고', '있다', '그리고', '강아지는', '정원에서', '공을', '쫓고', '있다', '[PAD]', '[PAD]']
      return table([cat('토큰'), num('패딩')], toks.map((t) => [t, t === '[PAD]' ? 1 : 0]))
    },
  },
]
