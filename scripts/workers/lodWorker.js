/* ================================================================
   lodWorker.js — Web Worker для дальнего плана (Far Tiles & Overlay).
================================================================ */
import * as THREE from 'three'
import * as CFG from '../config.js'
import { terrainHeight, heightToTerrainColor, hash2i } from '../world/world.js'
import { computeChunkProps } from '../world/chunkProps.js'

const FAR_TILE_SIZE = CFG.FAR_TILES.size
const TILE = CFG.GROUND_TEX.tile
const OVERLAY_SIZE = CFG.OVERLAY.size
const OVERLAY_CANVAS = CFG.OVERLAY.canvasSize
const OVERLAY_SEG = CFG.OVERLAY.segments

const SUN_DIR = new THREE.Vector3(...CFG.SKY.sunDir).normalize()
const _col = new THREE.Color()

/* ---------- Overlay Helpers ---------- */
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

/* ================================================================
   MESSAGE HANDLER
================================================================ */
let DENSITY = CFG.PROPS.density

self.onmessage = (e) => {
  const { type, fx, fz, ox, oz, seg, canvasSize, density } = e.data

  if (type === 'init') {
    if (typeof density === 'number' && density > 0) DENSITY = density
    return
  }
  if (type === 'far') generateFarTile(fx, fz, seg)
  else if (type === 'overlay') generateOverlay(ox, oz, canvasSize)
}

/* ================================================================
   FAR TILE
================================================================ */
function generateFarTile(fx, fz, seg) {
  const geo = new THREE.PlaneGeometry(FAR_TILE_SIZE, FAR_TILE_SIZE, seg, seg)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const nrm = geo.attributes.normal
  const colArr = new Float32Array(pos.count * 3)

  const cxw = fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  const czw = fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  const vertsPerRow = seg + 1
  const eps = FAR_TILE_SIZE / seg

  // Фаза 1: высоты, UV, цвета
  for (let i = 0; i < pos.count; i++) {
    const wx = cxw + pos.getX(i)
    const wz = czw + pos.getZ(i)
    const h = terrainHeight(wx, wz)
    pos.setY(i, h)
    uv.setXY(i, wx / TILE, wz / TILE)

    heightToTerrainColor(h, _col)
    colArr[i * 3] = _col.r
    colArr[i * 3 + 1] = _col.g
    colArr[i * 3 + 2] = _col.b
  }

  // Фаза 2: нормали
  for (let iz = 0; iz < vertsPerRow; iz++) {
    for (let ix = 0; ix < vertsPerRow; ix++) {
      const i00 = iz * vertsPerRow + ix
      const h = pos.getY(i00)

      let hx, hz
      if (ix < seg) hx = pos.getY(i00 + 1)
      else hx = terrainHeight(cxw + pos.getX(i00) + eps, czw + pos.getZ(i00))

      if (iz < seg) hz = pos.getY(i00 + vertsPerRow)
      else hz = terrainHeight(cxw + pos.getX(i00), czw + pos.getZ(i00) + eps)

      const nx = -(hx - h) / eps
      const nz = -(hz - h) / eps
      const len = Math.hypot(nx, 1, nz)
      nrm.setXYZ(i00, nx / len, 1 / len, nz / len)
    }
  }

  const posArr = new Float32Array(pos.array)
  const uvArr = new Float32Array(uv.array)
  const nrmArr = new Float32Array(nrm.array)

  self.postMessage({ type: 'far', fx, fz, seg, posArr, uvArr, nrmArr, colArr }, [
    posArr.buffer,
    uvArr.buffer,
    nrmArr.buffer,
    colArr.buffer,
  ])
}

/* ================================================================
   OVERLAY TILE
================================================================ */
function generateOverlay(ox, oz, canvasSize) {
  const W = canvasSize || OVERLAY_CANVAS
  const pxPerM = W / OVERLAY_SIZE
  const chunksPerSide = Math.round(OVERLAY_SIZE / CFG.CHUNKS.size)

  const baseX = ox * OVERLAY_SIZE
  const baseZ = oz * OVERLAY_SIZE
  const c0x = Math.floor(baseX / CFG.CHUNKS.size)
  const c0z = Math.floor(baseZ / CFG.CHUNKS.size)

  const pix = new Uint8ClampedArray(W * W * 4)
  const O = CFG.OVERLAY
  const PINE_RGB = hexToRgb(O.colors.pine)
  const OAK_RGB = hexToRgb(O.colors.oak)
  const DISC = makeDiscOffsets(O.pointSize)
  const JIT = O.colorJitter
  const MERGE = O.mergeAlpha
  const BASE_ALPHA = O.pointAlpha * 255
  const ALPHA_JIT = O.alphaJitter
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

  // Генерация точек деревьев
  for (let dz = 0; dz < chunksPerSide; dz++) {
    for (let dx = 0; dx < chunksPerSide; dx++) {
      const cx = c0x + dx
      const cz = c0z + dz
      const items = computeChunkProps(cx, cz, DENSITY) // Считаем прямо в воркере

      for (let k = 0; k < items.length; k++) {
        const it = items[k]
        if (it.kind !== 'pine' && it.kind !== 'oak') continue

        const px = ((it.x - baseX) * pxPerM) | 0
        const py = ((it.z - baseZ) * pxPerM) | 0
        if (px < -3 || px >= W + 3 || py < -3 || py >= W + 3) continue

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
    }
  }

  // Высоты для сетки оверлея
  const geo = new THREE.PlaneGeometry(OVERLAY_SIZE, OVERLAY_SIZE, OVERLAY_SEG, OVERLAY_SEG)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const cxw = ox * OVERLAY_SIZE + OVERLAY_SIZE / 2
  const czw = oz * OVERLAY_SIZE + OVERLAY_SIZE / 2

  for (let i = 0; i < pos.count; i++) {
    const wx = cxw + pos.getX(i)
    const wz = czw + pos.getZ(i)
    pos.setY(i, terrainHeight(wx, wz))
  }
  geo.computeVertexNormals()
  const posArr = new Float32Array(pos.array)
  const nrmArr = new Float32Array(geo.attributes.normal.array)

  self.postMessage({ type: 'overlay', ox, oz, posArr, nrmArr, pix }, [
    posArr.buffer,
    nrmArr.buffer,
    pix.buffer,
  ])
}
