/* ================================================================
   chunkProps.js — детерминированная расстановка деревьев/кустов/камней
   в чанке. Чистая математика: только config + world.

   Используется:
     • chunks.js (main thread) — для getProps() (overlay-текстуры)
     • workers/chunkWorker.js  — для генерации 3D-чанков
     • workers/lodWorker.js    — для overlay в 2D-режиме
================================================================ */
import * as CFG from '../config.js'
import {
  WORLD_SEED,
  hash2i,
  mulberry32,
  terrainHeight,
  collectForestSpheres,
  forestDensityFromSpheres,
} from './world.js'

/* ---------- Порядок выбора вида (из CFG.PROPS.thresholds) ----------
   Первое условие r < TH[kind] побеждает. Последний порог = 1.0,
   поэтому fallback недостижим в норме; на всякий случай возвращаем
   последний ключ.
------------------------------------------------------------------ */
const KIND_ORDER = Object.keys(CFG.PROPS.thresholds)
const KIND_META = CFG.PROPS.kinds

function pickKind(r) {
  let last = KIND_ORDER[0]
  for (let i = 0; i < KIND_ORDER.length; i++) {
    const k = KIND_ORDER[i]
    if (r < CFG.PROPS.thresholds[k]) return k
    last = k
  }
  return last
}

export function computeChunkProps(cx, cz, count) {
  const COUNT = count ?? CFG.PROPS.density
  const CHUNK_SIZE = CFG.CHUNKS.size

  const seed = hash2i(cx + 0x9e37, cz + 0x79b9) ^ WORLD_SEED
  const rng = mulberry32(seed)

  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE

  const items = []
  const SC = CFG.PROPS.scales
  const VEG_MAX_H = CFG.PROPS.vegMaxHeight
  const VEG_MIN_H = CFG.PROPS.vegMinHeight
  const ROCK_LOWLAND_FREQ = CFG.PROPS.rockLowlandFrequency
  const ROCK_BIAS = CFG.PROPS.rockScaleBias

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

    // Базовый круг вокруг босса — не ставим ничего.
    if (relX * relX + relZ * relZ < SAFE_R2) continue

    const r = rng()
    const kind = pickKind(r)
    const category = KIND_META[kind]?.category || 'rock'

    // Деревья и кусты — ещё и эллипс вперёд от старта.
    if (category === 'tree' || category === 'shrub') {
      const aX = relX >= 0 ? SAFE_TREES_FWD : SAFE_TREES_BACK
      const ex = relX / aX
      const ez = relZ / SAFE_TREES_SIDE
      if (ex * ex + ez * ez < 1) continue
    }

    const h = terrainHeight(wx, wz)

    if (category === 'rock') {
      // На низкой равнине камни редкие, выше vegMaxHeight — везде.
      if (h <= VEG_MAX_H && rng() > ROCK_LOWLAND_FREQ) continue
    } else {
      // Деревья/кусты: только в «лесных пятнах» и в диапазоне высот.
      const density = forestDensityFromSpheres(wx, wz, spheres)
      if (density <= 0) continue
      if (rng() > density) continue
      if (h > VEG_MAX_H || h < VEG_MIN_H) continue
    }

    const scale =
      category === 'rock'
        ? SC.rock[0] + (SC.rock[1] - SC.rock[0]) * Math.pow(rng(), ROCK_BIAS)
        : SC.tree[0] + rng() * (SC.tree[1] - SC.tree[0])

    const rotY = rng() * 6.28

    items.push({ x: wx, z: wz, kind, scale, rotY })
  }
  return items
}
