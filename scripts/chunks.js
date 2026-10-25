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
import { computeChunkProps } from './world/chunkProps.js'
import { terrainHeight, heightToTerrainColor, terrainBrightnessNoise } from './world/world.js'
import ChunkWorker from './workers/chunkWorker.js?worker'

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

/* ---------- Worker pool ---------- */
const POOL_SIZE = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1))
const workerPool = []
const pendingChunks = new Map()
const readyChunks = [] // ←  готовые данные от воркеров, ждут добавления в сцену
const readyChunksKeys = new Set()
let _workersReady = false

function initWorkerPool() {
  if (_workersReady) return
  _workersReady = true
  try {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new ChunkWorker()
      const idx = i
      w.onmessage = (e) => onWorkerMessage(idx, e)
      w.onerror = (err) => console.error('[chunks] worker error:', err)
      w.postMessage({ type: 'init', density: CFG.PROPS.density })
      workerPool.push({ worker: w, busy: false })
    }
    console.log(`[chunks] worker pool: ${workerPool.length}`)
  } catch (err) {
    console.warn('[chunks] Web Workers недоступны, fallback на sync:', err)
  }
}

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
    items = computeChunkProps(cx, cz) // из world/chunkProps.js
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
    ...getProps(cx - 1, cz - 1),
    ...getProps(cx - 1, cz),
    ...getProps(cx - 1, cz + 1),
    ...getProps(cx, cz - 1),
    ...getProps(cx, cz),
    ...getProps(cx, cz + 1),
    ...getProps(cx + 1, cz - 1),
    ...getProps(cx + 1, cz),
    ...getProps(cx + 1, cz + 1),
  ]
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
  mesh.receiveShadow = true

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
   ASYNC PATH — сборка чанка из данных worker'а
================================================================ */
function buildMeshFromWorker(cx, cz, data) {
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEG, CHUNK_SEG)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, data.heights[i])
  }
  pos.needsUpdate = true

  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))

  const cxw = cx * CHUNK_SIZE + CHUNK_SIZE / 2
  const czw = cz * CHUNK_SIZE + CHUNK_SIZE / 2
  const mesh = new THREE.Mesh(geo, groundMat)
  mesh.position.set(cxw, 0, czw)
  mesh.receiveShadow = true
  return mesh
}

function spawnPropsFromWorker(propMatrices) {
  const meshes = []
  for (const kind of ['pine', 'oak', 'bush', 'rock']) {
    const data = propMatrices[kind]
    if (data.length === 0) continue
    const count = data.length / 16

    const inst = new THREE.InstancedMesh(TEMPLATES[kind], propMat, count)
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    inst.castShadow = false
    inst.receiveShadow = false
    inst.frustumCulled = true

    // instanceMatrix.array — Float32Array того же размера; копируем .set()
    inst.instanceMatrix.array.set(data)
    inst.instanceMatrix.needsUpdate = true

    scene.add(inst)
    meshes.push(inst)
  }
  return meshes
}

function onWorkerMessage(workerIdx, e) {
  const data = e.data
  const { cx, cz } = data
  const key = cx + ',' + cz

  const slot = workerPool[workerIdx]
  if (slot) slot.busy = false

  const wasPending = pendingChunks.delete(key)

  // Чанк отменили, уже загружен или уже ждёт в readyChunks — отбрасываем
  if (!wasPending || chunks.has(key) || readyChunksKeys.has(key)) {
    processChunkQueue()
    return
  }

  readyChunks.push({ key, cx, cz, data })
  readyChunksKeys.add(key)
  processChunkQueue()
}

function dispatchChunk(cx, cz) {
  // Найти свободный worker
  let slot = null
  for (const s of workerPool) {
    if (!s.busy) {
      slot = s
      break
    }
  }
  if (!slot) return false

  const key = cx + ',' + cz
  slot.busy = true
  slot.worker.postMessage({ cx, cz })
  pendingChunks.set(key, true)
  return true
}

/* ================================================================
   loadChunk / unloadChunk
================================================================ */
export function loadChunk(cx, cz) {
  const key = cx + ',' + cz
  if (chunks.has(key) || pendingChunks.has(key)) return

  const items = getProps(cx, cz)
  const shadowItems = PERSISTENT_CHUNKS.has(key) ? collectShadowItems(cx, cz) : items
  const mesh = makeChunkMesh(cx, cz, shadowItems)
  const props = spawnChunkProps(cx, cz, items, mesh.userData.terrainSampler)

  scene.add(mesh)
  mesh.visible = lod.fade < 0.95
  for (const p of props) p.visible = lod.showing3D
  chunks.set(key, { mesh, props })
}

export function unloadChunk(key) {
  if (PERSISTENT_CHUNKS.has(key)) return

  // Отменяем, если чанк ещё в работе у worker'а
  if (pendingChunks.has(key)) {
    pendingChunks.delete(key)
    return
  }

  // NEW: убираем из очереди готовых, если ещё не добавлен в сцену
  const readyIdx = readyChunks.findIndex((r) => r.key === key)
  if (readyIdx !== -1) {
    readyChunks.splice(readyIdx, 1)
    readyChunksKeys.delete(key)
    return
  }

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

  // --- Очередь загрузки: приоритизация ---
  // Меньший score = выше приоритет.
  //   • текущий чанк (dx=0, dz=0) — грузим самым первым;
  //   • вперёд (dx>0) — важнее, чем стороны/назад, вес dx = 2×;
  //   • стороны и назад — в конце.
  const candidates = []
  for (let dx = -LB; dx <= LF; dx++) {
    for (let dz = -LS; dz <= LS; dz++) {
      const cx = cxi + dx
      const cz = czi + dz
      const key = cx + ',' + cz
      if (chunks.has(key) || pendingChunks.has(key) || readyChunksKeys.has(key)) continue
      const score = dx === 0 && dz === 0 ? -1000 : -dx * 2 + Math.abs(dz)
      candidates.push({ cx, cz, score })
    }
  }
  candidates.sort((a, b) => a.score - b.score)

  chunkLoadQueue.length = 0
  chunkQueueIdx = 0
  for (const c of candidates) chunkLoadQueue.push([c.cx, c.cz])
}

export function processChunkQueue() {
  if (lod.fade > 0.5 && !_preloading) return
  if (chunkQueueIdx >= chunkLoadQueue.length) {
    chunkLoadQueue.length = 0
    chunkQueueIdx = 0
    return
  }

  // Fallback: sync, если worker pool пустой
  if (workerPool.length === 0) {
    const BUDGET_MS = _preloading ? 6 : 4
    const t0 = performance.now()
    while (chunkQueueIdx < chunkLoadQueue.length && performance.now() - t0 < BUDGET_MS) {
      const [cx, cz] = chunkLoadQueue[chunkQueueIdx++]
      if (!chunks.has(cx + ',' + cz)) loadChunk(cx, cz)
    }
    return
  }

  // Worker dispatch: раздаём по свободным воркерам
  while (chunkQueueIdx < chunkLoadQueue.length) {
    const [cx, cz] = chunkLoadQueue[chunkQueueIdx]
    const key = cx + ',' + cz

    if (chunks.has(key) || pendingChunks.has(key) || readyChunksKeys.has(key)) {
      chunkQueueIdx++
      continue
    }
    if (!dispatchChunk(cx, cz)) break
    chunkQueueIdx++
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
const READY_BUDGET_MS = 4 // не больше 4 мс на добавление чанков за кадр
/* ================================================================
   processReadyChunks — добавляет чанки в сцену, соблюдая лимит из конфига.
================================================================ */
function processReadyChunks() {
  if (readyChunks.length === 0) return

  const camX = camera.position.x
  const camZ = camera.position.z
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  // Радиусы текущего режима — для проверки актуальности
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

  // Читаем лимит из конфига
  const maxPerFrame = CFG.RENDERER.maxChunksPerFrame ?? 1
  let processed = 0

  // Крутимся, пока не исчерпаем лимит за этот кадр
  while (readyChunks.length > 0 && processed < maxPerFrame) {
    // 1. Ищем самый ближний чанк к камере в очереди
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
    readyChunks.splice(bestIdx, 1) // забираем из очереди
    readyChunksKeys.delete(key)
    // NEW: пропускаем дубликат — чанк уже загружен
    if (chunks.has(key)) {
      console.debug('[dup chunk]', key)
      continue
    }

    // 2. Проверяем, не устарел ли он (вдруг камера улетела, пока он ждал)
    const dx = cx - cxi
    const dz = cz - czi
    if (
      dx < -(LB + UNLOAD_MARGIN) ||
      dx > LF + UNLOAD_MARGIN ||
      Math.abs(dz) > LS + UNLOAD_MARGIN
    ) {
      // Чанк устарел — просто выбрасываем, не тратя время на сборку
      continue
    }

    // 3. Собираем и добавляем в сцену
    const mesh = buildMeshFromWorker(cx, cz, data)
    const props = spawnPropsFromWorker(data.propMatrices)

    scene.add(mesh)

    // Сразу вычисляем корректную видимость, чтобы чанк не мигнул в кадре
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

/* ================================================================
   updateChunkVisibility — умное скрытие чанков вне зоны видимости
================================================================ */
function updateChunkVisibility(camX, camY, camZ) {
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

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

/* ================================================================
   update — обновление per-frame (кэш ячейки + очередь + persistent).
================================================================ */
let _lastCell = { x: NaN, z: NaN }
let _lastPersist = { cxi: NaN, czi: NaN, showFine: null, showProps: null }
let _preloading = false

export function update() {
  const camX = camera.position.x
  const camY = camera.position.y
  const camZ = camera.position.z
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  // ── Сначала — persistent visibility, она не про префетч ──
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

  // ── Затем — early-return для очередей в чистом 2D ──
  if (lod.fade > 0.5 && !_preloading && lod.altSmooth > CFG.CHUNKS.preloadAltitude) {
    return
  }

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

  processReadyChunks() //  добавить максимум 1 чанк в сцену
  processChunkQueue() // отправить задачи свободным воркерам

  if (
    cxi !== _lastPersist.cxi ||
    czi !== _lastPersist.czi ||
    showFine !== _lastPersist.showFine ||
    showProps !== _lastPersist.showProps
  ) {
    updatePersistentVisibility(camX, camZ)
    _lastPersist = { cxi, czi, showFine, showProps }
  }
  //Обновляем видимость всех остальных чанков
  updateChunkVisibility(camX, camY, camZ)
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
  initWorkerPool()
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
    pending: pendingChunks.size,
    ready: readyChunks.length,
    poolSize: workerPool.length,
    poolBusy: workerPool.filter((s) => s.busy).length,
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
