export function storage_get(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function storage_set(key: string, value: string): number {
  try {
    localStorage.setItem(key, value)
    return 1
  } catch {
    return 0
  }
}

export function storage_remove(key: string): number {
  try {
    localStorage.removeItem(key)
    return 1
  } catch {
    return 0
  }
}

export function storage_read_json(key: string): unknown | null {
  const raw = storage_get(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function storage_write_json(key: string, value: unknown): number {
  try {
    const raw = JSON.stringify(value)
    if (raw === undefined) return 0
    return storage_set(key, raw)
  } catch {
    return 0
  }
}
