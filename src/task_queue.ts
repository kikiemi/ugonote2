const callbacks: (() => void)[] = []
let channel: MessageChannel | null = null

export function task_schedule(callback: () => void): void {
  if (!channel) {
    channel = new MessageChannel()
    channel.port1.onmessage = () => { callbacks.shift()?.() }
  }
  callbacks.push(callback)
  channel.port2.postMessage(0)
}

export function task_yield(): Promise<void> {
  return new Promise(resolve => task_schedule(resolve))
}

export function task_timeout<t>(promise: Promise<t>, milliseconds: number): Promise<t> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('処理の応答がありません。もう一度お試しください')), milliseconds)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}
