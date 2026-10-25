/* ================================================================
   optPool.js — пул воркеров для параллельного поиска оптимума.
   Если module workers недоступны — прозрачный fallback на main thread.
================================================================ */
import { findOptimumAsync } from './simulation.js'

let _pool = null

class OptWorkerPool {
  constructor(size) {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2
    this.size = Math.max(1, Math.min(size || cores, 4))
    this.workers = []
    this.queue = []
    this.pending = new Map()
    this.nextId = 0
    this._createWorkers()
    if (this.workers.length === 0) {
      console.warn('[optPool] воркеры недоступны — работаю на main thread')
      this.useFallback = true
    }
  }

  _createWorkers() {
    for (let i = 0; i < this.size; i++) {
      const slot = { busy: false, id: i, worker: null }
      if (!this._spawn(slot)) break
      this.workers.push(slot)
    }
  }

  _spawn(slot) {
    try {
      const w = new Worker(new URL('./optWorker.js', import.meta.url), { type: 'module' })
      slot.worker = w
      w.onmessage = (e) => this._onMessage(slot, e)
      w.onerror = (e) => this._onError(slot, e)
      return true
    } catch (err) {
      console.warn('[optPool] worker spawn failed', err)
      return false
    }
  }

  _onMessage(slot, e) {
    const { type, requestId, ...rest } = e.data || {}
    const task = this.pending.get(requestId)
    if (!task) return
    if (type === 'progress') {
      task.onProgress?.(rest.done, rest.total, rest.msg)
      return
    }
    this.pending.delete(requestId)
    slot.busy = false
    if (type === 'result') task.resolve(rest)
    else if (type === 'error') task.reject(new Error(rest.message || 'worker error'))
    this._pump()
  }

  _onError(slot, e) {
    console.error('[optPool] worker error', e)
    for (const [id, task] of this.pending) {
      if (task.slot === slot) {
        this.pending.delete(id)
        task.reject(new Error('worker error'))
        break
      }
    }
    slot.busy = false
    // Пробуем пересоздать воркер — дешёвая попытка самовосстановления
    try {
      slot.worker?.terminate()
      this._spawn(slot)
    } catch {}
    this._pump()
  }

  _pump() {
    if (this.useFallback) return
    for (const slot of this.workers) {
      if (slot.busy) continue
      const task = this.queue.shift()
      if (!task) return
      slot.busy = true
      this.pending.set(task.id, { ...task, slot })
      slot.worker.postMessage({
        type: 'findOptimum',
        requestId: task.id,
        upgrades: task.upgrades,
        cards: task.cards,
        opts: task.opts,
      })
    }
  }

  async _runInMainThread(task) {
    const data = await findOptimumAsync(task.upgrades, task.cards, task.opts, task.onProgress)
    return {
      bestDistance: data.best.distance,
      bestStrategy: data.best.strategy,
      bestAngle: data.best.angle,
    }
  }

  findOptimum(upgrades, cards, opts, onProgress) {
    if (this.useFallback) {
      return this._runInMainThread({ upgrades, cards, opts, onProgress })
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      this.queue.push({ id, upgrades, cards, opts, onProgress, resolve, reject })
      this._pump()
    })
  }
}

export function getOptPool() {
  if (!_pool) _pool = new OptWorkerPool()
  return _pool
}