import type { VizMeta } from './types'

/** v0.9 visualization techniques. */
export const catalogV9: VizMeta[] = [
  { id: 'metrosets', name: '메트로셋', nameEn: 'MetroSets', category: 'network', sub: 'sets', alsoIn: ['relationship'], dataKinds: ['categorical'], keywords: ['지하철 노선도', '집합 노선', '환승역', '팔방위', '집합 도식', 'metrosets', 'metro map', 'set visualization', 'octilinear', 'support graph', 'transfer station'], summary: '집합을 지하철 노선, 원소를 역으로 그려 둘 이상의 집합에 속한 원소를 환승역으로 보여 주고, 노선은 같은 구간을 공유하며 수평·수직·45° 선으로 정리합니다.', related: ['linesets', 'mosaicsets', 'upset', 'kelp-diagram'] },
  { id: 'mosaicsets', name: '모자이크셋', nameEn: 'MosaicSets', category: 'network', sub: 'sets', alsoIn: ['relationship'], dataKinds: ['categorical'], keywords: ['격자 집합', '육각 격자', '오일러 도식', '연속 영역', '집합 격자 임베딩', 'mosaicsets', 'grid graph', 'hexagonal grid', 'euler diagram', 'set embedding', 'contiguous regions'], summary: '원소마다 사각 또는 육각 격자의 셀 하나를 배정하고 같은 집합의 셀이 하나의 연속 영역이 되도록 배치해, 겹치는 집합을 지도 같은 영역으로 보여 줍니다.', related: ['metrosets', 'rainbow-boxes', 'venn', 'tile-grid'] },
  { id: 'infocrystal', name: '인포크리스털', nameEn: 'InfoCrystal', category: 'network', sub: 'sets', alsoIn: ['text'], dataKinds: ['categorical'], keywords: ['불리언 질의', '검색어 조합', '결정체', '교집합 아이콘', '정보검색 질의 시각화', 'infocrystal', 'boolean query', 'visual query language', 'information retrieval', 'query combination'], summary: '검색 조건 여러 개의 모든 불리언 조합을 다각형 둘레에 아이콘으로 놓고, 조합마다 문서 수를 세며, 아이콘을 골라 합쳐 AND·OR 질의 결과를 즉시 확인합니다.', related: ['upset', 'venn', 'radial-sets', 'metrosets'] },
]
