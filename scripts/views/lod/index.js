/* ================================================================
   lod/index.js — публичный API модуля LOD.
   init, update, loadInitialFar, countInitialFar, setPhaseGetter, getStats.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { camera, applySkyFog, groundTex } from '../scene.js'
import { lod, rocketState } from '../../state.js'
import { state, FAR_TILE_SIZE, OVERLAY_SIZE } from './state.js'
import { refillFarTiles, updateFarMode, handleFarMessage } from './farTiles.js'
import { refillOverlayChunks, handleOverlayMessage } from './overlay.js'
import { updateLOD, updateFogEllipse } from './fade.js'
import LodWorker from '../../workers/lodWorker.js?worker'

export { setPhaseGetter } from './fade.js'

/* ================================================================
   init
================================================================ */
export function init() {
  state.farGroundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  applySkyFog(state.farGroundMat)

  state.lodWorker = new LodWorker()
  state.lodWorker.onmessage = (e) => {
    const data = e.data
    if (data.type === 'far') handleFarMessage(data)
    else if (data.type === 'overlay') handleOverlayMessage(data)
  }
  state.lodWorker.onerror = (err) => console.error('[lodWorker] error:', err)
  state.lodWorker.postMessage({ type: 'init', density: CFG.PROPS.density })
}

/* ================================================================
   update — per-frame
================================================================ */
let _lastFar = { x: NaN, z: NaN }
let _lastOverlay = { x: NaN, z: NaN }
let _farCheckTimer = 0
const FAR_PERIODIC_CHECK = 0.4 // сек

export function update(dt) {
  const camX = camera.position.x
  const camZ = camera.position.z

  updateFogEllipse(dt)
  updateLOD(dt)

  // Полный космос: нижний мир уже погашен — не тратим CPU.
  if (rocketState.pos.y >= CFG.SPACE.groundFadeEnd) {
    _lastFar.x = NaN
    _lastFar.z = NaN
    _lastOverlay.x = NaN
    _lastOverlay.z = NaN
    return
  }

  const modeChanged = updateFarMode(lod.altSmooth)
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)

  // Периодическая «зачистка дыр»: даже когда камера стоит и режим стабилен,
  // раз в FAR_PERIODIC_CHECK секунд дозапрашиваем недостающие / устаревшие
  // тайлы. Нужно из-за throttling в refillFarTiles: за один вызов
  // отправляется только MAX_PER_CALL запросов, остальные должны
  // «дозаполняться» в следующих вызовах, а не ждать движения камеры.
  _farCheckTimer += dt
  const periodicCheck = _farCheckTimer >= FAR_PERIODIC_CHECK
  if (periodicCheck) _farCheckTimer = 0

  if (modeChanged || fxi !== _lastFar.x || fzi !== _lastFar.z || periodicCheck) {
    refillFarTiles(camX, camZ)
    _lastFar.x = fxi
    _lastFar.z = fzi
  }

  const oxi = Math.floor(camX / OVERLAY_SIZE)
  const ozi = Math.floor(camZ / OVERLAY_SIZE)
  if (oxi !== _lastOverlay.x || ozi !== _lastOverlay.z) {
    refillOverlayChunks(camX, camZ)
    _lastOverlay.x = oxi
    _lastOverlay.z = ozi
  }
}

/* ================================================================
   loadInitialFar / countInitialFar
================================================================ */
export async function loadInitialFar(onStep) {
  refillFarTiles(camera.position.x, camera.position.z)
  let done = 0
  onStep(0)

  while (state.pendingFarTiles.size > 0 || state.farTiles.size === 0) {
    await new Promise((r) => setTimeout(r, 50))
    done = state.farTiles.size
    onStep(done)
  }
  return done
}

export function countInitialFar() {
  refillFarTiles(camera.position.x, camera.position.z)
  return state.pendingFarTiles.size + state.farTiles.size
}

/* ================================================================
   Debug
================================================================ */
export function getStats() {
  let stale = 0
  for (const [, c] of state.farTiles) {
    // «Stale» — только те, что грубее текущего (нужна дорисовка).
    // Тайлы детальнее — это фича, не считаем их.
    if (c.seg < state.farTileSeg) stale++
  }
  return {
    farTiles: state.farTiles.size,
    overlayChunks: state.overlayChunks.size,
    pendingFar: state.pendingFarTiles.size,
    pendingOverlays: state.pendingOverlays.size,
    farSeg: state.farTileSeg,
    farHighMode: state.farHighMode,
    farStale: stale, // сколько загруженных тайлов с устаревшим seg
  }
}
