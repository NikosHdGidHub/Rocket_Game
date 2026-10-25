/* ================================================================
   queue.js — очередь чанков на загрузку и её обработка.
   - refillChunkQueue: пересчитать очередь под позицию камеры.
   - processChunkQueue: раздать задачи свободным воркерам.
   - preloadState: флаг «режим префетча» (общий с ready.js/update).
================================================================ */
import * as CFG from '../../config.js'
import { lod } from '../../state.js'
import {
  CHUNK_SIZE,
  LOAD_FWD_CHUNKS,
  LOAD_BACK_CHUNKS,
  LOAD_SIDE_CHUNKS,
  UNLOAD_MARGIN,
} from './constants.js'
import { chunks, PERSISTENT_CHUNKS, loadChunk, unloadChunk } from './store.js'
import { propsCache } from './props.js'
import { pendingChunks, readyChunksKeys, dispatchChunk, workerPool } from './workers.js'

export const preloadState = { active: false }

export const chunkLoadQueue = []
let chunkQueueIdx = 0

export function refillChunkQueue(camX, camZ) {
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  let LF, LB, LS
  if (preloadState.active) {
    LF = CFG.CHUNKS.loadForwardFar
    LB = CFG.CHUNKS.loadBackFar
    LS = CFG.CHUNKS.loadSideFar
  } else {
    LF = LOAD_FWD_CHUNKS
    LB = LOAD_BACK_CHUNKS
    LS = LOAD_SIDE_CHUNKS
  }

  const toUnload = []
  for (const key of chunks.keys()) {
    const [cs, czs] = key.split(',')
    const dx = +cs - cxi,
      dz = +czs - czi
    if (dx < -(LB + UNLOAD_MARGIN) || dx > LF + UNLOAD_MARGIN || Math.abs(dz) > LS + UNLOAD_MARGIN)
      toUnload.push(key)
  }
  for (const k of toUnload) unloadChunk(k)

  const padXf = LF + 1
  const padXb = LB + 1
  const padZ = LS + 1
  for (const key of propsCache.keys()) {
    if (PERSISTENT_CHUNKS.has(key)) continue
    const [cs, czs] = key.split(',')
    const dx = +cs - cxi
    const dz = +czs - czi
    if (dx < -padXb || dx > padXf || Math.abs(dz) > padZ) {
      propsCache.delete(key)
    }
  }

  const candidates = []
  for (let dx = -LB; dx <= LF; dx++) {
    for (let dz = -LS; dz <= LS; dz++) {
      const cx = cxi + dx
      const cz = czi + dz
      const key = cx + ',' + cz
      if (chunks.has(key) || pendingChunks.has(key) || readyChunksKeys.has(key)) continue
      const score = dx === 0 && dz === 0 ? -1000 : -dx * 2 + Math.abs(dz)
      candidates.push({ cx, cz, score })
    }
  }
  candidates.sort((a, b) => a.score - b.score)

  chunkLoadQueue.length = 0
  chunkQueueIdx = 0
  for (const c of candidates) chunkLoadQueue.push([c.cx, c.cz])
}

export function processChunkQueue() {
  if (lod.fade > 0.5 && !preloadState.active) return
  if (chunkQueueIdx >= chunkLoadQueue.length) {
    chunkLoadQueue.length = 0
    chunkQueueIdx = 0
    return
  }

  // Fallback: sync, если worker pool пустой
  if (workerPool.length === 0) {
    const BUDGET_MS = preloadState.active ? 6 : 4
    const t0 = performance.now()
    while (chunkQueueIdx < chunkLoadQueue.length && performance.now() - t0 < BUDGET_MS) {
      const [cx, cz] = chunkLoadQueue[chunkQueueIdx++]
      if (!chunks.has(cx + ',' + cz)) loadChunk(cx, cz)
    }
    return
  }

  while (chunkQueueIdx < chunkLoadQueue.length) {
    const [cx, cz] = chunkLoadQueue[chunkQueueIdx]
    const key = cx + ',' + cz

    if (chunks.has(key) || pendingChunks.has(key) || readyChunksKeys.has(key)) {
      chunkQueueIdx++
      continue
    }
    if (!dispatchChunk(cx, cz)) break
    chunkQueueIdx++
  }

  if (chunkQueueIdx >= chunkLoadQueue.length) {
    chunkLoadQueue.length = 0
    chunkQueueIdx = 0
  }
}
