#!/usr/bin/env bash
set -e

mkdir -p scripts/views/lod

# ============================================================
# 1. state.js — общее состояние + константы
# ============================================================
cat > scripts/views/lod/state.js <<'EOF'
/* ================================================================
   state.js — состояние и константы модуля LOD.
   Общие Maps/Sets и ссылки для far-tile, overlay и fade.
================================================================ */
import * as CFG from '../../config.js'

export const FAR_TILE_SIZE = CFG.FAR_TILES.size
export const OVERLAY_SIZE = CFG.OVERLAY.size
export const OVERLAY_SEG = CFG.OVERLAY.segments
export const OVERLAY_CANVAS = CFG.OVERLAY.canvasSize
export const OVERLAY_LOAD_R = CFG.OVERLAY.loadRadius
export const OVERLAY_UNLOAD_R = CFG.OVERLAY.unloadRadius

export const state = {
  /* ---------- Общие ссылки ---------- */
  lodWorker: null,
  farGroundMat: null,

  /* ---------- Far tiles ---------- */
  farTileSeg: CFG.FAR_TILES.segments,
  farHighMode: false,
  farTiles: new Map(),
  pendingFarTiles: new Set(),

  /* ---------- Overlay ---------- */
  overlayChunks: new Map(),
  pendingOverlays: new Set(),

  /* ---------- Кэши для fade.js ---------- */
  lastOverlayOpacity: -1,
  lastFarOpacity: -1,
  lastShowFineChunks: null,
}
EOF

# ============================================================
# 2. farTiles.js — far-tile логика
# ============================================================
cat > scripts/views/lod/farTiles.js <<'EOF'
/* ================================================================
   farTiles.js — управление дальними тайлами земли.
   Запросы, финализация (добавление в сцену), выгрузка,
   переключение low/high режима.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene } from '../scene.js'
import { lod } from '../../state.js'
import { state, FAR_TILE_SIZE } from './state.js'

function getFarLoadBounds() {
  if (state.farHighMode) {
    return {
      fwd: CFG.FAR_TILES.loadFwdHigh,
      back: CFG.FAR_TILES.loadBackHigh,
      side: CFG.FAR_TILES.loadSideHigh,
    }
  }
  return {
    fwd: CFG.FAR_TILES.loadFwd,
    back: CFG.FAR_TILES.loadBack,
    side: CFG.FAR_TILES.loadSide,
  }
}

function getFarUnloadBounds() {
  const m = CFG.FAR_TILES.unloadMargin
  const L = getFarLoadBounds()
  return { fwd: L.fwd + m, back: L.back + m, side: L.side + m }
}

export function updateFarMode(altSmooth) {
  const F = CFG.FAR_TILES
  let next = state.farHighMode
  if (!state.farHighMode && altSmooth > F.altitudeHigh) next = true
  else if (state.farHighMode && altSmooth < F.altitudeLow) next = false

  if (next === state.farHighMode) return false
  state.farHighMode = next
  state.farTileSeg = state.farHighMode ? F.segmentsHigh : F.segments
  return true
}

function finalizeFarTile(key, fx, fz, geo, seg) {
  const old = state.farTiles.get(key)
  if (old) {
    scene.remove(old.mesh)
    old.geo.dispose()
  }
  const mesh = new THREE.Mesh(geo, state.farGroundMat)
  mesh.position.set(
    fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2,
    0,
    fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  )
  mesh.receiveShadow = false
  mesh.visible = lod.fade > 0.005
  scene.add(mesh)
  state.farTiles.set(key, { mesh, geo, seg })
}

function unloadFarTile(key) {
  state.pendingFarTiles.delete(key)
  const c = state.farTiles.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.geo.dispose()
  state.farTiles.delete(key)
}

export function refillFarTiles(camX, camZ) {
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)
  const L = getFarLoadBounds()
  const U = getFarUnloadBounds()

  for (let dx = -L.back; dx <= L.fwd; dx++) {
    for (let dz = -L.side; dz <= L.side; dz++) {
      const fx = fxi + dx
      const fz = fzi + dz
      const key = fx + ',' + fz
      const loaded = state.farTiles.get(key)
      const pending = state.pendingFarTiles.has(key)

      if (loaded && loaded.seg < state.farTileSeg) {
        if (!pending) {
          state.pendingFarTiles.add(key)
          state.lodWorker.postMessage({ type: 'far', fx, fz, seg: state.farTileSeg })
        }
        continue
      }

      if (!loaded && !pending) {
        state.pendingFarTiles.add(key)
        state.lodWorker.postMessage({ type: 'far', fx, fz, seg: state.farTileSeg })
      }
    }
  }

  for (const key of state.pendingFarTiles) {
    const [fxs, fzs] = key.split(',')
    const fx = +fxs
    const fz = +fzs
    if (fx - fxi > U.fwd || fxi - fx > U.back || Math.abs(fz - fzi) > U.side) {
      state.pendingFarTiles.delete(key)
    }
  }

  const toUnload = []
  for (const key of state.farTiles.keys()) {
    const [fxs, fzs] = key.split(',')
    const fx = +fxs
    const fz = +fzs
    if (fx - fxi > U.fwd || fxi - fx > U.back || Math.abs(fz - fzi) > U.side) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadFarTile(k)
}

export function handleFarMessage(data) {
  const { fx, fz, seg, posArr, uvArr, nrmArr, colArr } = data
  const key = fx + ',' + fz

  if (!state.pendingFarTiles.has(key)) return
  state.pendingFarTiles.delete(key)

  if (seg !== state.farTileSeg) return

  const geo = new THREE.PlaneGeometry(FAR_TILE_SIZE, FAR_TILE_SIZE, seg, seg)
  geo.rotateX(-Math.PI / 2)
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2))
  geo.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))

  finalizeFarTile(key, fx, fz, geo, seg)
}
EOF

# ============================================================
# 3. overlay.js — overlay (2D-точки деревьев)
# ============================================================
cat > scripts/views/lod/overlay.js <<'EOF'
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
EOF

# ============================================================
# 4. fade.js — updateLOD + updateFogEllipse + setPhaseGetter
# ============================================================
cat > scripts/views/lod/fade.js <<'EOF'
/* ================================================================
   fade.js — плавный переход 3D ⇄ 2D, туман, видимость слоёв.
================================================================ */
import * as CFG from '../../config.js'
import { scene, fogU } from '../scene.js'
import { lod, rocketState } from '../../state.js'
import { chunks, PERSISTENT_CHUNKS } from '../chunks/index.js'
import { boss } from '../entities/index.js'
import { terrainHeight } from '../../world/world.js'
import { state } from './state.js'
import { getOverlayOpacity } from './overlay.js'

function smoothstep(a, b, x) {
  if (x <= a) return 0
  if (x >= b) return 1
  const t = (x - a) / (b - a)
  return t * t * (3 - 2 * t)
}

/* Локальный доступ к фазе без импорта game.js (избегаем циклов). */
let _getPhase = () => 'ready'
export function setPhaseGetter(fn) {
  _getPhase = fn
}
const G_PHASE = () => _getPhase()

export function updateFogEllipse(dt) {
  fogU.center.value.set(rocketState.pos.x, rocketState.pos.z)
  const v = rocketState.vel
  const speed = Math.hypot(v.x, v.z)

  if (speed >= CFG.FOG.dirMinSpeed) {
    const tx = v.x / speed
    const tz = v.z / speed
    const k = 1 - Math.exp(-CFG.FOG.dirSmoothing * dt)
    fogU.dir.value.x += (tx - fogU.dir.value.x) * k
    fogU.dir.value.y += (tz - fogU.dir.value.y) * k
    const l = Math.hypot(fogU.dir.value.x, fogU.dir.value.y) || 1
    fogU.dir.value.x /= l
    fogU.dir.value.y /= l
  }
}

export function updateLOD(dt) {
  const CHANGE_OVERLAY = CFG.LOD.changeAltitude
  const CHANGE_OVERLAY_BACK = CFG.LOD.changeBack
  const SAMPLE_R = CFG.LOD.sampleRadius
  const SAMPLES = CFG.LOD.sampleCount

  const p = rocketState.pos
  const flying = G_PHASE() === 'fly'

  let alt = p.y - terrainHeight(p.x, p.z)
  for (let i = 0; i < SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2
    const gx = p.x + Math.cos(a) * SAMPLE_R
    const gz = p.z + Math.sin(a) * SAMPLE_R
    const a2 = p.y - terrainHeight(gx, gz)
    if (a2 < alt) alt = a2
  }
  if (alt < 0) alt = 0

  if (!lod.altInit) {
    lod.altSmooth = alt
    lod.fogAlt = alt
    lod.fogDelay = 0
    lod.altInit = true
  } else {
    const k = 1 - Math.exp(-4.0 * dt)
    lod.altSmooth += (alt - lod.altSmooth) * k

    const fogDiff = alt - lod.fogAlt
    if (fogDiff >= 0) {
      lod.fogDelay = CFG.FOG.altDescendDelay
      const kUp = 1 - Math.exp(-CFG.FOG.altRiseSpeed * dt)
      lod.fogAlt += fogDiff * kUp
    } else {
      if (lod.fogDelay > 0) {
        lod.fogDelay -= dt
      } else {
        const kDn = 1 - Math.exp(-CFG.FOG.altFallSpeed * dt)
        lod.fogAlt += fogDiff * kDn
      }
    }
  }

  if (!lod.in2D) {
    if (flying && lod.altSmooth > CHANGE_OVERLAY) lod.in2D = true
  } else {
    if (!flying || lod.altSmooth < CHANGE_OVERLAY_BACK) lod.in2D = false
  }

  const targetFade = lod.in2D ? 1 : 0
  const speed = lod.in2D ? CFG.LOD.fadeIn : CFG.LOD.fadeOut
  lod.fade += (targetFade - lod.fade) * Math.min(1, dt * speed)
  if (lod.fade < 0.005) lod.fade = 0
  if (lod.fade > 0.995) lod.fade = 1

  // ─── Ground fade у дальней плоскости ───
  const groundFade =
    1 - smoothstep(CFG.SPACE.groundFadeStart, CFG.SPACE.groundFadeEnd, rocketState.pos.y)
  const farOpacity = lod.fade * groundFade
  const overlayOpacity = getOverlayOpacity()

  if (overlayOpacity !== state.lastOverlayOpacity) {
    for (const c of state.overlayChunks.values()) {
      c.mat.opacity = overlayOpacity
      c.mesh.visible = overlayOpacity > 0.005
    }
    state.lastOverlayOpacity = overlayOpacity
  }

  if (farOpacity !== state.lastFarOpacity) {
    if (state.farGroundMat) state.farGroundMat.opacity = farOpacity
    const farVisible = farOpacity > 0.005
    for (const c of state.farTiles.values()) c.mesh.visible = farVisible
    state.lastFarOpacity = farOpacity
  }

  const showFine = lod.fade < 0.95
  if (showFine !== state.lastShowFineChunks) {
    for (const [key, c] of chunks) {
      if (PERSISTENT_CHUNKS.has(key)) continue
      c.mesh.visible = showFine
    }
    state.lastShowFineChunks = showFine
  }

  const want3D = lod.fade < 0.15
  const farFromBoss = rocketState.pos.x > CFG.BOSS.hideDistance
  const bossVisible = want3D && !farFromBoss

  if (want3D !== lod.showing3D || (boss && boss.visible !== bossVisible)) {
    for (const [key, c] of chunks) {
      if (PERSISTENT_CHUNKS.has(key)) continue
      for (const pr of c.props) pr.visible = want3D
    }
    if (boss) boss.visible = bossVisible
    lod.showing3D = want3D
  }

  // ─── 3D-туман ───
  const FOG_3D_NEAR = CFG.FOG.near3D
  const FOG_3D_FAR = CFG.FOG.far3D
  const FOG_2D_NEAR = CFG.FOG.near2D
  const FOG_2D_FAR = CFG.FOG.far2D

  let dNear3D = FOG_3D_NEAR
  let dFar3D = FOG_3D_FAR
  if (CFG.FOG.dynamicByAltitude) {
    const F = CFG.FOG
    const t = Math.min(1, Math.max(0, lod.fogAlt / F.altRef3D))
    dNear3D = F.nearGround + (FOG_3D_NEAR - F.nearGround) * t
    dFar3D = F.farGround + (FOG_3D_FAR - F.farGround) * t
  }

  // ─── 2D-туман ───
  let dNear2D = FOG_2D_NEAR
  let dFar2D = FOG_2D_FAR
  if (CFG.FOG.dynamicByAltitude) {
    const F = CFG.FOG
    const span = Math.max(1, F.altRef2D - CFG.LOD.changeAltitude)
    const t = Math.min(1, Math.max(0, (lod.altSmooth - CFG.LOD.changeAltitude) / span))
    dNear2D = F.nearGround2D + (FOG_2D_NEAR - F.nearGround2D) * t
    dFar2D = F.farGround2D + (FOG_2D_FAR - F.farGround2D) * t
  }

  scene.fog.near = dNear3D + (dNear2D - dNear3D) * lod.fade
  scene.fog.far = dFar3D + (dFar2D - dFar3D) * lod.fade
}
EOF

# ============================================================
# 5. index.js — публичный API модуля LOD
# ============================================================
cat > scripts/views/lod/index.js <<'EOF'
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

  if (modeChanged || fxi !== _lastFar.x || fzi !== _lastFar.z) {
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
  return {
    farTiles: state.farTiles.size,
    overlayChunks: state.overlayChunks.size,
    pendingFar: state.pendingFarTiles.size,
    pendingOverlays: state.pendingOverlays.size,
  }
}
EOF

# ============================================================
# 6. Удаляем старый lod.js
# ============================================================
rm scripts/lod.js

# ============================================================
# 7. Обновляем импорт в main.js
# ============================================================
sed -i "s|from './lod.js'|from './views/lod/index.js'|g" scripts/main.js

# ============================================================
# 8. Проверка
# ============================================================
echo ""
echo "=== views/lod/ ==="
ls -la scripts/views/lod/

echo ""
echo "=== Старые импорты lod.js? ==="
if grep -rn "from './lod.js'\|from '../lod.js'" scripts/ 2>/dev/null; then
  echo "❌ НАЙДЕНЫ старые импорты"
else
  echo "✅ Нет старых импортов"
fi

echo ""
echo "=== scripts/lod.js удалён? ==="
if [ -f scripts/lod.js ]; then echo "❌ ещё существует"; else echo "✅ удалён"; fi