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
import { CHUNK_SIZE, chunks, PERSISTENT_CHUNKS, getProps } from './chunks.js'
import { terrainHeight, heightToTerrainColor, hash2i } from './world/world.js'

/* ================================================================
   FAR TILES — динамические границы загрузки.

   Есть два режима:
     low  — у земли: асимметрично (fwd 3, back 1, side 2), SEG=180
     high — высоко:  симметрично (6×6×6), SEG=40, оверлай выключен

   Переключение по altSmooth с гистерезисом (altitudeHigh/altitudeLow).
================================================================ */
const FAR_TILE_SIZE = CFG.FAR_TILES.size
const TILE = CFG.GROUND_TEX.tile

let farTileSeg = CFG.FAR_TILES.segments // мутабельно
let farHighMode = false // true → высокий режим

let farGroundMat = null

export function init() {
  farGroundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
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

/** Текущие радиусы загрузки (учитывает farHighMode). */
function getFarLoadBounds() {
  if (farHighMode) {
    const r = CFG.FAR_TILES.loadRadiusHigh
    return { fwd: r, back: r, side: r }
  }
  return {
    fwd: CFG.FAR_TILES.loadFwd,
    back: CFG.FAR_TILES.loadBack,
    side: CFG.FAR_TILES.loadSide,
  }
}

/** Текущие радиусы выгрузки (load + margin, чтобы не мигало). */
function getFarUnloadBounds() {
  const m = CFG.FAR_TILES.unloadMargin
  const L = getFarLoadBounds()
  return { fwd: L.fwd + m, back: L.back + m, side: L.side + m }
}

function createFarTileBuilder(fx, fz) {
  const geo = new THREE.PlaneGeometry(FAR_TILE_SIZE, FAR_TILE_SIZE, farTileSeg, farTileSeg)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const nrm = geo.attributes.normal
  const colArr = new Float32Array(pos.count * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))

  const cxw = fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  const czw = fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  const col = new THREE.Color()

  const vertsPerRow = farTileSeg + 1
  const totalRows = farTileSeg + 1
  const eps = FAR_TILE_SIZE / farTileSeg

  let phase = 0 // 0 = высоты; 1 = нормали
  let row = 0

  return {
    geo,
    step(budgetMs) {
      const t0 = performance.now()

      /* ---------- Фаза 0: высоты, UV, цвета ---------- */
      if (phase === 0) {
        while (row < totalRows && performance.now() - t0 < budgetMs) {
          const start = row * vertsPerRow
          const end = start + vertsPerRow
          for (let i = start; i < end; i++) {
            const wx = cxw + pos.getX(i)
            const wz = czw + pos.getZ(i)
            const h = terrainHeight(wx, wz)
            pos.setY(i, h)
            uv.setXY(i, wx / TILE, wz / TILE)
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
          phase = 1
          row = 0
        }
      }

      /* ---------- Фаза 1: нормали из готовых высот ---------- */
      if (phase === 1) {
        while (row < farTileSeg && performance.now() - t0 < budgetMs) {
          const iz = row
          for (let ix = 0; ix < farTileSeg; ix++) {
            const i00 = iz * vertsPerRow + ix
            const h = pos.getY(i00)
            const hx = pos.getY(i00 + 1)
            const hz = pos.getY(i00 + vertsPerRow)
            const nx = -(hx - h) / eps
            const nz = -(hz - h) / eps
            const len = Math.hypot(nx, 1, nz)
            nrm.setXYZ(i00, nx / len, 1 / len, nz / len)
          }
          row++
        }
        if (row >= farTileSeg) {
          // Крайние ряды/столбцы — через terrainHeight (их мало)
          // Нижняя строка (iz = farTileSeg)
          for (let ix = 0; ix < farTileSeg; ix++) {
            const i00 = farTileSeg * vertsPerRow + ix
            const wx = cxw + pos.getX(i00)
            const wz = czw + pos.getZ(i00)
            const h = pos.getY(i00)
            const hx = pos.getY(i00 + 1)
            const hz = terrainHeight(wx, wz + eps)
            const nx = -(hx - h) / eps
            const nz = -(hz - h) / eps
            const len = Math.hypot(nx, 1, nz)
            nrm.setXYZ(i00, nx / len, 1 / len, nz / len)
          }
          // Правый столбец (ix = farTileSeg), кроме нижнего угла
          for (let iz = 0; iz < farTileSeg; iz++) {
            const i00 = iz * vertsPerRow + farTileSeg
            const wx = cxw + pos.getX(i00)
            const wz = czw + pos.getZ(i00)
            const h = pos.getY(i00)
            const hx = terrainHeight(wx + eps, wz)
            const hz = pos.getY(i00 + vertsPerRow)
            const nx = -(hx - h) / eps
            const nz = -(hz - h) / eps
            const len = Math.hypot(nx, 1, nz)
            nrm.setXYZ(i00, nx / len, 1 / len, nz / len)
          }
          // Правый-нижний угол
          const iC = farTileSeg * vertsPerRow + farTileSeg
          const wxC = cxw + pos.getX(iC)
          const wzC = czw + pos.getZ(iC)
          const hC = pos.getY(iC)
          const hxC = terrainHeight(wxC + eps, wzC)
          const hzC = terrainHeight(wxC, wzC + eps)
          const nxC = -(hxC - hC) / eps
          const nzC = -(hzC - hC) / eps
          const lenC = Math.hypot(nxC, 1, nzC)
          nrm.setXYZ(iC, nxC / lenC, 1 / lenC, nzC / lenC)

          nrm.needsUpdate = true
          geo.attributes.color.needsUpdate = true
          return true
        }
      }

      return false
    },
  }
}

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

function unloadFarTile(key) {
  const c = farTiles.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.geo.dispose()
  farTiles.delete(key)
}

/**
 * Решение о переключении far-режима (high/low) с гистерезисом.
 * Возвращает true, если режим изменился — нужно перезапустить refill.
 */
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

  // --- Пополняем очередь (в границах текущего режима) ---
  for (let dx = -L.back; dx <= L.fwd; dx++) {
    for (let dz = -L.side; dz <= L.side; dz++) {
      const fx = fxi + dx
      const fz = fzi + dz
      const key = fx + ',' + fz

      const loaded = farTiles.get(key)
      const pending = pendingFarTiles.get(key)

      // SEG устарел → пересборка
      if (loaded && loaded.seg !== farTileSeg) {
        pendingFarTiles.set(key, { fx, fz, builder: createFarTileBuilder(fx, fz) })
        continue
      }
      if (loaded || pending) continue

      pendingFarTiles.set(key, { fx, fz, builder: createFarTileBuilder(fx, fz) })
    }
  }

  // --- Отменяем «уехавшие» pending (с учётом margin) ---
  for (const [key, p] of pendingFarTiles) {
    if (p.fx - fxi > U.fwd || fxi - p.fx > U.back || Math.abs(p.fz - fzi) > U.side) {
      p.builder.geo.dispose()
      pendingFarTiles.delete(key)
    }
  }

  // --- Выгрузка (с учётом margin) ---
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
          const items = getProps(cx, cz)

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

/* ================================================================
   processLODWork — единый планировщик дальнего плана.

   Приоритет:
     1) FAR_TILES (ландшафт) — идёт ВСЕГДА первым.
     2) OVERLAY (деревья)   — берёт только остатки времени,
                               либо свой полный бюджет, если
                               ландшафт уже пуст.

   Пока terrain не догнал — overlay фактически «на паузе».
   Это критично при быстром полёте: визуально дырка в земле
   намного хуже, чем отсутствие точек деревьев.
================================================================ */
const BUDGET_TERRAIN_MS = 5
const BUDGET_OVERLAY_MS = 3

export function processLODWork() {
  const t0 = performance.now()

  // --- 1) Ландшафт — всегда в приоритете ---
  if (pendingFarTiles.size > 0) {
    for (const [key, p] of pendingFarTiles) {
      const elapsed = performance.now() - t0
      if (elapsed >= BUDGET_TERRAIN_MS) break
      if (p.builder.step(BUDGET_TERRAIN_MS - elapsed)) {
        finalizeFarTile(key, p.fx, p.fz, p.builder.geo, farTileSeg)
        pendingFarTiles.delete(key)
      }
    }
  }

  // --- 2) Overlay: на высокой высоте вообще не строим ---
  if (farHighMode) return
  if (pendingOverlays.size === 0) return

  const terrainElapsed = performance.now() - t0
  const terrainDone = pendingFarTiles.size === 0
  const overlayBudget = terrainDone
    ? BUDGET_OVERLAY_MS
    : Math.max(0, BUDGET_TERRAIN_MS - terrainElapsed)

  if (overlayBudget < 1) return

  const t1 = performance.now()
  for (const [key, p] of pendingOverlays) {
    const elapsed = performance.now() - t1
    if (elapsed >= overlayBudget) break
    if (p.builder.step(overlayBudget - elapsed)) {
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

// Плавное гашение земли у дальней плоскости (используем CFG.SPACE).
function smoothstep(a, b, x) {
  if (x <= a) return 0
  if (x >= b) return 1
  const t = (x - a) / (b - a)
  return t * t * (3 - 2 * t)
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

  // ─── Ground fade у дальней плоскости ───
  // На высоте ~12–15 км край диска земли попадает в camera.far. Без этого
  // множителя виден резкий круг. Гасим землю ДО того, как она упрётся в far.
  const groundFade =
    1 - smoothstep(CFG.SPACE.groundFadeStart, CFG.SPACE.groundFadeEnd, rocketState.pos.y)
  const farOpacity = lod.fade * groundFade

  // Overlay виден только в 2D-режиме И в низком far-режиме.
  const overlayOpacity = farHighMode ? 0 : farOpacity
  for (const c of overlayChunks.values()) {
    c.mat.opacity = overlayOpacity
    c.mesh.visible = overlayOpacity > 0.005
  }

  farGroundMat.opacity = farOpacity
  const farVisible = farOpacity > 0.005
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

  // ─── 3D-туман (только до 2D-режима) ───
  let dNear3D = FOG_3D_NEAR
  let dFar3D = FOG_3D_FAR
  if (CFG.FOG.dynamicByAltitude) {
    const F = CFG.FOG
    const t = Math.min(1, Math.max(0, lod.altSmooth / F.altRef3D))
    dNear3D = F.nearGround + (FOG_3D_NEAR - F.nearGround) * t
    dFar3D = F.farGround + (FOG_3D_FAR - F.farGround) * t
  }

  // ─── 2D-туман: от (nearGround2D, farGround2D) на высоте
  //     переключения (LOD.changeAltitude) → до (near2D, far2D)
  //     на высоте altRef2D. ───
  let dNear2D = FOG_2D_NEAR
  let dFar2D = FOG_2D_FAR
  if (CFG.FOG.dynamicByAltitude) {
    const F = CFG.FOG
    const span = Math.max(1, F.altRef2D - CFG.LOD.changeAltitude)
    const t = Math.min(1, Math.max(0, (lod.altSmooth - CFG.LOD.changeAltitude) / span))
    dNear2D = F.nearGround2D + (FOG_2D_NEAR - F.nearGround2D) * t
    dFar2D = F.farGround2D + (FOG_2D_FAR - F.farGround2D) * t
  }

  // ─── Смешение по fade: 0 = чистый 3D, 1 = чистый 2D ───
  scene.fog.near = dNear3D + (dNear2D - dNear3D) * lod.fade
  scene.fog.far = dFar3D + (dFar2D - dFar3D) * lod.fade
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

  updateFogEllipse(dt)
  updateLOD(dt) // обновляет lod.altSmooth, lod.fade, видимости

  const modeChanged = updateFarMode(lod.altSmooth)

  // far-тайлы: смена cell ИЛИ смена режима (low ↔ high)
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)
  if (modeChanged || fxi !== _lastFar.x || fzi !== _lastFar.z) {
    refillFarTiles(camX, camZ)
    _lastFar.x = fxi
    _lastFar.z = fzi
  }

  // overlay-чанки — как было
  const oxi = Math.floor(camX / OVERLAY_SIZE)
  const ozi = Math.floor(camZ / OVERLAY_SIZE)
  if (oxi !== _lastOverlay.x || ozi !== _lastOverlay.z) {
    refillOverlayChunks(camX, camZ)
    _lastOverlay.x = oxi
    _lastOverlay.z = ozi
  }

  processLODWork()
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
        finalizeFarTile(key, p.fx, p.fz, p.builder.geo, farTileSeg)
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
