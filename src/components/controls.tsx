import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

export function ControlGroup({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="control-group">
      <button type="button" className="control-group-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <ChevronDown size={16} className={open ? 'rot-180' : ''} aria-hidden="true" />
      </button>
      <div id={id} className="control-group-body" hidden={!open}>{children}</div>
    </section>
  )
}

export function Slider({ label, value, min, max, step = 1, onChange, format, testId, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; testId?: string; disabled?: boolean
}) {
  const id = useId()
  return (
    <div className={`field slider-field ${disabled ? 'is-disabled' : ''}`}>
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

export function Select<T extends string>({ label, value, options, onChange, testId, disabled }: {
  label: string; value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; testId?: string; disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="select-wrap">
        <select id={id} value={value} disabled={disabled} data-testid={testId} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled} title={o.title}>{o.label}</option>)}
        </select>
        <ChevronDown size={15} aria-hidden="true" />
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ label, value, options, onChange, testId }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId?: string
}) {
  return (
    <div className="field">
      <span className="field-label" id={`${testId ?? label}-label`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label} data-testid={testId}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

export function Toggle({ label, checked, onChange, testId, description }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string; description?: string }) {
  const id = useId()
  return (
    <div className="field toggle-field">
      <label htmlFor={id}>
        <span>{label}{description && <small>{description}</small>}</span>
        <input id={id} type="checkbox" role="switch" checked={checked} data-testid={testId} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch" aria-hidden="true" />
      </label>
    </div>
  )
}

export function NumberField({ label, value, onChange, step = 1, min, max, testId }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; testId?: string }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (s: string) => {
    const v = Number(s)
    if (s.trim() !== '' && Number.isFinite(v)) onChange(min != null && v < min ? min : max != null && v > max ? max : v)
    setDraft(null)
  }
  return (
    <div className="field number-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" step={step} min={min} max={max} data-testid={testId} value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }} />
    </div>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="control-hint">{children}</p>
}

/** Small key/value statistic table used in control panels. */
export function StatTable({ rows, caption }: { rows: (string | ReactNode)[][]; caption?: string }) {
  if (!rows.length) return null
  const [head, ...body] = rows
  return (
    <div className="stat-table-wrap">
      <table className="stat-table">
        {caption && <caption>{caption}</caption>}
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  )
}
