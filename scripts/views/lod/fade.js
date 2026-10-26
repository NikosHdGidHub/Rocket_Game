/* ================================================================
   fade.js — плавный переход 3D ⇄ 2D, туман, видимость слоёв.
================================================================ */
import * as CFG from '../../config.js'
import { scene, fogU, camera } from '../scene.js'
import { lod, rocketState } from '../../state.js'
import { chunks, PERSISTENT_CHUNKS, unloadChunk } from '../chunks/index.js'
import { boss } from '../entities/index.js'
import { terrainHeight } from '../../world/world.js'
import { state } from './state.js'
import { getOverlayOpacity } from './overlay.js'

function smoothstep(a, b, x) {
  if (x <= a) return 0
  if (x >= b) return 1
  const t = (x - a) / (b - a)
  return t * t * (3 - 2 * t)
}

/* ================================================================
   STAGGERED REVEAL / UNLOAD

   Система БЕЗ состояния: каждый кадр сравниваем «видимо / целевое»
   и шагаем на batch к цели. При инверсии направления target просто
   меняется — всё сходится само, без отмен и без рассинхрона.
================================================================ */

/** Включить/выключить до batch элементов collection в сторону target. */
function stepReveal(collection, target, batch) {
  let flipped = 0
  for (const c of collection.values()) {
    if (c.mesh.visible !== target) {
      c.mesh.visible = target
      if (++flipped >= batch) break
    }
  }
}

/** Все ли элементы collection в состоянии target. */
function isConverged(collection, target) {
  for (const c of collection.values()) {
    if (c.mesh.visible !== target) return false
  }
  return true
}

/**
 * Выгрузить до batch 3D-чанков, которые сейчас вне preload-границ.
 * Возвращает true, если остались ещё кандидаты (нужен ещё кадр).
 *
 * ВАЖНО: каждый вызов пересчитывает bounds из ТЕКУЩЕГО положения камеры.
 * Поэтому если камера пошла обратно вниз, чанк, который уже в границах,
 * просто не будет выгружен (никаких «зависших» кандидатов в очереди).
 */
function stepUnload(batch) {
  const camX = camera.position.x
  const camZ = camera.position.z
  const CS = CFG.CHUNKS.size
  const cxi = Math.floor(camX / CS)
  const czi = Math.floor(camZ / CS)

  const LF = CFG.CHUNKS.loadForwardFar
  const LB = CFG.CHUNKS.loadBackFar
  const LS = CFG.CHUNKS.loadSideFar
  const M = CFG.CHUNKS.unloadMargin

  let unloaded = 0
  let more = false
  for (const [key, c] of chunks) {
    if (PERSISTENT_CHUNKS.has(key)) continue
    const dx = c.cx - cxi
    const dz = c.cz - czi
    if (dx < -(LB + M) || dx > LF + M || Math.abs(dz) > LS + M) {
      if (unloaded < batch) {
        unloadChunk(key)
        unloaded++
      } else {
        more = true
        break
      }
    }
  }
  return more
}

/* Локальный доступ к фазе без импорта game.js (избегаем циклов). */
let _getPhase = () => 'ready'
export function setPhaseGetter(fn) {
  _getPhase = fn
}
const G_PHASE = () => _getPhase()

/**
 * Обновляет ЦЕНТР эллиптического тумана под ракетой.
 *
 * Направление эллипса ФИКСИРОВАНО вдоль +X (fogU.dir = (1, 0) в scene.js).
 * Вращение отключено: не зависим от скорости и направления полёта.
 */
export function updateFogEllipse() {
  fogU.center.value.set(rocketState.pos.x, rocketState.pos.z)
}

export function updateLOD(dt) {
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

  // ═══════════════════════════════════════════════════════════════
  // ФАЗОВЫЙ ПЕРЕХОД: far reveal → unload 3D → overlay reveal
  //
  // Три тяжёлые GPU-операции, каждая сериализована в свою фазу.
  // Только вперёд (в 2D): при спуске порядок не важен, всё
  // сходится параллельно и без пиков (3D-чанки грузятся асинхронно
  // через воркеры, скрытие far/overlay — дешёвое).
  // ═══════════════════════════════════════════════════════════════
  const reveal = CFG.LOD.reveal

  // --- Фаза 1: far tiles ---
  if (state.farGroundMat) state.farGroundMat.opacity = farOpacity
  const farTarget = farOpacity > 0.005
  stepReveal(state.farTiles, farTarget, reveal.farBatch)
  const farConverged = isConverged(state.farTiles, farTarget)

  // --- Фаза 2: unload 3D-чанков ---
  // Только в 2D (внизу 3D-чанки нужны) и только после far reveal.
  let unloadDone = true
  if (farConverged && lod.in2D) {
    unloadDone = !stepUnload(reveal.unloadBatch)
  }

  // --- Фаза 3: overlay reveal ---
  // Скрывать — можно всегда (opacity уже 0).
  // Показывать — только когда far и unload сошлись.
  for (const c of state.overlayChunks.values()) c.mat.opacity = overlayOpacity
  const overlayTarget = overlayOpacity > 0.005
  const canRevealOverlay = farConverged && unloadDone
  if (!overlayTarget || canRevealOverlay) {
    stepReveal(state.overlayChunks, overlayTarget, reveal.overlayBatch)
  }

  state.lastFarOpacity = farOpacity
  state.lastOverlayOpacity = overlayOpacity

  const showFine = lod.fade < 0.95
  if (showFine !== state.lastShowFineChunks) {
    for (const [key, c] of chunks) {
      if (PERSISTENT_CHUNKS.has(key)) continue
      c.mesh.visible = showFine
    }
    state.lastShowFineChunks = showFine
  }

  const want3D = lod.fade < 0.15
  const farFromBoss = rocketState.pos.x > CFG.BOSS.hideDistance
  const bossVisible = want3D && !farFromBoss

  if (want3D !== lod.showing3D || (boss && boss.visible !== bossVisible)) {
    for (const [key, c] of chunks) {
      if (PERSISTENT_CHUNKS.has(key)) continue
      for (const pr of c.props) pr.visible = want3D
    }
    if (boss) boss.visible = bossVisible
    lod.showing3D = want3D
  }

  // ─── 3D-туман ───
  const FOG_3D_NEAR = CFG.FOG.near3D
  const FOG_3D_FAR = CFG.FOG.far3D
  const FOG_2D_NEAR = CFG.FOG.near2D
  const FOG_2D_FAR = CFG.FOG.far2D

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
