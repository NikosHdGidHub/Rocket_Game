/* ================================================================
   workers.js — пул воркеров для асинхронной генерации чанков.
   Хранит pendingChunks (запросы в работе), readyChunks (готовые
   данные, ждущие вставки в сцену) и worker pool.
================================================================ */
import * as CFG from '../../config.js'
import { chunks } from './store.js'
import ChunkWorker from '../../workers/chunkWorker.js?worker'

const POOL_SIZE = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1))

export const workerPool = []
export const pendingChunks = new Map()
export const readyChunks = []
export const readyChunksKeys = new Set()

let _workersReady = false

export function initWorkerPool() {
  if (_workersReady) return
  _workersReady = true
  try {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new ChunkWorker()
      const idx = i
      w.onmessage = (e) => onWorkerMessage(idx, e)
      w.onerror = (err) => console.error('[chunks] worker error:', err)
      w.postMessage({ type: 'init', density: CFG.PROPS.density, segments: CFG.CHUNKS.segments })
      workerPool.push({ worker: w, busy: false })
    }
    console.log(`[chunks] worker pool: ${workerPool.length}`)
  } catch (err) {
    console.warn('[chunks] Web Workers недоступны, fallback на sync:', err)
  }
}

export function onWorkerMessage(workerIdx, e) {
  const data = e.data
  const { cx, cz } = data
  const key = cx + ',' + cz

  const slot = workerPool[workerIdx]
  if (slot) slot.busy = false

  const wasPending = pendingChunks.delete(key)

  if (!wasPending || chunks.has(key) || readyChunksKeys.has(key)) {
    return
  }

  readyChunks.push({ key, cx, cz, data })
  readyChunksKeys.add(key)
}

export function dispatchChunk(cx, cz) {
  let slot = null
  for (const s of workerPool) {
    if (!s.busy) {
      slot = s
      break
    }
  }
  if (!slot) return false

  const key = cx + ',' + cz
  slot.busy = true
  slot.worker.postMessage({ cx, cz })
  pendingChunks.set(key, true)
  return true
}
