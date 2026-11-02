import type { VizMeta } from './types'

/** v0.8 network techniques. */
export const catalogV8Net: VizMeta[] = [
  { id: 'nodetrix', name: '노드트릭스', nameEn: 'NodeTrix', category: 'network', sub: 'graph', alsoIn: ['relationship'], dataKinds: ['network'], keywords: ['노드링크 행렬 혼합', '공동체 행렬', '밀집 그룹 행렬', '접기 펼치기', '하이브리드 네트워크', 'nodetrix', 'hybrid node-link matrix', 'community matrix', 'collapse expand'], summary: '밀집한 공동체는 인접 행렬로, 공동체 사이의 연결은 노드-링크 선으로 그려, 큰 네트워크의 구조와 세부 연결을 한 화면에서 보여줍니다.', related: ['adjacency', 'network', 'biofabric', 'power-graph'] },
  { id: 'power-graph', name: '파워 그래프', nameEn: 'Power Graph', category: 'network', sub: 'graph', alsoIn: ['relationship'], dataKinds: ['network'], keywords: ['네트워크 압축', '이분 완전 연결', '모듈 압축', '간선 압축', '파워 노드', 'power graph', 'network compression', 'biclique', 'clique', 'power edge'], summary: '이웃을 공유하는 노드를 power 노드로 묶고 완전 이분·완전그래프 구조를 굵은 간선 하나로 대신해, 간선 수를 줄이면서 원본 연결을 되살릴 수 있게 합니다.', related: ['confluent-drawing', 'force-directed-edge-bundling', 'nodetrix', 'adjacency'] },
  { id: 'confluent-drawing', name: '합류 그래프 (Confluent Drawing)', nameEn: 'Confluent Drawing', category: 'network', sub: 'graph', alsoIn: ['relationship'], dataKinds: ['network'], keywords: ['합류 그림', '간선 합류', '공유 경로', '부드러운 트랙', '철도 트랙', 'confluent drawing', 'edge merging', 'tracks', 'path preserving'], summary: '같은 이웃을 공유하는 간선들을 하나의 공유 줄기로 합쳤다가 다시 갈라, 부드러운 곡선을 따라가면 실제 연결된 노드에 닿도록 하면서 선의 혼잡을 줄입니다.', related: ['power-graph', 'force-directed-edge-bundling', 'edge-bundling'] },
]
