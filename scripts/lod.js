/* ================================================================
   lod.js — дальний план:
     1) FAR_TILES  — грубая земля в 2D-режиме,
     2) OVERLAY    — точечные деревья поверх far-тайлов,
     3) LOD-fade   — плавный переход 3D ⇄ 2D по высоте,
     4) эллиптический туман (обновление uniform-ов).
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'
import { scene, camera, groundTex, applySkyFog, fogU } from './scene.js'
import { lod, rocketState } from './state.js'
import { boss } from './entities.js'
import { CHUNK_SIZE, chunks, PERSISTENT_CHUNKS } from './chunks.js'
import LodWorker from './workers/lodWorker.js?worker'

/* ================================================================
   FAR TILES & OVERLAY — асинхронная загрузка через Web Worker
================================================================ */
const FAR_TILE_SIZE = CFG.FAR_TILES.size
const OVERLAY_SIZE = CFG.OVERLAY.size
const OVERLAY_SEG = CFG.OVERLAY.segments
const OVERLAY_CANVAS = CFG.OVERLAY.canvasSize
const OVERLAY_LOAD_R = CFG.OVERLAY.loadRadius
const OVERLAY_UNLOAD_R = CFG.OVERLAY.unloadRadius

let farTileSeg = CFG.FAR_TILES.segments // мутабельно (low/high режимы)
let farHighMode = false // true → высокий режим
let farGroundMat = null
let lodWorker = null

const farTiles = new Map()
const pendingFarTiles = new Set()
const overlayChunks = new Map()
const pendingOverlays = new Set()

export function init() {
  farGroundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  applySkyFog(farGroundMat)

  // Создаём воркер для LOD
  lodWorker = new LodWorker()
  lodWorker.onmessage = onWorkerMessage
  lodWorker.onerror = (err) => console.error('[lodWorker] error:', err)
}

/* ---------- Обработка ответов от воркера ---------- */
function onWorkerMessage(e) {
  const data = e.data

  if (data.type === 'far') {
    const { fx, fz, seg, posArr, uvArr, nrmArr, colArr } = data
    const key = fx + ',' + fz

    // Если мы отменили этот запрос (улетели) — просто выбрасываем результат
    if (!pendingFarTiles.has(key)) return
    pendingFarTiles.delete(key)

    // Если разрешение не совпадает с текущим режимом (устарело), тоже выбрасываем
    if (seg !== farTileSeg) return

    const geo = new THREE.PlaneGeometry(FAR_TILE_SIZE, FAR_TILE_SIZE, seg, seg)
    geo.rotateX(-Math.PI / 2)
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2))
    geo.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))

    finalizeFarTile(key, fx, fz, geo, seg)
  } else if (data.type === 'overlay') {
    const { ox, oz, posArr, nrmArr, pix } = data
    const key = ox + ',' + oz

    if (!pendingOverlays.has(key)) return
    pendingOverlays.delete(key)

    if (farHighMode || !CFG.OVERLAY.enabled) return

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
}

/* ---------- Запросы к воркеру ---------- */
function requestFarTile(fx, fz) {
  const key = fx + ',' + fz
  if (farTiles.has(key) || pendingFarTiles.has(key)) return
  pendingFarTiles.add(key)
  lodWorker.postMessage({ type: 'far', fx, fz, seg: farTileSeg })
}

function requestOverlay(ox, oz) {
  const key = ox + ',' + oz
  if (overlayChunks.has(key) || pendingOverlays.has(key)) return
  pendingOverlays.add(key)
  lodWorker.postMessage({ type: 'overlay', ox, oz })
}

/* ---------- Финализация (добавление в сцену) ---------- */
function finalizeFarTile(key, fx, fz, geo, seg) {
  const old = farTiles.get(key)
  if (old) {
    scene.remove(old.mesh)
    old.geo.dispose()
  }
  const mesh = new THREE.Mesh(geo, farGroundMat)
  mesh.position.set(
    fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2,
    0,
    fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  )
  mesh.receiveShadow = false
  mesh.visible = lod.fade > 0.005
  scene.add(mesh)
  farTiles.set(key, { mesh, geo, seg })
}

function finalizeOverlayChunk(key, ox, oz, geo, canvas) {
  const old = overlayChunks.get(key)
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
  mesh.position.set(ox * OVERLAY_SIZE + OVERLAY_SIZE / 2, 0, oz * OVERLAY_SIZE + OVERLAY_SIZE / 2)
  mesh.renderOrder = 2

  const op = getOverlayOpacity()
  mesh.material.opacity = op
  mesh.visible = op > 0.005

  // Инвалидируем кэш, чтобы следующий кадр точно применил прозрачность
  _lastOverlayOpacity = NaN
  scene.add(mesh)
  overlayChunks.set(key, { mesh, mat, tex, geo })
}

function unloadFarTile(key) {
  pendingFarTiles.delete(key) // Отменяем запрос, если он еще висел
  const c = farTiles.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.geo.dispose()
  farTiles.delete(key)
}

function unloadOverlayChunk(key) {
  const c = overlayChunks.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.geo.dispose()
  c.tex.dispose()
  c.mat.dispose()
  overlayChunks.delete(key)
}

/* ---------- Границы и режимы ---------- */
function getFarLoadBounds() {
  if (farHighMode) {
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

function updateFarMode(altSmooth) {
  const F = CFG.FAR_TILES
  let next = farHighMode
  if (!farHighMode && altSmooth > F.altitudeHigh) next = true
  else if (farHighMode && altSmooth < F.altitudeLow) next = false

  if (next === farHighMode) return false
  farHighMode = next
  farTileSeg = farHighMode ? F.segmentsHigh : F.segments
  return true
}

export function refillFarTiles(camX, camZ) {
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)
  const L = getFarLoadBounds()
  const U = getFarUnloadBounds()

  // Запрос новых тайлов (или обновление старых)
  for (let dx = -L.back; dx <= L.fwd; dx++) {
    for (let dz = -L.side; dz <= L.side; dz++) {
      const fx = fxi + dx
      const fz = fzi + dz
      const key = fx + ',' + fz
      const loaded = farTiles.get(key)
      const pending = pendingFarTiles.has(key)

      // Если тайл загружен, но с меньшим seg (нужно обновить при спуске) —
      // НЕ удаляем его! Просто запрашиваем новый. Старый останется на экране.
      if (loaded && loaded.seg < farTileSeg) {
        if (!pending) {
          pendingFarTiles.add(key)
          lodWorker.postMessage({ type: 'far', fx, fz, seg: farTileSeg })
        }
        continue
      }

      // Если тайла нет вообще — запрашиваем
      if (!loaded && !pending) {
        pendingFarTiles.add(key)
        lodWorker.postMessage({ type: 'far', fx, fz, seg: farTileSeg })
      }
    }
  }

  // Очищаем "улетевшие" pending-запросы (чтобы воркер не тратил на них время)
  for (const key of pendingFarTiles) {
    const [fxs, fzs] = key.split(',')
    const fx = +fxs
    const fz = +fzs
    if (fx - fxi > U.fwd || fxi - fx > U.back || Math.abs(fz - fzi) > U.side) {
      pendingFarTiles.delete(key)
    }
  }

  // Выгрузка только тех тайлов, которые реально далеко ушли за границы
  const toUnload = []
  for (const key of farTiles.keys()) {
    const [fxs, fzs] = key.split(',')
    const fx = +fxs
    const fz = +fzs
    if (fx - fxi > U.fwd || fxi - fx > U.back || Math.abs(fz - fzi) > U.side) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadFarTile(k)
}

export function refillOverlayChunks(camX, camZ) {
  if (!CFG.OVERLAY.enabled || farHighMode) {
    for (const key of [...overlayChunks.keys()]) unloadOverlayChunk(key)
    pendingOverlays.clear() // Отменяем все запросы, если ушли в 2D
    return
  }

  const oxi = Math.floor(camX / OVERLAY_SIZE)
  const ozi = Math.floor(camZ / OVERLAY_SIZE)

  for (let dx = -OVERLAY_LOAD_R; dx <= OVERLAY_LOAD_R; dx++) {
    for (let dz = -OVERLAY_LOAD_R; dz <= OVERLAY_LOAD_R; dz++) {
      const ox = oxi + dx
      const oz = ozi + dz
      const key = ox + ',' + oz

      if (!overlayChunks.has(key) && !pendingOverlays.has(key)) {
        pendingOverlays.add(key)
        lodWorker.postMessage({ type: 'overlay', ox, oz })
      }
    }
  }

  // Отменяем улетевшие pending-запросы
  for (const key of pendingOverlays) {
    const [oxs, ozs] = key.split(',')
    if (Math.abs(+oxs - oxi) > OVERLAY_UNLOAD_R || Math.abs(+ozs - ozi) > OVERLAY_UNLOAD_R) {
      pendingOverlays.delete(key)
    }
  }

  // Выгрузка
  const toUnload = []
  for (const key of overlayChunks.keys()) {
    const [oxs, ozs] = key.split(',')
    if (Math.abs(+oxs - oxi) > OVERLAY_UNLOAD_R || Math.abs(+ozs - ozi) > OVERLAY_UNLOAD_R) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadOverlayChunk(k)
}

/* ================================================================
   FOG & LOD UPDATE
================================================================ */
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

function smoothstep(a, b, x) {
  if (x <= a) return 0
  if (x >= b) return 1
  const t = (x - a) / (b - a)
  return t * t * (3 - 2 * t)
}

function getOverlayOpacity() {
  const groundFade =
    1 - smoothstep(CFG.SPACE.groundFadeStart, CFG.SPACE.groundFadeEnd, rocketState.pos.y)
  return farHighMode ? 0 : lod.fade * groundFade
}

const FOG_3D_NEAR = CFG.FOG.near3D
const FOG_3D_FAR = CFG.FOG.far3D
const FOG_2D_NEAR = CFG.FOG.near2D
const FOG_2D_FAR = CFG.FOG.far2D

let _lastOverlayOpacity = -1
let _lastFarOpacity = -1
let _lastShowFineChunks = null

function updateLOD(dt) {
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

  if (overlayOpacity !== _lastOverlayOpacity) {
    for (const c of overlayChunks.values()) {
      c.mat.opacity = overlayOpacity
      c.mesh.visible = overlayOpacity > 0.005
    }
    _lastOverlayOpacity = overlayOpacity
  }

  if (farOpacity !== _lastFarOpacity) {
    farGroundMat.opacity = farOpacity
    const farVisible = farOpacity > 0.005
    for (const c of farTiles.values()) c.mesh.visible = farVisible
    _lastFarOpacity = farOpacity
  }

  const showFine = lod.fade < 0.95
  if (showFine !== _lastShowFineChunks) {
    for (const [key, c] of chunks) {
      if (PERSISTENT_CHUNKS.has(key)) continue
      c.mesh.visible = showFine
    }
    _lastShowFineChunks = showFine
  }

  const want3D = lod.fade < 0.15
  const farFromBoss = rocketState.pos.x > CFG.BOSS.hideDistance
  const bossVisible = want3D && !farFromBoss

  if (want3D !== lod.showing3D || boss.visible !== bossVisible) {
    for (const [key, c] of chunks) {
      if (PERSISTENT_CHUNKS.has(key)) continue
      for (const pr of c.props) pr.visible = want3D
    }
    if (boss) boss.visible = bossVisible
    lod.showing3D = want3D
  }

  // ─── 3D-туман ───
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

// Локальный доступ к фазе без импорта game.js (избегаем циклов)
let _getPhase = () => 'ready'
export function setPhaseGetter(fn) {
  _getPhase = fn
}
const G_PHASE = () => _getPhase()

// Временный импорт для updateLOD (чтобы не тянуть game.js)
import { terrainHeight } from './world/world.js'

/* ================================================================
   update — точка входа per-frame.
================================================================ */
let _lastFar = { x: NaN, z: NaN }
let _lastOverlay = { x: NaN, z: NaN }

export function update(dt) {
  const camX = camera.position.x
  const camZ = camera.position.z

  updateFogEllipse(dt)
  updateLOD(dt)

  // ─── Полный космос: нижний мир уже погашен (groundFade=0). ───
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
   loadInitialFar — ждём, пока воркеры сгенерируют стартовые тайлы
================================================================ */
export async function loadInitialFar(onStep) {
  refillFarTiles(camera.position.x, camera.position.z)
  let done = 0
  onStep(0)

  while (pendingFarTiles.size > 0 || farTiles.size === 0) {
    await new Promise((r) => setTimeout(r, 50))
    done = farTiles.size
    onStep(done)
  }
  return done
}

/* ================================================================
   countInitialFar — общий объём для прогресс-бара
================================================================ */
export function countInitialFar() {
  refillFarTiles(camera.position.x, camera.position.z)
  return pendingFarTiles.size + farTiles.size
}

/* ================================================================
   Debug
================================================================ */
export function getStats() {
  return {
    farTiles: farTiles.size,
    overlayChunks: overlayChunks.size,
    pendingFar: pendingFarTiles.size,
    pendingOverlays: pendingOverlays.size,
  }
}
