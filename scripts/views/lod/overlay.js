/* ================================================================
   overlay.js — точечные деревья поверх far-тайлов (2D-режим).
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene, applySkyFog } from '../scene.js'
import { lod, rocketState } from '../../state.js'
import {
  state,
  OVERLAY_SIZE,
  OVERLAY_SEG,
  OVERLAY_CANVAS,
  OVERLAY_LOAD_R,
  OVERLAY_UNLOAD_R,
} from './state.js'

function smoothstep(a, b, x) {
  if (x <= a) return 0
  if (x >= b) return 1
  const t = (x - a) / (b - a)
  return t * t * (3 - 2 * t)
}

export function getOverlayOpacity() {
  const groundFade =
    1 - smoothstep(CFG.SPACE.groundFadeStart, CFG.SPACE.groundFadeEnd, rocketState.pos.y)
  return state.farHighMode ? 0 : lod.fade * groundFade
}

function finalizeOverlayChunk(key, ox, oz, geo, canvas) {
  const old = state.overlayChunks.get(key)
  if (old) {
    scene.remove(old.mesh)
    old.geo.dispose()
    old.tex.dispose()
    old.mat.dispose()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.anisotropy = 8

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: CFG.OVERLAY.toneMapped,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })
  applySkyFog(mat)

  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(
    ox * OVERLAY_SIZE + OVERLAY_SIZE / 2,
    0,
    oz * OVERLAY_SIZE + OVERLAY_SIZE / 2
  )
  mesh.renderOrder = 2

  const op = getOverlayOpacity()
  mesh.material.opacity = op
  mesh.visible = op > 0.005

  // Инвалидируем кеш в fade.js — иначе следующий кадр не применит opacity.
  state.lastOverlayOpacity = NaN
  scene.add(mesh)
  state.overlayChunks.set(key, { mesh, mat, tex, geo })
}

function unloadOverlayChunk(key) {
  const c = state.overlayChunks.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.geo.dispose()
  c.tex.dispose()
  c.mat.dispose()
  state.overlayChunks.delete(key)
}

export function refillOverlayChunks(camX, camZ) {
  if (!CFG.OVERLAY.enabled || state.farHighMode) {
    for (const key of [...state.overlayChunks.keys()]) unloadOverlayChunk(key)
    state.pendingOverlays.clear()
    return
  }

  const oxi = Math.floor(camX / OVERLAY_SIZE)
  const ozi = Math.floor(camZ / OVERLAY_SIZE)

  for (let dx = -OVERLAY_LOAD_R; dx <= OVERLAY_LOAD_R; dx++) {
    for (let dz = -OVERLAY_LOAD_R; dz <= OVERLAY_LOAD_R; dz++) {
      const ox = oxi + dx
      const oz = ozi + dz
      const key = ox + ',' + oz

      if (!state.overlayChunks.has(key) && !state.pendingOverlays.has(key)) {
        state.pendingOverlays.add(key)
        state.lodWorker.postMessage({ type: 'overlay', ox, oz, canvasSize: OVERLAY_CANVAS })
      }
    }
  }

  for (const key of state.pendingOverlays) {
    const [oxs, ozs] = key.split(',')
    if (Math.abs(+oxs - oxi) > OVERLAY_UNLOAD_R || Math.abs(+ozs - ozi) > OVERLAY_UNLOAD_R) {
      state.pendingOverlays.delete(key)
    }
  }

  const toUnload = []
  for (const key of state.overlayChunks.keys()) {
    const [oxs, ozs] = key.split(',')
    if (Math.abs(+oxs - oxi) > OVERLAY_UNLOAD_R || Math.abs(+ozs - ozi) > OVERLAY_UNLOAD_R) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadOverlayChunk(k)
}

export function handleOverlayMessage(data) {
  const { ox, oz, posArr, nrmArr, pix } = data
  const key = ox + ',' + oz

  if (!state.pendingOverlays.has(key)) return
  state.pendingOverlays.delete(key)

  if (state.farHighMode || !CFG.OVERLAY.enabled) return

  const geo = new THREE.PlaneGeometry(OVERLAY_SIZE, OVERLAY_SIZE, OVERLAY_SEG, OVERLAY_SEG)
  geo.rotateX(-Math.PI / 2)
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3))

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = OVERLAY_CANVAS
  const ctx = canvas.getContext('2d')
  const imgData = new ImageData(new Uint8ClampedArray(pix), OVERLAY_CANVAS, OVERLAY_CANVAS)
  ctx.putImageData(imgData, 0, 0)

  finalizeOverlayChunk(key, ox, oz, geo, canvas)
}
