import type { ChartProps, ControlsProps, VizModule } from '../types'
import { ClassifierChart, ClassifierControls, classifierDefaults, classifierRoles, type ClassifierParams } from './classifier'

const RocChart = (props: ChartProps<ClassifierParams>) => <ClassifierChart kind="roc" {...props} />
const RocControls = (props: ControlsProps<ClassifierParams>) => <ClassifierControls kind="roc" {...props} />

export const rocModule: VizModule<ClassifierParams> = {
  roles: classifierRoles,
  datasets: ['scores', 'scores-imbalanced'],
  defaultParams: classifierDefaults,
  Chart: RocChart,
  Controls: RocControls,
  hint: '임계값 슬라이더를 움직이거나 곡선을 클릭 · 주황 점이 현재 임계값의 TPR·FPR · 대각선은 무작위 분류',
}
