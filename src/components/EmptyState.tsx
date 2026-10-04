import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  hint?: string
  children?: ReactNode
}

export default function EmptyState({ title, hint, children }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {children}
    </section>
  )
}
