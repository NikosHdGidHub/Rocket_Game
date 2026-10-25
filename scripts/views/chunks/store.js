/* ================================================================
   store.js — реестр живых чанков в сцене.
   loadChunk / unloadChunk — синхронные операции (используются и
   при стартовой загрузке, и как fallback, если воркеров нет).
================================================================ */
import * as CFG from '../../config.js'
import { scene } from '../scene.js'
import { lod } from '../../state.js'
import { getProps, collectShadowItems, propsCache } from './props.js'
import { makeChunkMesh, spawnChunkProps } from './mesh.js'

export const chunks = new Map()

export const PERSISTENT_CHUNKS = new Set()
{
  const P = CFG.CHUNKS.persistentStart
  for (let cx = P.xMin; cx <= P.xMax; cx++) {
    for (let cz = P.zMin; cz <= P.zMax; cz++) {
      PERSISTENT_CHUNKS.add(cx + ',' + cz)
    }
  }
}

export function loadChunk(cx, cz) {
  const key = cx + ',' + cz
  if (chunks.has(key)) return

  const items = getProps(cx, cz)
  const shadowItems = PERSISTENT_CHUNKS.has(key) ? collectShadowItems(cx, cz) : items
  const mesh = makeChunkMesh(cx, cz, shadowItems)
  const props = spawnChunkProps(cx, cz, items, mesh.userData.terrainSampler)

  scene.add(mesh)
  mesh.visible = lod.fade < 0.95
  for (const p of props) p.visible = lod.showing3D
  chunks.set(key, { mesh, props, cx, cz })
}

export function unloadChunk(key) {
  if (PERSISTENT_CHUNKS.has(key)) return

  const c = chunks.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.mesh.geometry.dispose()
  for (const p of c.props) scene.remove(p)
  chunks.delete(key)
  propsCache.delete(key)
}
