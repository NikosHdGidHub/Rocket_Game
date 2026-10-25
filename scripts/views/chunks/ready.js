/* ================================================================
   ready.js — вставка готовых данных от воркеров в сцену.
   Соблюдает лимит CFG.RENDERER.maxChunksPerFrame и берёт самый
   ближний к камере чанк.
================================================================ */
import * as CFG from '../../config.js'
import { scene, camera } from '../scene.js'
import { lod } from '../../state.js'
import {
  CHUNK_SIZE,
  LOAD_FWD_CHUNKS,
  LOAD_BACK_CHUNKS,
  LOAD_SIDE_CHUNKS,
  UNLOAD_MARGIN,
} from './constants.js'
import { chunks } from './store.js'
import { readyChunks, readyChunksKeys } from './workers.js'
import { buildMeshFromWorker, spawnPropsFromWorker } from './mesh.js'
import { preloadState } from './queue.js'

export function processReadyChunks() {
  if (readyChunks.length === 0) return

  const camX = camera.position.x
  const camZ = camera.position.z
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

  const maxPerFrame = CFG.RENDERER.maxChunksPerFrame ?? 1
  let processed = 0

  while (readyChunks.length > 0 && processed < maxPerFrame) {
    let bestIdx = 0
    let bestD2 = Infinity
    for (let i = 0; i < readyChunks.length; i++) {
      const r = readyChunks[i]
      const wx = r.cx * CHUNK_SIZE + CHUNK_SIZE / 2
      const wz = r.cz * CHUNK_SIZE + CHUNK_SIZE / 2
      const dx = wx - camX
      const dz = wz - camZ
      const d2 = dx * dx + dz * dz
      if (d2 < bestD2) {
        bestD2 = d2
        bestIdx = i
      }
    }

    const { key, cx, cz, data } = readyChunks[bestIdx]
    readyChunks.splice(bestIdx, 1)
    readyChunksKeys.delete(key)
    if (chunks.has(key)) {
      console.debug('[dup chunk]', key)
      continue
    }

    const dx = cx - cxi
    const dz = cz - czi
    if (
      dx < -(LB + UNLOAD_MARGIN) ||
      dx > LF + UNLOAD_MARGIN ||
      Math.abs(dz) > LS + UNLOAD_MARGIN
    ) {
      continue
    }

    const mesh = buildMeshFromWorker(cx, cz, data)
    const props = spawnPropsFromWorker(data.propMatrices)

    scene.add(mesh)

    const wx = cx * CHUNK_SIZE + CHUNK_SIZE / 2
    const wz = cz * CHUNK_SIZE + CHUNK_SIZE / 2
    const ddx = wx - camera.position.x
    const ddz = wz - camera.position.z
    const dist = Math.sqrt(ddx * ddx + ddz * ddz)
    const maxGroundDist = scene.fog.far * 1.2
    const maxPropDist = CFG.PROPS.maxRenderDistance ?? 500

    const isGroundVisible = dist < maxGroundDist && lod.fade < 0.95
    mesh.visible = isGroundVisible
    const isPropVisible = isGroundVisible && lod.showing3D && dist < maxPropDist
    for (const p of props) p.visible = isPropVisible

    chunks.set(key, { mesh, props, cx, cz })

    processed++
  }
}
