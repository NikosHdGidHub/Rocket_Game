/* ================================================================
   visibility.js — управление видимостью чанков и persistent-чанков
   по расстоянию от камеры. Не выгружает — только скрывает.
================================================================ */
import * as CFG from '../../config.js'
import { scene, camera } from '../scene.js'
import { lod } from '../../state.js'
import { CHUNK_SIZE } from './constants.js'
import { chunks, PERSISTENT_CHUNKS } from './store.js'

export function updatePersistentVisibility(camX, camZ) {
  if (PERSISTENT_CHUNKS.size === 0) return

  const R = CFG.CHUNKS.persistentVisibleRadius
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  const showFine = lod.fade < 0.95
  const showProps = lod.showing3D

  for (const key of PERSISTENT_CHUNKS) {
    const c = chunks.get(key)
    if (!c) continue

    const [cs, czs] = key.split(',')
    const near = Math.abs(+cs - cxi) <= R && Math.abs(+czs - czi) <= R

    c.mesh.visible = near && showFine

    const pv = near && showProps
    for (const p of c.props) p.visible = pv
  }
}

export function updateChunkVisibility(camX, camY, camZ) {
  const cxi = Math.floor(camX / CHUNK_SIZE)

  const maxGroundDist = scene.fog.far * 1.2
  const maxPropDist = CFG.PROPS.maxRenderDistance ?? 500

  for (const [key, c] of chunks) {
    if (PERSISTENT_CHUNKS.has(key)) continue

    const isBehind = c.cx < cxi - 1
    const wx = c.cx * CHUNK_SIZE + CHUNK_SIZE / 2
    const wz = c.cz * CHUNK_SIZE + CHUNK_SIZE / 2
    const dx = wx - camX
    const dz = wz - camZ
    const dist = Math.sqrt(dx * dx + dz * dz)

    const isGroundVisible = !isBehind && dist < maxGroundDist && lod.fade < 0.95
    c.mesh.visible = isGroundVisible

    const isPropVisible = isGroundVisible && lod.showing3D && dist < maxPropDist
    for (const p of c.props) p.visible = isPropVisible
  }
}
