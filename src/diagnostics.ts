function diagnostic_value(error: unknown): unknown {
  if (error instanceof Error || (typeof error === 'object' && error !== null)) return error
  return String(error)
}

export function report_warning(context: string, error: unknown): void {
  console.warn('[ugonote2] ' + context, diagnostic_value(error))
}

export function report_error(context: string, error: unknown): void {
  console.error('[ugonote2] ' + context, diagnostic_value(error))
}

export function is_abort_error(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
