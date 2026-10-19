/* ================================================================
   chunks.js — 3D-мир: чанки земли + пропсы на них.
   Детальный слой, виден, пока мы «в 3D» (lod.fade < 0.95).
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'
import './settings.js' // side effect: применяет lowSpecMode к CFG.PROPS.density
import { scene, groundMat, SUN_DIR, camera, applySkyFog } from './scene.js'
import { lod } from './state.js'
import { TEMPLATES } from './world/props.js'
import {
  WORLD_SEED,
  hash2i,
  mulberry32,
  terrainHeight,
  heightToTerrainColor,
  terrainBrightnessNoise,
  collectForestSpheres,
  forestDensityFromSpheres,
} from './world/world.js'

/* ---------- Константы из конфига ---------- */
export const CHUNK_SIZE = CFG.CHUNKS.size
const CHUNK_SEG = CFG.CHUNKS.segments
const LOAD_FWD_CHUNKS = CFG.CHUNKS.loadForward
const LOAD_BACK_CHUNKS = CFG.CHUNKS.loadBack
const LOAD_SIDE_CHUNKS = CFG.CHUNKS.loadSide
const UNLOAD_MARGIN = CFG.CHUNKS.unloadMargin
const COUNT = CFG.PROPS.density

/* ---------- Хранилища ---------- */
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

const propsCache = new Map()
const _dummyObj = new THREE.Object3D()

/* ================================================================
   Материал пропсов — один на всех, с vertex colors.
   applySkyFog подключаем в init().
================================================================ */
export const propMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: CFG.PROPS.material.roughness,
  metalness: CFG.PROPS.material.metalness,
  flatShading: false,
})

/* ================================================================
   getProps / collectShadowItems — кэш prop-items на чанк.
================================================================ */
export function getProps(cx, cz) {
  const key = cx + ',' + cz
  let items = propsCache.get(key)
  if (!items) {
    items = computeChunkProps(cx, cz)
    propsCache.set(key, items)
  }
  return items
}

/**
 * Собираем items с halo для запекания теней.
 * Свет с +X/+Z → тень уходит в −X/−Z.
 * Значит деревья из (cx+1,cz), (cx,cz+1), (cx+1,cz+1) могут бросить тень сюда.
 */
function collectShadowItems(cx, cz) {
  return [
    ...getProps(cx, cz),
    ...getProps(cx + 1, cz),
    ...getProps(cx, cz + 1),
    ...getProps(cx + 1, cz + 1),
  ]
}

/* ================================================================
   computeChunkProps — детерминированный список «что где растёт».
================================================================ */
export function computeChunkProps(cx, cz) {
  const seed = hash2i(cx + 0x9e37, cz + 0x79b9) ^ WORLD_SEED
  const rng = mulberry32(seed)

  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE

  const items = []
  const TH = CFG.PROPS.thresholds
  const SC = CFG.PROPS.scales
  const VEG_MAX_H = CFG.PROPS.vegMaxHeight
  const VEG_MIN_H = CFG.PROPS.vegMinHeight

  const SAFE_R = CFG.PROPS.safeRadius
  const SAFE_R2 = SAFE_R * SAFE_R
  const SAFE_TREES_FWD = CFG.PROPS.safeRadiusTrees
  const SAFE_TREES_BACK = SAFE_R
  const SAFE_TREES_SIDE = SAFE_R

  const spheres = collectForestSpheres(cx, cz)

  for (let i = 0; i < COUNT; i++) {
    const wx = baseX + rng() * CHUNK_SIZE
    const wz = baseZ + rng() * CHUNK_SIZE

    const relX = wx + 2.6
    const relZ = wz

    if (relX * relX + relZ * relZ < SAFE_R2) continue

    const r = rng()
    let kind
    if (r < TH.pine) kind = 'pine'
    else if (r < TH.oak) kind = 'oak'
    else if (r < TH.bush) kind = 'bush'
    else kind = 'rock'

    if (kind === 'pine' || kind === 'oak' || kind === 'bush') {
      const aX = relX >= 0 ? SAFE_TREES_FWD : SAFE_TREES_BACK
      const ex = relX / aX
      const ez = relZ / SAFE_TREES_SIDE
      if (ex * ex + ez * ez < 1) continue
    }

    const h = terrainHeight(wx, wz)
    if (kind !== 'rock') {
      const density = forestDensityFromSpheres(wx, wz, spheres)
      if (density <= 0) continue
      if (rng() > density) continue
      if (h > VEG_MAX_H || h < VEG_MIN_H) continue
    } else {
      if (h <= VEG_MAX_H && rng() > CFG.PROPS.rockLowlandFrequency) continue
    }

    const scale =
      kind === 'rock'
        ? SC.rock[0] + (SC.rock[1] - SC.rock[0]) * Math.pow(rng(), CFG.PROPS.rockScaleBias)
        : SC.tree[0] + rng() * (SC.tree[1] - SC.tree[0])
    const rotY = rng() * 6.28

    items.push({ x: wx, z: wz, kind, scale, rotY })
  }
  return items
}

/* ================================================================
   makeChunkMesh — меш земли с аналитическими нормалями,
   vertex colors и запечёнными тенями от деревьев.
================================================================ */
function makeChunkMesh(cx, cz, items) {
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEG, CHUNK_SEG)
  geo.rotateX(-Math.PI / 2)

  const cxw = cx * CHUNK_SIZE + CHUNK_SIZE / 2
  const czw = cz * CHUNK_SIZE + CHUNK_SIZE / 2
  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE

  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const nrm = geo.attributes.normal

  const colArr = new Float32Array(pos.count * 3)
  const col = new THREE.Color()
  const shadowB = new Float32Array(pos.count).fill(1)

  const step = CHUNK_SIZE / CHUNK_SEG
  const VPR = CHUNK_SEG + 1
  const heightGrid = new Float32Array(VPR * VPR)

  /* ---------- Проход 1: высоты, UV, цвета ---------- */
  for (let i = 0; i < pos.count; i++) {
    const wx = cxw + pos.getX(i)
    const wz = czw + pos.getZ(i)
    const h = terrainHeight(wx, wz)

    pos.setY(i, h)

    const gix = Math.round((pos.getX(i) + CHUNK_SIZE / 2) / step)
    const giz = Math.round((pos.getZ(i) + CHUNK_SIZE / 2) / step)
    heightGrid[giz * VPR + gix] = h

    uv.setXY(i, wx / GROUND_TILE_LOCAL, wz / GROUND_TILE_LOCAL)

    heightToTerrainColor(h, col)
    const b = terrainBrightnessNoise(wx, wz)
    colArr[i * 3] = col.r * b
    colArr[i * 3 + 1] = col.g * b
    colArr[i * 3 + 2] = col.b * b
  }

  /* ---------- Проход 2: нормали из готовых высот ---------- */
  for (let i = 0; i < pos.count; i++) {
    const gix = Math.round((pos.getX(i) + CHUNK_SIZE / 2) / step)
    const giz = Math.round((pos.getZ(i) + CHUNK_SIZE / 2) / step)
    const h = heightGrid[giz * VPR + gix]

    // hx/hz — уже посчитанные высоты соседей. Крайние вершины
    // (правый столбец / нижняя строка) — единственные, кто досчитывает
    // вручную через terrainHeight (их ~122 на чанк, не 11k).
    const hx =
      gix < CHUNK_SEG
        ? heightGrid[giz * VPR + gix + 1]
        : terrainHeight(cxw + pos.getX(i) + step, czw + pos.getZ(i))
    const hz =
      giz < CHUNK_SEG
        ? heightGrid[(giz + 1) * VPR + gix]
        : terrainHeight(cxw + pos.getX(i), czw + pos.getZ(i) + step)

    const nx = -(hx - h) / step
    const nz = -(hz - h) / step
    const len = Math.hypot(nx, 1, nz)
    nrm.setXYZ(i, nx / len, 1 / len, nz / len)
  }

  /* ---------- Запекание теней ---------- */
  const shLenXZ = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1
  const shDirX = -SUN_DIR.x / shLenXZ
  const shDirZ = -SUN_DIR.z / shLenXZ

  const shStrength = CFG.PROPS.shadow.strength
  const shScale = CFG.PROPS.shadow.scale
  const shSoft = CFG.PROPS.shadow.softness
  const shDist = CFG.PROPS.shadow.offset

  const treeRadius = (kind) => {
    if (kind === 'pine') return 1.6
    if (kind === 'oak') return 1.8
    if (kind === 'bush') return 0.8
    return 0
  }

  for (let k = 0; k < items.length; k++) {
    const it = items[k]
    const baseR = treeRadius(it.kind)
    if (baseR <= 0) continue

    const R = baseR * it.scale * shScale
    if (R <= 0) continue

    const tOffset = shDist * (0.6 + 0.4 * it.scale)
    const tx = it.x + shDirX * tOffset
    const tz = it.z + shDirZ * tOffset

    const lx = tx - baseX
    const lz = tz - baseZ

    const ix0 = Math.max(0, Math.floor((lx - R) / step))
    const ix1 = Math.min(CHUNK_SEG, Math.ceil((lx + R) / step))
    const iz0 = Math.max(0, Math.floor((lz - R) / step))
    const iz1 = Math.min(CHUNK_SEG, Math.ceil((lz + R) / step))

    const R2 = R * R

    for (let iz = iz0; iz <= iz1; iz++) {
      const vz = iz * step
      const dz = vz - lz
      const dz2 = dz * dz
      const rowBase = iz * VPR

      for (let ix = ix0; ix <= ix1; ix++) {
        const vx = ix * step
        const dx = vx - lx
        const d2 = dx * dx + dz2
        if (d2 > R2) continue

        const t = Math.sqrt(d2) / R
        const w = 1 - Math.pow(t, shSoft)
        const shade = 1 - w * shStrength

        const idx = rowBase + ix
        if (shade < shadowB[idx]) shadowB[idx] = shade
      }
    }
  }

  for (let i = 0; i < pos.count; i++) {
    const s = shadowB[i]
    if (s < 1) {
      colArr[i * 3] *= s
      colArr[i * 3 + 1] *= s
      colArr[i * 3 + 2] *= s
    }
  }

  pos.needsUpdate = true
  uv.needsUpdate = true
  nrm.needsUpdate = true
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))

  const mesh = new THREE.Mesh(geo, groundMat)
  mesh.position.set(cxw, 0, czw)
  mesh.receiveShadow = false

  /* ---------- Билинейный сэмплер высоты ---------- */
  const stepRecip = 1 / step
  mesh.userData.terrainSampler = (x, z) => {
    const gx = (x - baseX) * stepRecip
    const gz = (z - baseZ) * stepRecip

    let ix = Math.floor(gx),
      iz = Math.floor(gz)
    let fx = gx - ix,
      fz = gz - iz

    if (ix < 0) {
      ix = 0
      fx = 0
    } else if (ix > VPR - 2) {
      ix = VPR - 2
      fx = 1
    }
    if (iz < 0) {
      iz = 0
      fz = 0
    } else if (iz > VPR - 2) {
      iz = VPR - 2
      fz = 1
    }

    const i00 = iz * VPR + ix
    const i10 = i00 + 1
    const i01 = i00 + VPR
    const i11 = i01 + 1

    return (
      heightGrid[i00] * (1 - fx) * (1 - fz) +
      heightGrid[i10] * fx * (1 - fz) +
      heightGrid[i01] * (1 - fx) * fz +
      heightGrid[i11] * fx * fz
    )
  }

  return mesh
}

// локальная константа, чтобы не импортировать GROUND_TILE сюда отдельно
const GROUND_TILE_LOCAL = CFG.GROUND_TEX.tile

/* ================================================================
   spawnChunkProps — InstancedMesh-ы пропсов и их тени.
================================================================ */
function spawnChunkProps(cx, cz, items, sampleH) {
  const groups = { pine: [], oak: [], bush: [], rock: [] }
  for (const it of items) {
    groups[it.kind].push({
      x: it.x,
      y: sampleH(it.x, it.z),
      z: it.z,
      scale: it.scale,
      rotY: it.rotY,
    })
  }

  const meshes = []
  for (const kind of ['pine', 'oak', 'bush', 'rock']) {
    const list = groups[kind]
    if (list.length === 0) continue

    const inst = new THREE.InstancedMesh(TEMPLATES[kind], propMat, list.length)
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    inst.castShadow = false
    inst.receiveShadow = false
    inst.frustumCulled = true

    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      _dummyObj.position.set(it.x, it.y, it.z)
      _dummyObj.rotation.set(0, it.rotY, 0)
      _dummyObj.scale.setScalar(it.scale)
      _dummyObj.updateMatrix()
      inst.setMatrixAt(i, _dummyObj.matrix)
    }
    inst.instanceMatrix.needsUpdate = true
    scene.add(inst)
    meshes.push(inst)
  }

  return meshes
}

/* ================================================================
   loadChunk / unloadChunk
================================================================ */
export function loadChunk(cx, cz) {
  const key = cx + ',' + cz
  if (chunks.has(key)) return

  const items = getProps(cx, cz)
  const shadowItems = collectShadowItems(cx, cz)
  const mesh = makeChunkMesh(cx, cz, shadowItems)
  const props = spawnChunkProps(cx, cz, items, mesh.userData.terrainSampler)

  scene.add(mesh)
  for (const p of props) p.visible = lod.showing3D
  chunks.set(key, { mesh, props })
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

/* ================================================================
   refill / process очереди загрузки чанков.
================================================================ */
const chunkLoadQueue = []
let chunkQueueIdx = 0

export function refillChunkQueue(camX, camZ) {
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  // Радиусы зависят от режима: обычный (у земли) или префетч (в 2D, при спуске).
  let LF, LB, LS
  if (_preloading) {
    LF = CFG.CHUNKS.loadForwardFar
    LB = CFG.CHUNKS.loadBackFar
    LS = CFG.CHUNKS.loadSideFar
  } else {
    LF = LOAD_FWD_CHUNKS
    LB = LOAD_BACK_CHUNKS
    LS = LOAD_SIDE_CHUNKS
  }

  // --- Выгрузка ---
  const toUnload = []
  for (const key of chunks.keys()) {
    const [cs, czs] = key.split(',')
    const dx = +cs - cxi,
      dz = +czs - czi
    if (dx < -(LB + UNLOAD_MARGIN) || dx > LF + UNLOAD_MARGIN || Math.abs(dz) > LS + UNLOAD_MARGIN)
      toUnload.push(key)
  }
  for (const k of toUnload) unloadChunk(k)

  // --- Прун кэша ---
  const padXf = LF + 1
  const padXb = LB + 1
  const padZ = LS + 1
  for (const key of propsCache.keys()) {
    if (PERSISTENT_CHUNKS.has(key)) continue
    const [cs, czs] = key.split(',')
    const dx = +cs - cxi
    const dz = +czs - czi
    if (dx < -padXb || dx > padXf || Math.abs(dz) > padZ) {
      propsCache.delete(key)
    }
  }

  // --- Очередь загрузки ---
  chunkLoadQueue.length = 0
  chunkQueueIdx = 0
  for (let dx = -LB; dx <= LF; dx++) {
    for (let dz = -LS; dz <= LS; dz++) {
      const cx = cxi + dx,
        cz = czi + dz
      if (!chunks.has(cx + ',' + cz)) chunkLoadQueue.push([cx, cz])
    }
  }
}

export function processChunkQueue() {
  // В чистом 2D (без префетча) — не тратим CPU.
  if (lod.fade > 0.5 && !_preloading) return
  if (chunkQueueIdx >= chunkLoadQueue.length) return

  // В префетче до земли долетаем быстро — дадим чуть больше бюджета.
  const BUDGET_MS = _preloading ? 6 : 4
  const t0 = performance.now()
  while (chunkQueueIdx < chunkLoadQueue.length && performance.now() - t0 < BUDGET_MS) {
    const [cx, cz] = chunkLoadQueue[chunkQueueIdx++]
    if (!chunks.has(cx + ',' + cz)) loadChunk(cx, cz)
  }

  if (chunkQueueIdx >= chunkLoadQueue.length) {
    chunkLoadQueue.length = 0
    chunkQueueIdx = 0
  }
}

/* ================================================================
   updatePersistentVisibility — показываем только ближние persistent.
================================================================ */
function updatePersistentVisibility(camX, camZ) {
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

/* ================================================================
   update — обновление per-frame (кэш ячейки + очередь + persistent).
================================================================ */
let _lastCell = { x: NaN, z: NaN }
let _lastPersist = { cxi: NaN, czi: NaN, showFine: null, showProps: null }
let _preloading = false

export function update() {
  const camX = camera.position.x
  const camZ = camera.position.z

  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  // Префетч: в 2D, но уже не слишком высоко — готовим почву для спуска.
  const wantPreload = lod.fade > 0.5 && lod.altSmooth < CFG.CHUNKS.preloadAltitude

  if (wantPreload !== _preloading) {
    // Смена режима → пересобрать очередь с другими радиусами.
    _preloading = wantPreload
    refillChunkQueue(camX, camZ)
    _lastCell.x = cxi
    _lastCell.z = czi
  } else if (cxi !== _lastCell.x || czi !== _lastCell.z) {
    // В чистом 2D (без префетча) чанки невидимы — не тратим CPU.
    if (lod.fade < 0.5 || _preloading) refillChunkQueue(camX, camZ)
    _lastCell.x = cxi
    _lastCell.z = czi
  }

  processChunkQueue()

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
}

/* ================================================================
   loadInitial — порционная загрузка нужных чанков с progress-колбэком.
   Возвращает Promise.
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

/* ================================================================
   countInitial — сколько чанков нужно загрузить (без загрузки).
   Используется для единого прогресс-бара.
================================================================ */
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
   init — навешивает sky-fog на материал пропсов.
================================================================ */
export function init() {
  // applySkyFog — импортируем лениво, чтобы не тянуть scene-циклы раньше времени.
  // На практике scene.js уже загружен в момент вызова init(), так что просто:
  import('./scene.js').then((m) => m.applySkyFog(propMat))
}

/* ---------- Debug ---------- */
export function getStats() {
  let persistentLoaded = 0
  for (const key of chunks.keys()) if (PERSISTENT_CHUNKS.has(key)) persistentLoaded++
  return {
    chunks: chunks.size,
    persistentLoaded,
    persistentTotal: PERSISTENT_CHUNKS.size,
    propsCache: propsCache.size,
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
