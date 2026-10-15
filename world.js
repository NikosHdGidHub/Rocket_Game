/* ================================================================
   world.js — шум, рельеф, палитра, текстура земли.
   Никакого рендера, никаких чанков — только «математика мира».
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'

export const WORLD_SEED = CFG.WORLD_SEED

export function terrainBrightnessNoise(x, z) {
  const C = CFG.TERRAIN_COLOR_NOISE
  if (!C.enabled) return 1
  const n = fbm2(x * C.freq, z * C.freq, C.octaves) - 0.5 // -0.5..0.5
  return 1 + n * 2 * C.brightness
}

/* ---------- Детерминированный RNG ---------- */
export function hash2i(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return h >>> 0
}

/**
 * Хеш для value-noise, учитывающий seed мира.
 * Отдельный от hash2i, чтобы не XOR-ить seed дважды там,
 * где он уже применяется снаружи (леса, пропсы).
 */
function noiseHash(x, y) {
  return (hash2i(x, y) ^ WORLD_SEED) >>> 0
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

  const a = noiseHash(xi, zi) / 4294967296
  const b = noiseHash(xi + 1, zi) / 4294967296
  const c = noiseHash(xi, zi + 1) / 4294967296
  const d = noiseHash(xi + 1, zi + 1) / 4294967296

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

/* ---------- Периодический value-noise для бесшовного тайла ---------- */
function vnoisePeriodic(x, z, P) {
  const xi = Math.floor(x),
    zi = Math.floor(z)
  const xf = x - xi,
    zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)
  const w = (n) => ((n % P) + P) % P
  const a = hash2i(w(xi), w(zi)) / 4294967296
  const b = hash2i(w(xi + 1), w(zi)) / 4294967296
  const c = hash2i(w(xi), w(zi + 1)) / 4294967296
  const d = hash2i(w(xi + 1), w(zi + 1)) / 4294967296
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

function fbmPeriodic(x, z, oct, P) {
  let s = 0,
    amp = 1,
    freq = 1,
    norm = 0
  for (let i = 0; i < oct; i++) {
    s += vnoisePeriodic(x * freq, z * freq, P * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return s / norm
}

/* ---------- Рельеф ---------- */
const S = WORLD_SEED * 0.0001

export function terrainBase(x, z) {
  let h = 0

  // Базовые волны — без изменений
  for (const w of CFG.TERRAIN.baseWaves) {
    const arg =
      w.axis === 'x'
        ? x * w.freq + w.phase + S
        : w.axis === 'z'
          ? z * w.freq + w.phase + S
          : (x + z * 0.8) * w.freq + w.phase + S
    h += (w.fn === 'sin' ? Math.sin(arg) : Math.cos(arg)) * w.amp
  }

  // Множитель «включения гор»
  const mt = Math.min(1, Math.max(0, (x - CFG.TERRAIN.mountainsStart) / CFG.TERRAIN.mountainsRamp))
  const mt2 = mt * mt

  // Глобальный рост (высота)
  const far = Math.max(0, (x - CFG.TERRAIN.growthStart) * CFG.TERRAIN.growthRate)
  const growth = 1 + far

  // ─── НОВОЕ: волнистость + утолщение/разрежение хребтов ───
  const RW = CFG.TERRAIN.ridgeWave
  const RG = CFG.TERRAIN.ridgeGrowth

  // Одно поле шума на весь вызов. Дёшево (2 октавы) и даёт
  // согласованный «изгиб» всех ridge-компонентов.
  let waveField = 0
  if (RW.enabled && RW.amp > 0) {
    waveField = (fbm2(x * RW.freq, z * RW.freq, RW.octaves) - 0.5) * 2 // [-1, 1]
  }

  // Масштаб формы по X: чем дальше — тем шире и мягче хребты.
  // ratio = 1 при x ≤ refX, дальше плавно падает.
  let freqScale = 1
  let sharpScale = 1
  if (RG.enabled && x > RG.refX) {
    const ratio = RG.refX / x
    freqScale = Math.max(RG.minFreqScale, Math.pow(ratio, RG.freqExp))
    sharpScale = Math.max(RG.minSharpScale, Math.pow(ratio, RG.sharpExp))
  }

  const ridge = (u, v, freq, seed, sharp, soft) => {
    const f = freq * freqScale // эффективная частота → ширина/частота хребта
    // Мягкие гребни (sharp < ~2.5) не масштабируем по остроте:
    // они и так «синусоидные», дальше вырождаются в полосы.
    const sh = soft ? sharp : sharp * sharpScale
    const wavePhase = waveField * RW.amp * f
    const s = Math.sin(u * f + v * f * 0.55 + seed + S + wavePhase)
    return Math.pow(1 - Math.abs(s), sh)
  }

  let r = 0
  for (const g of CFG.TERRAIN.ridges) {
    r += g.swap
      ? ridge(z, -x, g.freq, g.seed, g.sharp, g.soft) * g.amp
      : ridge(x, z, g.freq, g.seed, g.sharp, g.soft) * g.amp
  }

  // ─── Модуляция высоты вдоль хребта ───
  // Низкочастотный шум по (x,z) поднимает одни участки массива
  // и опускает другие — ломает «полочку» постоянной высоты
  // на гребне. Шум не параллелен диагональному гребню, поэтому
  // гарантированно даёт вариацию вдоль него.
  const RH = CFG.TERRAIN.ridgeHeightMod
  if (RH.enabled && RH.amp > 0) {
    const mod = (fbm2(x * RH.freq, z * RH.freq, RH.octaves) - 0.5) * 2 // [-1,1]
    r *= 1 + mod * RH.amp
  }

  h += mt2 * (CFG.TERRAIN.mountainFloor + r * CFG.TERRAIN.mountainScale) * growth

  // Шум поверх гор — без изменений
  const n = CFG.TERRAIN.noise
  const t = Math.min(1, Math.max(0, h / n.heightRef))
  if (t > 0) {
    const big = (fbm2(x * n.bigFreq, z * n.bigFreq, n.bigOct) - 0.5) * 2
    const small = (fbm2(x * n.smallFreq, z * n.smallFreq, n.smallOct) - 0.5) * 2
    h += (big * n.bigAmp + small * n.smallAmp) * t
  }

  return h
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
  const S = G.size
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')

  ctx.fillStyle = G.base
  ctx.fillRect(0, 0, S, S)

  // ---------- Пятна: рисуем 9 копий, чтобы границы были бесшовны ----------
  // Копия, уехавшая за край, «проявляется» с другой стороны — никакого шва.
  for (const layer of G.spotLayers) {
    for (let i = 0; i < layer.count; i++) {
      const v = Math.random() > 0.5 ? 0 : 255
      const a = layer.aMin + Math.random() * (layer.aMax - layer.aMin)
      ctx.fillStyle = `rgba(${v},${v},${v},${a})`

      const cx = Math.random() * S
      const cy = Math.random() * S
      const r = layer.rMin + Math.random() * (layer.rMax - layer.rMin)

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          ctx.beginPath()
          ctx.arc(cx + dx * S, cy + dy * S, r, 0, 6.284)
          ctx.fill()
        }
      }
    }
  }

  // ---------- Тонкая крапивка (per-pixel) ----------
  if (G.grain.enabled) {
    const img = ctx.getImageData(0, 0, S, S)
    const d = img.data
    const amp = G.grain.amp * 255

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x / S) * G.grain.cells
        const v = (y / S) * G.grain.cells
        const n = fbmPeriodic(u, v, G.grain.octaves, G.grain.cells) - 0.5
        const add = n * 2 * amp
        const i = (y * S + x) * 4
        d[i] = Math.max(0, Math.min(255, d[i] + add))
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + add))
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + add))
      }
    }
    ctx.putImageData(img, 0, 0)
  }

  // ---------- БОЛЬШЕ НЕ РИСУЕМ РАМКУ ПО КРАЮ ----------
  // Именно она давала видимую сетку каждые N метров.

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
