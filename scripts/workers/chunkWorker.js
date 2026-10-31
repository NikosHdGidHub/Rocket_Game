/* ================================================================
   chunkWorker.js — Web Worker: тяжёлая генерация 3D-чанка.

   Принимает: { cx, cz }
   Возвращает (transferable):
     heights:  Float32Array (VPR*VPR)         — Y-координаты вершин
     normals:  Float32Array (VPR*VPR*3)
     colors:   Float32Array (VPR*VPR*3)       — включая запечённые тени
     uvs:      Float32Array (VPR*VPR*2)
     propMatrices: { pine, oak, bush, rock }  — Float32Array (N*16)

   Three.js-объекты (Mesh, InstancedMesh, BufferGeometry)
   создаются на main thread — worker лишь готовит «сырые» данные.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../config.js'
import { computeChunkProps } from '../world/chunkProps.js'
import { terrainHeight, heightToTerrainColor, terrainBrightnessNoise } from '../world/world.js'
import { KINDS, shadowRadiusOf } from '../world/props.js'

const CHUNK_SIZE = CFG.CHUNKS.size
let CHUNK_SEG = CFG.CHUNKS.segments
let VPR = CHUNK_SEG + 1
let STEP = CHUNK_SIZE / CHUNK_SEG
const GROUND_TILE = CFG.GROUND_TEX.tile

const SUN_DIR = new THREE.Vector3(...CFG.SKY.sunDir).normalize()
const _color = new THREE.Color()

let DENSITY = CFG.PROPS.density // может быть переопределён init-сообщением

self.onmessage = (e) => {
  const data = e.data

  if (data.type === 'init') {
    DENSITY = data.density
    if (typeof data.segments === 'number' && data.segments > 0) {
      CHUNK_SEG = data.segments
      VPR = CHUNK_SEG + 1
      STEP = CHUNK_SIZE / CHUNK_SEG
    }
    return
  }

  const { cx, cz } = data
  try {
    const items = computeChunkProps(cx, cz, DENSITY)
    const meshData = makeMeshData(cx, cz, items)
    const propMatrices = buildPropMatrices(cx, cz, items, meshData.heights)

    const transfers = [
      meshData.heights.buffer,
      meshData.normals.buffer,
      meshData.colors.buffer,
      meshData.uvs.buffer,
    ]
    for (const kind of KINDS) transfers.push(propMatrices[kind].buffer)

    self.postMessage({ cx, cz, ...meshData, propMatrices }, transfers)
  } catch (err) {
    console.error('[chunkWorker] error', cx, cz, err)
  }
}

/* ---------- Высоты + UV + цвета + нормали + тени ---------- */
function makeMeshData(cx, cz, items) {
  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE

  const heights = new Float32Array(VPR * VPR)
  const normals = new Float32Array(VPR * VPR * 3)
  const colors = new Float32Array(VPR * VPR * 3)
  const uvs = new Float32Array(VPR * VPR * 2)

  // Pass 1: высоты, UV, базовые цвета
  for (let iz = 0; iz < VPR; iz++) {
    for (let ix = 0; ix < VPR; ix++) {
      const i = iz * VPR + ix
      const wx = baseX + ix * STEP
      const wz = baseZ + iz * STEP
      const h = terrainHeight(wx, wz)
      heights[i] = h

      uvs[i * 2] = wx / GROUND_TILE
      uvs[i * 2 + 1] = wz / GROUND_TILE

      heightToTerrainColor(h, _color)
      const b = terrainBrightnessNoise(wx, wz)
      colors[i * 3] = _color.r * b
      colors[i * 3 + 1] = _color.g * b
      colors[i * 3 + 2] = _color.b * b
    }
  }

  // Pass 2: нормали (аналитические из сетки высот)
  for (let iz = 0; iz < VPR; iz++) {
    for (let ix = 0; ix < VPR; ix++) {
      const i = iz * VPR + ix
      const h = heights[i]
      const hx =
        ix < CHUNK_SEG ? heights[i + 1] : terrainHeight(baseX + (ix + 1) * STEP, baseZ + iz * STEP)
      const hz =
        iz < CHUNK_SEG
          ? heights[i + VPR]
          : terrainHeight(baseX + ix * STEP, baseZ + (iz + 1) * STEP)
      const nx = -(hx - h) / STEP
      const nz = -(hz - h) / STEP
      const len = Math.hypot(nx, 1, nz)
      normals[i * 3] = nx / len
      normals[i * 3 + 1] = 1 / len
      normals[i * 3 + 2] = nz / len
    }
  }

  // Pass 3: запечённые тени от деревьев
  const shLenXZ = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1
  const shDirX = -SUN_DIR.x / shLenXZ
  const shDirZ = -SUN_DIR.z / shLenXZ
  const shStrength = CFG.PROPS.shadow.strength
  const shScale = CFG.PROPS.shadow.scale
  const shSoft = CFG.PROPS.shadow.softness
  const shDist = CFG.PROPS.shadow.offset

  const shadowB = new Float32Array(VPR * VPR).fill(1)

  for (const it of items) {
    const baseR = shadowRadiusOf(it.kind)
    if (baseR <= 0) continue
    const R = baseR * it.scale * shScale
    if (R <= 0) continue

    const tOffset = shDist * (0.6 + 0.4 * it.scale)
    const tx = it.x + shDirX * tOffset
    const tz = it.z + shDirZ * tOffset
    const lx = tx - baseX
    const lz = tz - baseZ

    const ix0 = Math.max(0, Math.floor((lx - R) / STEP))
    const ix1 = Math.min(CHUNK_SEG, Math.ceil((lx + R) / STEP))
    const iz0 = Math.max(0, Math.floor((lz - R) / STEP))
    const iz1 = Math.min(CHUNK_SEG, Math.ceil((lz + R) / STEP))
    const R2 = R * R

    for (let iz = iz0; iz <= iz1; iz++) {
      const vz = iz * STEP
      const dz = vz - lz
      const dz2 = dz * dz
      const rowBase = iz * VPR
      for (let ix = ix0; ix <= ix1; ix++) {
        const vx = ix * STEP
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

  for (let i = 0; i < VPR * VPR; i++) {
    const s = shadowB[i]
    if (s < 1) {
      colors[i * 3] *= s
      colors[i * 3 + 1] *= s
      colors[i * 3 + 2] *= s
    }
  }

  return { heights, normals, colors, uvs }
}

/* ---------- Матрицы пропсов (для InstancedMesh) ---------- */
function buildPropMatrices(cx, cz, items, heights) {
  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE
  const stepRecip = 1 / STEP

  // Билинейный сэмплер высоты — совпадает с треугольниками меша
  function sampleHeight(x, z) {
    const gx = (x - baseX) * stepRecip
    const gz = (z - baseZ) * stepRecip
    let ix = Math.floor(gx)
    let iz = Math.floor(gz)
    let fx = gx - ix
    let fz = gz - iz
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
      heights[i00] * (1 - fx) * (1 - fz) +
      heights[i10] * fx * (1 - fz) +
      heights[i01] * (1 - fx) * fz +
      heights[i11] * fx * fz
    )
  }

  const groups = {}
  for (const kind of KINDS) groups[kind] = []

  for (const it of items) {
    if (!groups[it.kind]) continue
    const y = sampleHeight(it.x, it.z)
    const s = it.scale
    const c = Math.cos(it.rotY) * s
    const sn = Math.sin(it.rotY) * s
    groups[it.kind].push(c, 0, -sn, 0, 0, s, 0, 0, sn, 0, c, 0, it.x, y, it.z, 1)
  }

  const out = {}
  for (const kind of KINDS) out[kind] = new Float32Array(groups[kind])
  return out
}
