interface ProgressBarProps {
  /** 0 表示不确定进度（分页总数未知） */
  current: number
  total: number
  label?: string
}

export default function ProgressBar({ current, total, label }: ProgressBarProps) {
  const determinate = total > 0
  const pct = determinate ? Math.min(100, Math.round((current / total) * 100)) : 0
  return (
    <div className="progress-wrap">
      <div
        className={`progress-track ${determinate ? '' : 'indeterminate'}`}
        role="progressbar"
        aria-valuenow={determinate ? pct : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {determinate && <div className="progress-fill" style={{ width: `${pct}%` }} />}
      </div>
      {(label || determinate) && (
        <span className="progress-label">
          {label ?? `${pct}%（${current}/${total}）`}
        </span>
      )}
    </div>
  )
}
