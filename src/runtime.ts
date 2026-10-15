const app_script = document.currentScript as HTMLScriptElement | null
const app_base = new URL('.', app_script?.src || location.href)

export function app_asset(name: string): string {
  return new URL(name, app_base).href
}

export function app_hosted(): number {
  if ((globalThis as { __ug2_worker_src?: string }).__ug2_worker_src) return 0
  return app_base.href === new URL('.', location.href).href ? 1 : 0
}
