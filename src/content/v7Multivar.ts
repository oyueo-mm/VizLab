import type { VizContent } from './types'

/** Explanations of the v0.7 multivariate and high-dimensional techniques. */
export const contentV7Multivar: Record<string, VizContent> = {
  radviz: {
    definition: 'RadViz(Radial Visualization)는 d개 변수를 원 둘레의 앵커에 하나씩 놓고, 각 관측값을 ‘정규화한 변수값을 당기는 힘으로 가진 스프링들이 평형을 이루는 위치’에 찍는 기법입니다. 앵커 쪽 변수가 큰 관측값은 그 앵커 가까이에, 모든 변수가 비슷한 관측값은 원의 중심 부근에 놓입니다.',
    encoding: ['위치: 앵커들의 가중 평균(변수값이 가중치)', '앵커 위치: 변수의 정체성(드래그로 재배치)', '색: 그룹(품종 등)', '원 중심에서의 거리: 변수 값이 한 변수에 얼마나 쏠렸는가'],
    suitable: ['변수 3~12개의 수치형 다변량 데이터에서 그룹이 어떤 변수로 갈리는지 탐색할 때', '범주별 변수 프로파일을 한 장에 비교할 때', '변수 순서·배치에 따라 군집이 드러나는지 시험할 때'],
    howItWorks: ['각 변수를 0~1로 정규화합니다(최소–최대 또는 z 점수를 0~1로 눌러 담음).', '변수 j의 앵커를 단위원 위 각도 θⱼ에 둡니다.', '관측값 위치는 Σ xⱼ·(cos θⱼ, sin θⱼ) / Σ xⱼ 입니다.', '앵커를 끌어 각도를 바꾸면 모든 점이 즉시 다시 계산됩니다.'],
    math: [
      { tex: '\\mathbf{p}_i=\\frac{\\sum_{j=1}^{d} x_{ij}\\,\\mathbf{a}_j}{\\sum_{j=1}^{d} x_{ij}},\\qquad \\mathbf{a}_j=(\\cos\\theta_j,\\sin\\theta_j)', caption: '관측값 i의 위치는 정규화 변수값 x를 가중치로 한 앵커 a의 가중 평균' },
    ],
    pros: ['변수의 의미가 앵커라는 눈에 보이는 위치로 남습니다.', '앵커를 직접 움직여 탐색할 수 있습니다.', '그룹 구조가 있으면 앵커 쪽으로 분리되어 읽기 쉽습니다.'],
    cons: ['비선형 사상이라 서로 다른 고차원 점이 같은 위치에 겹칠 수 있습니다(변수값의 합이 같고 비율이 같은 점).', '변수 순서와 배치에 결과가 크게 좌우됩니다.', '변수가 많으면 중심부가 뭉칩니다.'],
    cautions: ['정규화 방법에 따라 그림이 달라집니다. 단위가 다른 변수는 반드시 정규화합니다.', '점 사이 거리를 원자료 거리로 해석하지 마세요.', '한 번의 배치로 군집이 안 보여도 군집이 없다는 뜻은 아닙니다.'],
    differs: ['PCA·t-SNE·UMAP은 데이터에서 최적화한 새 좌표축을 만들지만 RadViz는 원래 변수가 그대로 앵커로 남고, 점의 위치는 닫힌 식(가중 평균)으로 정해집니다.', 'Star Coordinates는 값에 비례한 벡터의 합(선형)이고 RadViz는 합으로 나눈 가중 평균(비선형)이라 모든 점이 원 안에 들어옵니다.', '평행좌표는 변수를 평행한 축에 두고 관측값을 선으로 잇지만 RadViz는 관측값을 점 하나로 요약합니다.'],
    references: ['Hoffman, Grinstein & Pinkney (1999), Dimensional anchors: a graphic primitive for multidimensional multivariate information visualizations', 'Ankerst et al. (1996), Similarity clustering of dimensions for an enhanced visualization of multidimensional data'],
  },
  'star-coordinates': {
    definition: 'Star Coordinates는 변수마다 2차원 평면의 축 벡터를 하나씩 두고, 관측값의 각 변수값만큼 그 벡터를 늘려 모두 더한 지점을 관측값의 위치로 삼는 선형 투영입니다. 축의 방향과 길이를 사용자가 직접 바꿔 가며 군집이 가장 잘 드러나는 투영을 찾는 것이 핵심입니다.',
    encoding: ['위치: 변수별 축 벡터와 값의 곱의 합', '축 벡터의 방향·길이: 그 변수가 위치에 미치는 영향', '색: 그룹'],
    suitable: ['어떤 변수 조합이 그룹을 가르는지 직접 만져 보며 탐색할 때', '변수 가중치를 조절하며 투영을 설계할 때', '고차원 선형 투영 개념을 설명할 때'],
    howItWorks: ['각 변수를 0~1로 정규화하고 중심(0.5)을 기준으로 합니다.', '변수 j의 축 벡터 vⱼ를 기본값으로 원 둘레에 균등하게 둡니다.', '관측값 위치 = Σ (xⱼ−0.5)·wⱼ·vⱼ 를 고정 배율로 단위원에 맞춥니다.', '축 끝의 점을 끌어 vⱼ를 바꾸면 모든 점이 다시 계산됩니다.'],
    math: [
      { tex: '\\mathbf{p}_i=\\frac{1}{B}\\sum_{j=1}^{d} w_j\\,(x_{ij}-\\tfrac12)\\,\\mathbf{v}_j,\\qquad B=\\sum_j \\tfrac{w_j}{2}\\lVert\\mathbf{v}_j\\rVert', caption: 'B는 어느 관측값도 단위원을 넘지 않게 하는 고정 배율' },
    ],
    pros: ['선형 투영이라 축을 바꿨을 때 점의 움직임을 예측할 수 있습니다.', '변수별 영향이 축 길이로 그대로 드러납니다.', '직접 조작으로 탐색 가설을 빠르게 시험합니다.'],
    cons: ['축이 많으면 서로 상쇄되어 중심에 몰립니다.', '좋은 투영을 찾는 일은 수동이라 탐색자의 인내가 필요합니다.', '서로 다른 고차원 점이 같은 위치에 투영될 수 있습니다.'],
    cautions: ['축 길이를 키우는 것은 그 변수를 확대해 보는 것이므로 과장된 인상을 줄 수 있습니다.', '배율이 고정이라 점 거리는 같은 그림 안에서만 비교하세요.', '정규화 방법을 바꾸면 그림이 달라집니다.'],
    differs: ['RadViz는 합으로 나누는 비선형 사상이고 Star Coordinates는 선형 합입니다. 그래서 RadViz 점은 원 안에 갇히지만 Star Coordinates는 축 길이에 비례해 멀리 갑니다.', 'PCA 바이플롯은 데이터에서 계산한 직교 축이고 Star Coordinates의 축은 사용자가 정합니다.', 'Grand Tour는 투영을 자동으로 연속 변화시키고 Star Coordinates는 사용자가 한 축씩 조작합니다.'],
    references: ['Kandogan (2001), Visualizing multi-dimensional clusters, trends, and outliers using star coordinates, KDD'],
  },
  'grand-tour': {
    definition: '그랜드 투어(Grand Tour)는 d차원 데이터를 2차원 평면으로 정사영하되, 투영 평면을 시간에 따라 연속적으로 바꿔 모든 방향에서 본 모습을 차례로 보여주는 애니메이션입니다. 한 장의 투영에서 겹쳐 보이던 군집이 어떤 순간에는 갈라져 보이기 때문에, 움직임 자체가 고차원 구조의 단서가 됩니다.',
    encoding: ['위치: 현재 투영 평면에 대한 정사영 좌표', '시간: 투영 평면의 연속 변화(재생 위치)', '희미한 선: 변수 축이 현재 평면에 투영된 방향', '색: 그룹'],
    suitable: ['변수 3~12개의 수치 데이터에서 군집·이상치·선형 구조를 탐색할 때', '여러 투영을 나열하는 산점도 행렬의 대안이 필요할 때', '고차원 정사영의 의미를 설명할 때'],
    howItWorks: ['시드로 재현되는 난수 경유 프레임(정규직교 2-프레임)들을 만듭니다.', '인접한 두 프레임을 부드러운 완화 곡선으로 보간한 뒤 그램–슈미트로 다시 정규직교화합니다.', '이 프레임을 (d×2) 투영 행렬로 곱해 각 관측값의 2차원 좌표를 구합니다.', '재생 속도가 시간 진행 속도이며, 정지하면 임의의 투영 위치를 슬라이더로 고를 수 있습니다.'],
    math: [
      { tex: '\\mathbf{y}_i(t)=F(t)^{\\top}\\mathbf{x}_i,\\qquad F(t)^{\\top}F(t)=I_2', caption: 'F(t)는 시각 t의 d×2 정규직교 투영 행렬' },
      { tex: '\\lVert \\mathbf{y}_i(t)\\rVert\\le\\lVert\\mathbf{x}_i\\rVert', caption: '정사영은 길이를 늘리지 않으므로 어떤 관측값도 원 밖으로 나가지 않습니다' },
    ],
    pros: ['선형 투영만 쓰므로 변수축의 의미가 유지됩니다.', '움직임이 구조 인식을 돕습니다(군집이 분리되는 순간이 드러남).', '관측값을 클릭해 따라가며 확인할 수 있습니다.'],
    cons: ['정지 이미지로는 전달되지 않습니다.', '변수가 많으면 대부분의 투영에서 점이 정규분포 모양으로 뭉칩니다.', '비선형 구조(곡면)는 선형 투영만으로 포착하기 어렵습니다.'],
    cautions: ['눈에 띄는 구조는 특정 순간의 투영 효과일 수 있으니 다른 시드·시각에서도 확인하세요.', '변수 단위 차이는 정규화로 맞춥니다.', '움직임 속도를 줄이면 점 추적이 쉬워집니다.'],
    differs: ['t-SNE·UMAP은 한 장의 비선형 임베딩을 계산하지만 Grand Tour는 계산 결과 없이 선형 투영의 연속 변화만 보여줍니다.', '산점도 행렬은 변수 쌍 축 정렬 투영을 나열하고, Grand Tour는 임의 방향의 투영을 시간에 펼칩니다.', 'Star Coordinates는 사용자가 축을 직접 조작하고 Grand Tour는 자동으로 변합니다.'],
    references: ['Asimov (1985), The Grand Tour: a tool for viewing multidimensional data, SIAM J. Sci. Stat. Comput.', 'Buja & Asimov (1986), Grand tour methods: an outline'],
  },
}
