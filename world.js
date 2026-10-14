/* ================================================================
   world.js — шум, рельеф, палитра, текстура земли.
   Никакого рендерера, никаких чанков — только «математика мира».
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'

export const WORLD_SEED = CFG.WORLD_SEED

/* ---------- Детерминированный RNG ---------- */
export function hash2i(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return h >>> 0
}

export function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------- Value noise + фрактальный шум ---------- */
export function vnoise(x, z) {
  const xi = Math.floor(x),
    zi = Math.floor(z)
  const xf = x - xi,
    zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)

  const a = hash2i(xi, zi) / 4294967296
  const b = hash2i(xi + 1, zi) / 4294967296
  const c = hash2i(xi, zi + 1) / 4294967296
  const d = hash2i(xi + 1, zi + 1) / 4294967296

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

export function fbm2(x, z, oct) {
  let s = 0,
    amp = 1,
    freq = 1,
    norm = 0
  for (let i = 0; i < oct; i++) {
    s += vnoise(x * freq, z * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.0
  }
  return s / norm
}

/* ---------- Рельеф ---------- */
const S = WORLD_SEED * 0.0001

export function terrainBase(x, z) {
  let h = 0

  // Базовые волны
  for (const w of CFG.TERRAIN.baseWaves) {
    const arg =
      w.axis === 'x'
        ? x * w.freq + w.phase + S
        : w.axis === 'z'
          ? z * w.freq + w.phase + S
          : (x + z * 0.8) * w.freq + w.phase + S
    h += (w.fn === 'sin' ? Math.sin(arg) : Math.cos(arg)) * w.amp
  }

  // Впадины
  const d = CFG.TERRAIN.dip
  const dip = Math.max(0, Math.sin(x * d.freq + d.phase + S))
  h -= dip * dip * d.amp

  // Множитель «включения гор»
  const mt = Math.min(1, Math.max(0, (x - CFG.TERRAIN.mountainsStart) / CFG.TERRAIN.mountainsRamp))
  const mt2 = mt * mt

  // Глобальный рост
  const far = Math.max(0, (x - CFG.TERRAIN.growthStart) * CFG.TERRAIN.growthRate)
  const growth = 1 + far

  // Ridged noise
  const ridge = (u, v, freq, seed, sharp) => {
    const s = Math.sin(u * freq + v * freq * 0.55 + seed + S)
    return Math.pow(1 - Math.abs(s), sharp)
  }

  let r = 0
  for (const g of CFG.TERRAIN.ridges) {
    r += g.swap
      ? ridge(z, -x, g.freq, g.seed, gsharpOr(g)) * g.amp
      : ridge(x, z, g.freq, g.seed, g.sharp) * g.amp
  }

  h += mt2 * (CFG.TERRAIN.mountainFloor + r * CFG.TERRAIN.mountainScale) * growth

  // Шум поверх гор
  const n = CFG.TERRAIN.noise
  const t = Math.min(1, Math.max(0, h / n.heightRef))
  if (t > 0) {
    const big = (fbm2(x * n.bigFreq, z * n.bigFreq, n.bigOct) - 0.5) * 2
    const small = (fbm2(x * n.smallFreq, z * n.smallFreq, n.smallOct) - 0.5) * 2
    h += (big * n.bigAmp + small * n.smallAmp) * t
  }

  return h
}

// мелкий хелпер — оставил чтобы не запутаться
function gsharpOr(g) {
  return g.sharp
}

export function terrainHeight(x, z) {
  const d = Math.hypot(x + 2.6, z)
  const flat = Math.min(1, Math.max(0, (d - CFG.TERRAIN.safeRadius) / CFG.TERRAIN.safeRamp))
  return terrainBase(x, z) * flat
}

/* ---------- Палитра по высоте ---------- */
const TERRAIN_STOPS = CFG.TERRAIN_STOPS.map((s) => ({
  h: s.h,
  color: new THREE.Color(s.color),
}))

export function heightToTerrainColor(h, out) {
  const st = TERRAIN_STOPS
  if (h <= st[0].h) {
    out.copy(st[0].color)
    return
  }
  const last = st.length - 1
  if (h >= st[last].h) {
    out.copy(st[last].color)
    return
  }
  for (let i = 0; i < last; i++) {
    const a = st[i],
      b = st[i + 1]
    if (h >= a.h && h <= b.h) {
      const t = (h - a.h) / (b.h - a.h)
      out.copy(a.color).lerp(b.color, t)
      return
    }
  }
}

/* ---------- Текстура земли ---------- */
export const GROUND_TILE = CFG.GROUND_TEX.tile

export function makeGroundTexture(maxAnisotropy) {
  const G = CFG.GROUND_TEX
  const c = document.createElement('canvas')
  c.width = c.height = G.size
  const ctx = c.getContext('2d')

  ctx.fillStyle = G.base
  ctx.fillRect(0, 0, G.size, G.size)

  for (let i = 0; i < G.spots; i++) {
    const v = Math.random() > 0.5 ? 0 : 255
    const a = G.spotAlphaMin + Math.random() * (G.spotAlphaMax - G.spotAlphaMin)
    ctx.fillStyle = `rgba(${v},${v},${v},${a})`
    ctx.beginPath()
    ctx.arc(
      Math.random() * G.size,
      Math.random() * G.size,
      G.spotMin + Math.random() * (G.spotMax - G.spotMin),
      0,
      6.284
    )
    ctx.fill()
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.07)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 1.5)
  ctx.lineTo(G.size, 1.5)
  ctx.moveTo(1.5, 0)
  ctx.lineTo(1.5, G.size)
  ctx.stroke()

  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = maxAnisotropy
  return t
}

/* ================================================================
   ЛЕСНЫЕ ПЯТНА — детерминированные «рощи» по всему миру.

   Идея: воображаемая сетка с шагом forestCellSize. В каждой
   ячейке по хэшу рождается 1–2 центра с радиусом из config.
   Плотность дерева = max по всем пятнам от (1 - d/r)^falloff.

   Всё детерминировано по МИРОВЫМ координатам → два соседних
   чанка видят одни и те же пятна на общей границе. Никаких швов.
================================================================ */

export function collectForestSpheres(cx, cz) {
  const S = CFG.PROPS.forestCellSize
  const CS = CFG.CHUNKS.size
  const Rmin = CFG.PROPS.forestRadius[0]
  const Rmax = CFG.PROPS.forestRadius[1]

  const x0 = cx * CS,
    x1 = (cx + 1) * CS
  const z0 = cz * CS,
    z1 = (cz + 1) * CS

  // Broad-phase: какие ячейки сетки могут содержать центр,
  // который дотянется до нашего чанка.
  const ci0 = Math.floor((x0 - Rmax) / S)
  const ci1 = Math.floor((x1 + Rmax) / S)
  const cj0 = Math.floor((z0 - Rmax) / S)
  const cj1 = Math.floor((z1 + Rmax) / S)

  const spheres = []
  for (let ci = ci0; ci <= ci1; ci++) {
    for (let cj = cj0; cj <= cj1; cj++) {
      const h = hash2i(ci + 0x5f1a, cj + 0xa3d2) ^ WORLD_SEED
      const rng = mulberry32(h)
      const n = 1 + (h & 1) // 1 или 2 пятна в ячейке

      for (let k = 0; k < n; k++) {
        const sx = ci * S + rng() * S
        const sz = cj * S + rng() * S
        const r = Rmin + rng() * (Rmax - Rmin)

        // Отсеиваем то, что физически не достаёт до чанка.
        if (sx + r < x0 || sx - r > x1) continue
        if (sz + r < z0 || sz - r > z1) continue

        spheres.push({ sx, sz, r })
      }
    }
  }
  return spheres
}

export function forestDensityFromSpheres(x, z, spheres) {
  const falloff = CFG.PROPS.forestFalloff
  const edgeAmp = CFG.PROPS.forestEdgeNoise
  const edgeFreq = CFG.PROPS.forestEdgeFreq

  // Один вызов vnoise на точку — используем как общий сдвиг
  // радиуса для всех пятен вокруг этой точки. Дёшево и достаточно:
  // соседние точки получают согласованный сдвиг → границы «дышат».
  let edgeOffset = 0
  if (edgeAmp > 0) {
    edgeOffset = (vnoise(x * edgeFreq, z * edgeFreq) - 0.5) * edgeAmp
  }

  let maxD = 0
  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i]
    const dx = x - s.sx
    const dz = z - s.sz
    const d2 = dx * dx + dz * dz
    if (d2 >= s.r * s.r) continue

    let d = Math.sqrt(d2) + edgeOffset * s.r
    let t = d / s.r
    if (t < 0) t = 0
    if (t >= 1) continue

    const density = Math.pow(1 - t, falloff)
    if (density > maxD) maxD = density
  }
  return maxD
}
