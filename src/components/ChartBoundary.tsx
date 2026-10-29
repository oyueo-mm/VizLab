import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; compact?: boolean; resetKey?: unknown }
interface State { error: Error | null; key: unknown }

/** Keeps one broken chart (e.g. from unusual user data) from taking down the page. */
export class ChartBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Any change to the inputs gives the chart another chance to render.
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  render() {
    if (this.state.error) {
      return this.props.compact ? null : (
        <div className="chart-message" role="alert">
          이 데이터로는 그래프를 그릴 수 없습니다. 데이터나 설정을 바꿔 보세요.
          <small>{this.state.error.message}</small>
        </div>
      )
    }
    return this.props.children
  }
}
