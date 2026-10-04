import type { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: ReactNode
  hint?: string
}

export default function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}
