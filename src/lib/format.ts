/** 展示格式化工具（纯函数） */

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(iso)} ${h}:${min}`
}

export function currentYear(): number {
  return new Date().getFullYear()
}
