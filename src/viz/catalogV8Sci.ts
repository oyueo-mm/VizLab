import type { VizMeta } from './types'

/** v0.8 three-dimensional and scientific visualization techniques. */
export const catalogV8Sci: VizMeta[] = [
  { id: 'cone-tree', name: '콘 트리', nameEn: 'Cone Tree', category: 'hierarchy', alsoIn: ['network'], dataKinds: ['hierarchical'], keywords: ['3차원 트리', '원뿔 트리', '원뿔형 계층', '3D 계층', '회전 트리', 'cone tree', '3d tree', 'hierarchy in 3d', 'cam tree'], summary: '계층 구조를 3차원 공간의 원뿔로 배치해, 각 노드의 자식이 한 층 아래 원 위에 놓이게 하고 노드를 누르면 원뿔이 회전해 그 경로가 앞으로 오게 합니다.', related: ['hyperbolic-tree', 'radial-tree', 'sunburst'] },
  { id: 'stream-surface', name: '스트림 서피스', nameEn: 'Stream Surface', category: 'science', alsoIn: ['geo'], dataKinds: ['numeric'], keywords: ['유선 곡면', '흐름 곡면', '3차원 유동장', '시작선', '유동 곡면', 'stream surface', 'integral surface', 'flow surface', 'seed curve', '3d vector field'], summary: '3차원 벡터장의 시작선에서 출발한 여러 유선을 이웃끼리 이어 연속적인 흐름 곡면을 만들어, 흐름이 접히고 퍼지는 모양을 보여줍니다.', related: ['streamtube', 'vector-field-3d', 'streamline', 'line-integral-convolution'] },
  { id: 'streamtube', name: '스트림튜브', nameEn: 'Streamtube', category: 'science', alsoIn: ['geo'], dataKinds: ['numeric'], keywords: ['유선 튜브', '흐름 튜브', '튜브 유선', '속도별 반지름', '유량 보존', 'streamtube', 'stream tube', 'flow tube', 'tube radius', 'flux conservation'], summary: '3차원 유동장의 유선 둘레에 비틀리지 않는 원형 단면을 이어 튜브로 그리고, 반지름과 색에 속도·유량 보존 규칙을 담아 흐름의 세기를 읽게 합니다.', related: ['stream-surface', 'vector-field-3d', 'streamline'] },
]
