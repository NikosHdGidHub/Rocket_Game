// fix6.mjs — пофазный переход в 2D: staggered far reveal → staggered unload → staggered overlay.
// Запуск: node fix6.mjs
import fs from 'node:fs'

const read = (p) => {
  const raw = fs.readFileSync(p, 'utf-8')
  const isCRLF = raw.includes('\r\n')
  return { text: raw.replace(/\r\n/g, '\n'), isCRLF }
}
const write = (p, text, isCRLF) =>
  fs.writeFileSync(p, isCRLF ? text.replace(/\n/g, '\r\n') : text, 'utf-8')

function replaceOrSkip(s, oldStr, newStr, label) {
  if (s.includes(newStr)) {
    console.log(`⏭️  ${label} — уже применено`)
    return s
  }
  if (!s.includes(oldStr)) {
    console.error(`\n❌ Не найден блок: ${label}`)
    console.error('Искали (первые 300):')
    console.error(oldStr.slice(0, 300))
    process.exit(1)
  }
  console.log(`✅ ${label}`)
  return s.replace(oldStr, newStr)
}

// ============================================================
// 1) config.js — LOD.reveal
// ============================================================
{
  const { text, isCRLF } = read('scripts/config.js')
  let s = text

  const OLD = `  /** Скорость «затухания» при переходе в 2D (1/с). */
  fadeIn: 6.4,

  /** Скорость «проявления» при переходе обратно в 3D (1/с). */
  fadeOut: 4.5,
})`

  const NEW = `  /** Скорость «затухания» при переходе в 2D (1/с). */
  fadeIn: 6.4,

  /** Скорость «проявления» при переходе обратно в 3D (1/с). */
  fadeOut: 4.5,

  /**
   * Порционные батчи для плавного перехода 3D ⇄ 2D.
   * Решают лаг при пересечении changeAltitude вверх: раньше все
   * 25 far-тайлов включались и все 76 3D-чанков выгружались в один
   * кадр. Теперь размазано на несколько кадров по фазам:
   *   far reveal  → unload 3D  →  overlay reveal
   */
  reveal: {
    farBatch: 5,
    overlayBatch: 6,
    unloadBatch: 10,
  },
})`

  s = replaceOrSkip(s, OLD, NEW, 'config.js / LOD.reveal')
  write('scripts/config.js', s, isCRLF)
}

// ============================================================
// 2) chunks/queue.js — убираем unload из refillChunkQueue
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/chunks/queue.js')
  let s = text

  // 2a) импорты — убираем unloadChunk и UNLOAD_MARGIN
  s = replaceOrSkip(
    s,
    `import {
  CHUNK_SIZE,
  LOAD_FWD_CHUNKS,
  LOAD_BACK_CHUNKS,
  LOAD_SIDE_CHUNKS,
  UNLOAD_MARGIN,
} from './constants.js'
import { chunks, PERSISTENT_CHUNKS, loadChunk, unloadChunk } from './store.js'`,
    `import {
  CHUNK_SIZE,
  LOAD_FWD_CHUNKS,
  LOAD_BACK_CHUNKS,
  LOAD_SIDE_CHUNKS,
} from './constants.js'
import { chunks, PERSISTENT_CHUNKS, loadChunk } from './store.js'`,
    'queue.js / imports'
  )

  // 2b) удаляем блок unload
  s = replaceOrSkip(
    s,
    `  const toUnload = []
  for (const key of chunks.keys()) {
    const [cs, czs] = key.split(',')
    const dx = +cs - cxi,
      dz = +czs - czi
    if (dx < -(LB + UNLOAD_MARGIN) || dx > LF + UNLOAD_MARGIN || Math.abs(dz) > LS + UNLOAD_MARGIN)
      toUnload.push(key)
  }
  for (const k of toUnload) unloadChunk(k)

  const padXf = LF + 1`,
    `  // NOTE: unload больше не делаем здесь — выгрузка 3D-чанков
  // вынесена в fade.js как порционная фаза (см. CFG.LOD.reveal.unloadBatch).
  // Так пик dispose не приходится на один кадр при пересечении changeAltitude.

  const padXf = LF + 1`,
    'queue.js / remove unload block'
  )

  write('scripts/views/chunks/queue.js', s, isCRLF)
}

// ============================================================
// 3) lod/fade.js — импорты + хелперы + фазовая логика
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/lod/fade.js')
  let s = text

  // 3a) импорты
  s = replaceOrSkip(
    s,
    `import { scene, fogU } from '../scene.js'`,
    `import { scene, fogU, camera } from '../scene.js'`,
    'fade.js / import camera'
  )
  s = replaceOrSkip(
    s,
    `import { chunks, PERSISTENT_CHUNKS } from '../chunks/index.js'`,
    `import { chunks, PERSISTENT_CHUNKS, unloadChunk } from '../chunks/index.js'`,
    'fade.js / import unloadChunk'
  )

  // 3b) хелперы после smoothstep
  s = replaceOrSkip(
    s,
    `function smoothstep(a, b, x) {
  if (x <= a) return 0
  if (x >= b) return 1
  const t = (x - a) / (b - a)
  return t * t * (3 - 2 * t)
}`,
    `function smoothstep(a, b, x) {
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
}`,
    'fade.js / reveal helpers'
  )

  // 3c) главный блок — заменяем bulk-toggle на фазовую логику
  const OLD_BLOCK = `  // ─── Ground fade у дальней плоскости ───
  const groundFade =
    1 - smoothstep(CFG.SPACE.groundFadeStart, CFG.SPACE.groundFadeEnd, rocketState.pos.y)
  const farOpacity = lod.fade * groundFade
  const overlayOpacity = getOverlayOpacity()

  if (overlayOpacity !== state.lastOverlayOpacity) {
    for (const c of state.overlayChunks.values()) {
      c.mat.opacity = overlayOpacity
      c.mesh.visible = overlayOpacity > 0.005
    }
    state.lastOverlayOpacity = overlayOpacity
  }

  if (farOpacity !== state.lastFarOpacity) {
    if (state.farGroundMat) state.farGroundMat.opacity = farOpacity
    const farVisible = farOpacity > 0.005
    for (const c of state.farTiles.values()) c.mesh.visible = farVisible
    state.lastFarOpacity = farOpacity
  }`

  const NEW_BLOCK = `  // ─── Ground fade у дальней плоскости ───
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
  state.lastOverlayOpacity = overlayOpacity`

  s = replaceOrSkip(s, OLD_BLOCK, NEW_BLOCK, 'fade.js / phased transition')

  write('scripts/views/lod/fade.js', s, isCRLF)
}

console.log('\n🎉 Готово. Проверь взлёт через changeAltitude.')