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
import { CHUNK_SIZE, chunks, PERSISTENT_CHUNKS, computeChunkProps } from './chunks.js'
import { terrainHeight, heightToTerrainColor, hash2i } from './world/world.js'

/* ================================================================
   FAR TILES
================================================================ */
const FAR_TILE_SIZE = CFG.FAR_TILES.size
const FAR_TILE_SEG = CFG.FAR_TILES.segments
const FAR_LOAD_R = CFG.FAR_TILES.loadRadius
const FAR_UNLOAD_R = CFG.FAR_TILES.unloadRadius

const TILE = CFG.GROUND_TEX.tile

let farGroundMat = null

export function init() {
  farGroundMat = new THREE.MeshStandardMaterial({
    map: groundTex, // к этому моменту scene.init() уже отработал
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0,
  })
  applySkyFog(farGroundMat)
}

const farTiles = new Map()
const pendingFarTiles = new Map()

function createFarTileBuilder(fx, fz) {
  const geo = new THREE.PlaneGeometry(FAR_TILE_SIZE, FAR_TILE_SIZE, FAR_TILE_SEG, FAR_TILE_SEG)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const nrm = geo.attributes.normal
  const colArr = new Float32Array(pos.count * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))

  const cxw = fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  const czw = fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  const col = new THREE.Color()

  const eps = FAR_TILE_SIZE / FAR_TILE_SEG
  const vertsPerRow = FAR_TILE_SEG + 1
  const totalRows = FAR_TILE_SEG + 1
  let row = 0

  return {
    geo,
    step(budgetMs) {
      const t0 = performance.now()
      while (row < totalRows && performance.now() - t0 < budgetMs) {
        const start = row * vertsPerRow
        const end = start + vertsPerRow
        for (let i = start; i < end; i++) {
          const wx = cxw + pos.getX(i)
          const wz = czw + pos.getZ(i)
          const h = terrainHeight(wx, wz)
          const hx = terrainHeight(wx + eps, wz)
          const hz = terrainHeight(wx, wz + eps)
          pos.setY(i, h)
          uv.setXY(i, wx / TILE, wz / TILE)
          const nx = -(hx - h) / eps
          const nz = -(hz - h) / eps
          const len = Math.hypot(nx, 1, nz)
          nrm.setXYZ(i, nx / len, 1 / len, nz / len)
          heightToTerrainColor(h, col)
          colArr[i * 3] = col.r
          colArr[i * 3 + 1] = col.g
          colArr[i * 3 + 2] = col.b
        }
        row++
      }
      if (row >= totalRows) {
        pos.needsUpdate = true
        uv.needsUpdate = true
        nrm.needsUpdate = true
        geo.attributes.color.needsUpdate = true
        return true
      }
      return false
    },
  }
}

function finalizeFarTile(key, fx, fz, geo) {
  const mesh = new THREE.Mesh(geo, farGroundMat)
  mesh.position.set(
    fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2,
    0,
    fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  )
  mesh.receiveShadow = false
  mesh.visible = lod.fade > 0.005
  scene.add(mesh)
  farTiles.set(key, { mesh, geo })
}

function unloadFarTile(key) {
  const c = farTiles.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.geo.dispose()
  farTiles.delete(key)
}

export function refillFarTiles(camX, camZ) {
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)

  for (let dx = -FAR_LOAD_R; dx <= FAR_LOAD_R; dx++) {
    for (let dz = -FAR_LOAD_R; dz <= FAR_LOAD_R; dz++) {
      const fx = fxi + dx,
        fz = fzi + dz
      const key = fx + ',' + fz
      if (farTiles.has(key) || pendingFarTiles.has(key)) continue
      pendingFarTiles.set(key, { fx, fz, builder: createFarTileBuilder(fx, fz) })
    }
  }

  for (const [key, p] of pendingFarTiles) {
    if (Math.abs(p.fx - fxi) > FAR_UNLOAD_R || Math.abs(p.fz - fzi) > FAR_UNLOAD_R) {
      p.builder.geo.dispose()
      pendingFarTiles.delete(key)
    }
  }

  const toUnload = []
  for (const key of farTiles.keys()) {
    const [fxs, fzs] = key.split(',')
    if (Math.abs(+fxs - fxi) > FAR_UNLOAD_R || Math.abs(+fzs - fzi) > FAR_UNLOAD_R) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadFarTile(k)
}

export function processFarTiles() {
  if (pendingFarTiles.size === 0) return
  const BUDGET_MS = 3
  const t0 = performance.now()
  for (const [key, p] of pendingFarTiles) {
    const elapsed = performance.now() - t0
    if (elapsed >= BUDGET_MS) break
    if (p.builder.step(BUDGET_MS - elapsed)) {
      finalizeFarTile(key, p.fx, p.fz, p.builder.geo)
      pendingFarTiles.delete(key)
    }
  }
}

/* ================================================================
   OVERLAY CHUNKS — точечные деревья
================================================================ */
const OVERLAY_SIZE = CFG.OVERLAY.size
const OVERLAY_SEG = CFG.OVERLAY.segments
const OVERLAY_CANVAS = CFG.OVERLAY.canvasSize
const OVERLAY_LOAD_R = CFG.OVERLAY.loadRadius
const OVERLAY_UNLOAD_R = CFG.OVERLAY.unloadRadius

const overlayChunks = new Map()
const pendingOverlays = new Map()

/* ---------- Хелперы рисования точек ---------- */
function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
}

function makeDiscOffsets(sizePx) {
  const R = (sizePx - 1) / 2
  const offsets = []
  const R2 = R * R + 0.25
  const Ri = Math.ceil(R)
  for (let dy = -Ri; dy <= Ri; dy++) {
    for (let dx = -Ri; dx <= Ri; dx++) {
      if (dx * dx + dy * dy <= R2) offsets.push([dx, dy])
    }
  }
  return offsets
}

function plotPoint(pix, W, H, cx, cy, offsets, r, g, b, a, merge) {
  const sa = a / 255
  if (sa <= 0) return

  for (let i = 0; i < offsets.length; i++) {
    const x = cx + offsets[i][0]
    const y = cy + offsets[i][1]
    if (x < 0 || x >= W || y < 0 || y >= H) continue

    const i4 = (y * W + x) * 4

    if (merge) {
      const da = pix[i4 + 3] / 255
      const inv = 1 - sa
      const outA = sa + da * inv
      if (outA <= 0) continue
      const k = 1 / outA

      pix[i4] = (r * sa + pix[i4] * da * inv) * k
      pix[i4 + 1] = (g * sa + pix[i4 + 1] * da * inv) * k
      pix[i4 + 2] = (b * sa + pix[i4 + 2] * da * inv) * k
      pix[i4 + 3] = outA * 255
    } else {
      const curA = pix[i4 + 3]
      if (a > curA) {
        pix[i4] = r
        pix[i4 + 1] = g
        pix[i4 + 2] = b
        pix[i4 + 3] = a
      }
    }
  }
}

function createOverlayBuilder(ox, oz) {
  const geo = new THREE.PlaneGeometry(OVERLAY_SIZE, OVERLAY_SIZE, OVERLAY_SEG, OVERLAY_SEG)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position

  const cxw = ox * OVERLAY_SIZE + OVERLAY_SIZE / 2
  const czw = oz * OVERLAY_SIZE + OVERLAY_SIZE / 2
  const vertsPerRow = OVERLAY_SEG + 1
  const totalGeoRows = OVERLAY_SEG + 1

  const W = OVERLAY_CANVAS
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = W
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, W)

  const imgData = ctx.createImageData(W, W)
  const pix = imgData.data

  const pxPerM = W / OVERLAY_SIZE
  const chunksPerSide = Math.round(OVERLAY_SIZE / CHUNK_SIZE)
  const totalChunkCells = chunksPerSide * chunksPerSide

  const baseX = ox * OVERLAY_SIZE
  const baseZ = oz * OVERLAY_SIZE

  const O = CFG.OVERLAY
  const PINE_RGB = hexToRgb(O.colors.pine)
  const OAK_RGB = hexToRgb(O.colors.oak)
  const DISC = makeDiscOffsets(O.pointSize)
  const JIT = O.colorJitter
  const MERGE = O.mergeAlpha
  const BASE_ALPHA = O.pointAlpha * 255
  const ALPHA_JIT = O.alphaJitter

  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

  let phase = 0
  let row = 0

  return {
    geo,
    canvas,
    step(budgetMs) {
      const t0 = performance.now()

      if (phase === 0) {
        while (row < totalGeoRows && performance.now() - t0 < budgetMs) {
          const start = row * vertsPerRow
          const end = start + vertsPerRow
          for (let i = start; i < end; i++) {
            const wx = cxw + pos.getX(i)
            const wz = czw + pos.getZ(i)
            pos.setY(i, terrainHeight(wx, wz))
          }
          row++
        }
        if (row >= totalGeoRows) {
          pos.needsUpdate = true
          geo.computeVertexNormals()
          phase = 1
          row = 0
        }
      }

      if (phase === 1) {
        const c0x = Math.floor(baseX / CHUNK_SIZE)
        const c0z = Math.floor(baseZ / CHUNK_SIZE)

        while (row < totalChunkCells && performance.now() - t0 < budgetMs) {
          const cx = c0x + (row % chunksPerSide)
          const cz = c0z + Math.floor(row / chunksPerSide)
          const items = computeChunkProps(cx, cz)

          for (let k = 0; k < items.length; k++) {
            const it = items[k]
            if (it.kind !== 'pine' && it.kind !== 'oak') continue

            const px = ((it.x - baseX) * pxPerM) | 0
            const py = ((it.z - baseZ) * pxPerM) | 0
            if (px < -3 || px >= W + 3 || py < -3 || py >= H_WRAP) continue

            const h = hash2i((it.x * 10) | 0, (it.z * 10) | 0)
            const rnd01 = (h & 1023) / 1023
            const factor = 1 + (rnd01 * 2 - 1) * JIT

            const base = it.kind === 'pine' ? PINE_RGB : OAK_RGB
            const cr = clamp255(base[0] * factor) | 0
            const cg = clamp255(base[1] * factor) | 0
            const cb = clamp255(base[2] * factor) | 0

            const rnd02 = ((h >>> 10) & 1023) / 1023
            const aFactor = 1 + (rnd02 * 2 - 1) * ALPHA_JIT
            const ca = clamp255(BASE_ALPHA * aFactor) | 0

            plotPoint(pix, W, W, px, py, DISC, cr, cg, cb, ca, MERGE)
          }
          row++
        }

        if (row >= totalChunkCells) {
          ctx.putImageData(imgData, 0, 0)
          return true
        }
      }

      return false
    },
  }
}
// локальный алиас — W из builder не виден в замыкании выше
const H_WRAP = OVERLAY_CANVAS

function finalizeOverlayChunk(key, ox, oz, builder) {
  const tex = new THREE.CanvasTexture(builder.canvas)
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

  const mesh = new THREE.Mesh(builder.geo, mat)
  mesh.position.set(ox * OVERLAY_SIZE + OVERLAY_SIZE / 2, 0, oz * OVERLAY_SIZE + OVERLAY_SIZE / 2)
  mesh.renderOrder = 2
  mesh.material.opacity = lod.fade
  mesh.visible = lod.fade > 0.005
  scene.add(mesh)

  overlayChunks.set(key, { mesh, mat, tex, geo: builder.geo })
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

export function refillOverlayChunks(camX, camZ) {
  if (!CFG.OVERLAY.enabled) {
    if (overlayChunks.size > 0) {
      for (const key of [...overlayChunks.keys()]) unloadOverlayChunk(key)
    }
    if (pendingOverlays.size > 0) {
      for (const [, p] of pendingOverlays) p.builder.geo.dispose()
      pendingOverlays.clear()
    }
    return
  }

  const oxi = Math.floor(camX / OVERLAY_SIZE)
  const ozi = Math.floor(camZ / OVERLAY_SIZE)

  for (let dx = -OVERLAY_LOAD_R; dx <= OVERLAY_LOAD_R; dx++) {
    for (let dz = -OVERLAY_LOAD_R; dz <= OVERLAY_LOAD_R; dz++) {
      const ox = oxi + dx,
        oz = ozi + dz
      const key = ox + ',' + oz
      if (overlayChunks.has(key) || pendingOverlays.has(key)) continue
      pendingOverlays.set(key, { ox, oz, builder: createOverlayBuilder(ox, oz) })
    }
  }

  for (const [key, p] of pendingOverlays) {
    if (Math.abs(p.ox - oxi) > OVERLAY_UNLOAD_R || Math.abs(p.oz - ozi) > OVERLAY_UNLOAD_R) {
      p.builder.geo.dispose()
      pendingOverlays.delete(key)
    }
  }

  const toUnload = []
  for (const key of overlayChunks.keys()) {
    const [oxs, ozs] = key.split(',')
    if (Math.abs(+oxs - oxi) > OVERLAY_UNLOAD_R || Math.abs(+ozs - ozi) > OVERLAY_UNLOAD_R) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadOverlayChunk(k)
}

export function processOverlayChunks() {
  if (pendingOverlays.size === 0) return
  const BUDGET_MS = 3
  const t0 = performance.now()
  for (const [key, p] of pendingOverlays) {
    const elapsed = performance.now() - t0
    if (elapsed >= BUDGET_MS) break
    if (p.builder.step(BUDGET_MS - elapsed)) {
      finalizeOverlayChunk(key, p.ox, p.oz, p.builder)
      pendingOverlays.delete(key)
    }
  }
}

/* ================================================================
   updateFogEllipse — центр и направление эллипса тумана.
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

/* ================================================================
   updateLOD — определение 2D/3D режима, fade, видимости,
   динамический туман по высоте.
================================================================ */
const FOG_3D_NEAR = CFG.FOG.near3D
const FOG_3D_FAR = CFG.FOG.far3D
const FOG_2D_NEAR = CFG.FOG.near2D
const FOG_2D_FAR = CFG.FOG.far2D

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
    lod.altInit = true
  } else {
    const k = 1 - Math.exp(-4.0 * dt)
    lod.altSmooth += (alt - lod.altSmooth) * k
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

  for (const c of overlayChunks.values()) {
    c.mat.opacity = lod.fade
    c.mesh.visible = lod.fade > 0.005
  }

  farGroundMat.opacity = lod.fade
  const farVisible = lod.fade > 0.005
  for (const c of farTiles.values()) c.mesh.visible = farVisible

  const showFine = lod.fade < 0.95
  for (const [key, c] of chunks) {
    if (PERSISTENT_CHUNKS.has(key)) continue
    c.mesh.visible = showFine
  }

  const want3D = lod.fade < 0.15
  if (want3D !== lod.showing3D) {
    for (const [key, c] of chunks) {
      if (PERSISTENT_CHUNKS.has(key)) continue
      for (const pr of c.props) pr.visible = want3D
    }
    if (boss) boss.visible = want3D
    lod.showing3D = want3D
  }

  // динамический туман по высоте
  let dNear = FOG_3D_NEAR
  let dFar = FOG_3D_FAR
  if (CFG.FOG.dynamicByAltitude) {
    const F = CFG.FOG
    const t = Math.min(1, Math.max(0, lod.altSmooth / F.altRef))
    dNear = F.nearGround + (FOG_3D_NEAR - F.nearGround) * t
    dFar = F.farGround + (FOG_3D_FAR - F.farGround) * t
  }

  scene.fog.near = dNear + (FOG_2D_NEAR - dNear) * lod.fade
  scene.fog.far = dFar + (FOG_2D_FAR - dFar) * lod.fade
}

// Локальный доступ к фазе без импорта game.js (избегаем циклов)
let _getPhase = () => 'ready'
export function setPhaseGetter(fn) {
  _getPhase = fn
}
const G_PHASE = () => _getPhase()

/* ================================================================
   update — точка входа per-frame.
================================================================ */
let _lastFar = { x: NaN, z: NaN }
let _lastOverlay = { x: NaN, z: NaN }

export function update(dt) {
  const camX = camera.position.x
  const camZ = camera.position.z

  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)
  if (fxi !== _lastFar.x || fzi !== _lastFar.z) {
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

  processFarTiles()
  processOverlayChunks()

  updateFogEllipse(dt)
  updateLOD(dt)
}

/* ================================================================
   loadInitialFar / loadInitialOverlays — порционная загрузка.
================================================================ */
export async function loadInitialFar(onStep) {
  refillFarTiles(camera.position.x, camera.position.z)
  let done = 0
  onStep(done)

  const BUDGET_MS = 12
  while (pendingFarTiles.size > 0) {
    const t0 = performance.now()
    for (const [key, p] of pendingFarTiles) {
      if (p.builder.step(4)) {
        finalizeFarTile(key, p.fx, p.fz, p.builder.geo)
        pendingFarTiles.delete(key)
        done++
      }
      if (performance.now() - t0 >= BUDGET_MS) break
    }
    onStep(done)
    await new Promise((r) => requestAnimationFrame(r))
  }
  return done
}

export async function loadInitialOverlays(onStep) {
  refillOverlayChunks(camera.position.x, camera.position.z)
  let done = 0
  onStep(done)

  const BUDGET_MS = 12
  while (pendingOverlays.size > 0) {
    const t0 = performance.now()
    for (const [key, p] of pendingOverlays) {
      if (p.builder.step(4)) {
        finalizeOverlayChunk(key, p.ox, p.oz, p.builder)
        pendingOverlays.delete(key)
        done++
      }
      if (performance.now() - t0 >= BUDGET_MS) break
    }
    onStep(done)
    await new Promise((r) => requestAnimationFrame(r))
  }
  return done
}

/* ================================================================
   countInitialFar / countInitialOverlays — общий объём для прогресс-бара.
   Заодно наполняет pending-очереди (refill идемпотентен).
================================================================ */
export function countInitialFar() {
  refillFarTiles(camera.position.x, camera.position.z)
  return pendingFarTiles.size
}

export function countInitialOverlays() {
  refillOverlayChunks(camera.position.x, camera.position.z)
  return pendingOverlays.size
}

/* ---------- Debug ---------- */
export function getStats() {
  return {
    farTiles: farTiles.size,
    overlayChunks: overlayChunks.size,
    pendingFar: pendingFarTiles.size,
    pendingOverlays: pendingOverlays.size,
  }
}
