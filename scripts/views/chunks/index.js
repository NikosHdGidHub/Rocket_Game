/* ================================================================
   chunks/index.js — публичный API модуля чанков.
   Экспортирует всё, что раньше торчало из scripts/chunks.js:
   init, update, loadInitial, countInitial, getStats, debugPersistent,
   а также CHUNK_SIZE, chunks, PERSISTENT_CHUNKS, propMat, getProps.
================================================================ */
import * as CFG from '../../config.js'
import { camera, applySkyFog } from '../scene.js'
import { lod } from '../../state.js'
import {
  CHUNK_SIZE,
  LOAD_FWD_CHUNKS,
  LOAD_BACK_CHUNKS,
  LOAD_SIDE_CHUNKS,
} from './constants.js'
import { chunks, PERSISTENT_CHUNKS, loadChunk } from './store.js'
import { propMat, getProps,propsCache } from './props.js'
import { refillChunkQueue, processChunkQueue, preloadState } from './queue.js'
import { processReadyChunks } from './ready.js'
import { updatePersistentVisibility, updateChunkVisibility } from './visibility.js'
import { initWorkerPool, pendingChunks, readyChunks, workerPool } from './workers.js'

/* ---------- Re-export публичного API ---------- */
export { CHUNK_SIZE } from './constants.js'
export { chunks, PERSISTENT_CHUNKS, loadChunk, unloadChunk } from './store.js'
export { propMat, getProps } from './props.js'

/* ================================================================
   init
================================================================ */
export function init() {
  applySkyFog(propMat)
  initWorkerPool()
}

/* ================================================================
   update — per-frame
================================================================ */
let _lastCell = { x: NaN, z: NaN }
let _lastPersist = { cxi: NaN, czi: NaN, showFine: null, showProps: null }

export function update() {
  const camX = camera.position.x
  const camY = camera.position.y
  const camZ = camera.position.z
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  const showFine = lod.fade < 0.95
  const showProps = lod.showing3D
  if (
    cxi !== _lastPersist.cxi ||
    czi !== _lastPersist.czi ||
    showFine !== _lastPersist.showFine ||
    showProps !== _lastPersist.showProps
  ) {
    updatePersistentVisibility(camX, camZ)
    _lastPersist = { cxi, czi, showFine, showProps }
  }

  if (lod.fade > 0.5 && !preloadState.active && lod.altSmooth > CFG.CHUNKS.preloadAltitude) {
    return
  }

  const wantPreload = lod.fade > 0.5 && lod.altSmooth < CFG.CHUNKS.preloadAltitude

  if (wantPreload !== preloadState.active) {
    preloadState.active = wantPreload
    refillChunkQueue(camX, camZ)
    _lastCell.x = cxi
    _lastCell.z = czi
  } else if (cxi !== _lastCell.x || czi !== _lastCell.z) {
    if (lod.fade < 0.5 || preloadState.active) refillChunkQueue(camX, camZ)
    _lastCell.x = cxi
    _lastCell.z = czi
  }

  processReadyChunks()
  processChunkQueue()

  if (
    cxi !== _lastPersist.cxi ||
    czi !== _lastPersist.czi ||
    showFine !== _lastPersist.showFine ||
    showProps !== _lastPersist.showProps
  ) {
    updatePersistentVisibility(camX, camZ)
    _lastPersist = { cxi, czi, showFine, showProps }
  }
  updateChunkVisibility(camX, camY, camZ)
}

/* ================================================================
   loadInitial / countInitial — стартовая загрузка
================================================================ */
export async function loadInitial(onStep) {
  const camX = camera.position.x
  const camZ = camera.position.z
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  const needed = []
  const seen = new Set()
  for (let dx = -LOAD_BACK_CHUNKS; dx <= LOAD_FWD_CHUNKS; dx++) {
    for (let dz = -LOAD_SIDE_CHUNKS; dz <= LOAD_SIDE_CHUNKS; dz++) {
      const key = cxi + dx + ',' + (czi + dz)
      if (!seen.has(key)) {
        seen.add(key)
        needed.push([cxi + dx, czi + dz])
      }
    }
  }
  for (const key of PERSISTENT_CHUNKS) {
    if (seen.has(key)) continue
    const [cs, czs] = key.split(',')
    needed.push([+cs, +czs])
  }

  let done = 0
  onStep(done)

  const BUDGET_MS = 12
  for (let i = 0; i < needed.length; ) {
    const t0 = performance.now()
    while (i < needed.length && performance.now() - t0 < BUDGET_MS) {
      const [cx, cz] = needed[i]
      loadChunk(cx, cz)
      i++
      done++
    }
    onStep(done)
    await new Promise((r) => requestAnimationFrame(r))
  }
  return done
}

export function countInitial() {
  const camX = camera.position.x
  const camZ = camera.position.z
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  const seen = new Set()
  let n = 0
  for (let dx = -LOAD_BACK_CHUNKS; dx <= LOAD_FWD_CHUNKS; dx++) {
    for (let dz = -LOAD_SIDE_CHUNKS; dz <= LOAD_SIDE_CHUNKS; dz++) {
      const key = cxi + dx + ',' + (czi + dz)
      if (!seen.has(key)) {
        seen.add(key)
        n++
      }
    }
  }
  for (const key of PERSISTENT_CHUNKS) {
    if (!seen.has(key)) {
      seen.add(key)
      n++
    }
  }
  return n
}

/* ================================================================
   Debug
================================================================ */
export function getStats() {
  let persistentLoaded = 0
  for (const key of chunks.keys()) if (PERSISTENT_CHUNKS.has(key)) persistentLoaded++
  return {
    chunks: chunks.size,
    persistentLoaded,
    persistentTotal: PERSISTENT_CHUNKS.size,
    propsCache: propsCache.size,
    pending: pendingChunks.size,
    ready: readyChunks.length,
    poolSize: workerPool.length,
    poolBusy: workerPool.filter((s) => s.busy).length,
  }
}

export function debugPersistent() {
  const list = []
  for (const key of PERSISTENT_CHUNKS) {
    const c = chunks.get(key)
    list.push({ key, loaded: !!c, visible: c ? c.mesh.visible : null })
  }
  return list
}
