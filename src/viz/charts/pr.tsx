import type { ChartProps, ControlsProps, VizModule } from '../types'
import { ClassifierChart, ClassifierControls, classifierDefaults, classifierRoles, type ClassifierParams } from './classifier'

const PrChart = (props: ChartProps<ClassifierParams>) => <ClassifierChart kind="pr" {...props} />
const PrControls = (props: ControlsProps<ClassifierParams>) => <ClassifierControls kind="pr" {...props} />

export const prModule: VizModule<ClassifierParams> = {
  roles: classifierRoles,
  datasets: ['scores-imbalanced', 'scores'],
  defaultParams: { ...classifierDefaults, threshold: 0.4 },
  Chart: PrChart,
  Controls: PrControls,
  hint: '불균형 데이터와 균형 데이터를 바꿔 가며 비교 · 점선 가로선은 무작위 분류의 정밀도(양성 비율) · ROC와 함께 보기',
}
