import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatSize(bytes?: number) {
  if (!bytes) return ''
  const mb = Number(bytes) / 1048576
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB'
  return (mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)) + ' MB'
}
