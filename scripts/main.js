/* ================================================================
   main.js — точка входа. Только init + главный цикл.
   Вся логика — в модулях (см. соседние файлы).
================================================================ */
import * as CFG from './config.js'
import * as Scene from './scene.js'
import * as Chunks from './chunks.js'
import * as Lod from './lod.js'
import * as Entities from './entities.js'
import * as Game from './game.js'
import * as UI from './ui.js'
import * as Ach from './achievements.js'
import * as AchModal from './achievementsModal.js'
import * as CardsModal from './cardsModal.js'
import * as DayNight from './daynight.js'
import * as Space from './space.js'
import { G, time } from './state.js'
import * as Abilities from './abilities.js'
import * as Sounds from './sounds.js'

/* ================================================================
   1. Инициализация модулей (порядок важен!)
================================================================ */
Scene.init() // renderer / camera / sky / lights / ground
DayNight.init() // грузим сохранённое время суток и сразу применяем
Entities.init() // boss + rocket + chests
Sounds.init() //звуки

// Модалка: привязываем табы и кнопки (idempotent, можно вызвать до UI.init)
AchModal.init()
CardsModal.init()

UI.init({
  onLaunch: Game.startKick,
  onBuy: Game.buy,
  onReset: Game.resetProgress,
  onAchievements: AchModal.open, // ← открытие модалки по 🏆
  onActivateAbility: Abilities.activate,
  upgrades: Game.UPGRADES,
  costOf: Game.costOf,
})

Ach.onChange((ach, milestone) => {
  UI.showAchievementPopup(ach, milestone)
  // Звук теперь играет внутри UI.drainAchQueue —
  // синхронно с показом попапа. Здесь не дублируем.
  Game.saveProgress()
})

Game.init() // loadProgress + resetRocket + HUD

Abilities.syncFromCards() // восстановить level из G.cards (из сейва)

/* ================================================================
   🧪 DEBUG: тестовая выдача способности «Форсаж»
   Удалить перед релизом.
   ================================================================ */
/*function dbgGiveForsage(level = 1, showPopup = false) {
  const maxLv = CFG.ABILITIES.forsage.levels.length
  const lv = Math.max(1, Math.min(level, maxLv))
  G.cards.forsage = Math.max(G.cards.forsage || 0, lv)
  Abilities.onCardObtained('forsage')
  if (showPopup) {
    const card = CFG.CARDS.find((c) => c.key === 'forsage')
    if (card) UI.showCardPopup(card)
  }
  Game.saveProgress()
  console.log(`[DEBUG] Форсаж выдан: level=${G.abilities.forsage.level}, cards=${G.cards.forsage}`)
}

window.dbgGiveForsage = dbgGiveForsage
window.dbgRemoveForsage = () => {
  G.cards.forsage = 0
  Abilities.syncFromCards()
  const a = G.abilities.forsage
  a.active = false
  a.activeEnd = 0
  a.cooldownEnd = 0
  Game.saveProgress()
  console.log('[DEBUG] Форсаж убран')
}

// Автовыдача при старте (молча, без попапа) — чтобы сразу тестить.
// Убрать/закомментировать, когда тест закончится.
if (!G.abilities.forsage.level) {
  dbgGiveForsage(1, false)
  console.log('🧪 Форсаж автоматически выдан для теста')
}*/

Entities.resyncChests() // ← теперь флаги сундуков актуальны

Lod.setPhaseGetter(() => G.phase)

Chunks.init() // навешивает sky-fog на propMat
Lod.init() // создаёт farGroundMat (нужен groundTex)
Space.init() //  (создаёт звёзды и InstancedMesh сфер)

/* ================================================================
   2. Первичная загрузка с прогресс-баром.
================================================================ */
async function initialLoad() {
  const $loading = document.getElementById('loading')
  const $bar = document.getElementById('loadingBar')
  const $text = document.getElementById('loadingText')
  if ($loading) $loading.style.display = 'flex'

  // ---------- Считаем объём: чанки + дальние тайлы ----------
  // Overlay НЕ считаем — загрузим их в фоне после старта.
  const totalChunks = Chunks.countInitial()
  const totalFar = Lod.countInitialFar()
  const total = totalChunks + totalFar

  let label = 'Загрузка мира'
  let doneGlobal = 0
  const setBar = () => {
    const pct = total > 0 ? (doneGlobal / total) * 100 : 0
    if ($bar) $bar.style.width = pct.toFixed(1) + '%'
    if ($text) $text.textContent = `${label}… ${doneGlobal} / ${total}`
  }
  setBar()

  // ---------- 1) 3D-чанки ----------
  label = 'Загрузка мира'
  await Chunks.loadInitial((done) => {
    doneGlobal = done
    setBar()
  })

  // ---------- 2) Дальние тайлы ----------
  label = 'Дальний рельеф'
  await Lod.loadInitialFar((done) => {
    doneGlobal = totalChunks + done
    setBar()
  })

  // ---------- 3) Overlay — в фоне через главный цикл ----------
  // Lod.update() сам вызывает refillOverlayChunks() при первом
  // кадре (т.к. _lastOverlay.x = NaN). processLODWork тратит
  // 3 мс/кадр на их загрузку. За 20–30 с до первого 2D-режима
  // они успеют загрузиться.

  if ($loading) $loading.style.display = 'none'

  requestAnimationFrame(loop)
  setTimeout(() => UI.showToast('ПНИ РАКЕТУ! 🦵', CFG.UI.toastColors.upgrade), 400)
}

/* ================================================================
   3. Главный цикл (fixed timestep).

   Физика всегда идёт шагами FIXED_DT = 1/60.
   Рендер и «плавные» модули (LOD, туман, HUD) — раз в кадр по realDt.
   Так траектория полёта ОДИНАКОВА на 30, 60 и 144 fps.
================================================================ */
const FIXED_DT = 1 / 60 // фиксированный шаг физики
const MAX_FRAME_DT = 0.1 // защита от «спирали смерти» при лагах
const MAX_STEPS = 6 // не больше 6 шагов за кадр (~100 мс)

let last = performance.now()
let accumulator = 0
let firstFrame = true
//для отладки
let lastSteps = -1

function loop(now) {
  if (firstFrame) {
    last = now
    firstFrame = false
  }

  const realDt = Math.min(MAX_FRAME_DT, (now - last) / 1000)
  last = now

  // ─── Физика: fixed step ───
  accumulator += realDt
  let steps = 0
  while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
    time.gameTime += FIXED_DT
    Game.updatePhysics(FIXED_DT)
    accumulator -= FIXED_DT
    steps++
  }
  if (steps >= MAX_STEPS) accumulator = 0

  // ─── Визуал: раз в кадр ───
  const alpha = accumulator / FIXED_DT
  const visualTime = time.gameTime - FIXED_DT + FIXED_DT * alpha
  Game.updateVisuals(realDt, alpha, visualTime)

  Chunks.update()
  Lod.update(realDt)
  DayNight.update(realDt)
  Space.update()
  UI.update()
  Scene.updateScenery()

  Scene.render()
  requestAnimationFrame(loop)

  // в конце loop:
  /*if (steps !== lastSteps) {
    console.log(`steps=${steps} dt=${(realDt * 1000).toFixed(1)}ms`)
    lastSteps = steps
  }*/
}

initialLoad()

/* ================================================================
   4. Debug-хелперы.
================================================================ */
window.dbg = () => {
  const c = Chunks.getStats()
  const l = Lod.getStats()
  console.log(
    `chunks=${c.chunks} (persistent=${c.persistentLoaded}/${c.persistentTotal}) ` +
      `propsCache=${c.propsCache} ` +
      `farTiles=${l.farTiles} ` +
      `overlayChunks=${l.overlayChunks} ` +
      `pendingFar=${l.pendingFar} pendingOv=${l.pendingOverlays}`
  )
  import('./state.js').then((s) => {
    console.log(
      `lodFade=${s.lod.fade.toFixed(2)} in2DMode=${s.lod.in2D} ` +
        `altSmooth=${s.lod.altSmooth.toFixed(0)} ` +
        `rocketX=${s.rocketState.pos.x.toFixed(0)} rocketY=${s.rocketState.pos.y.toFixed(0)}`
    )
  })
}

window.dbgPersistent = () => {
  console.table(Chunks.debugPersistent())
}

window.dbgDayNight = () => DayNight.debug()
window.dbgSetDayTime = (t) => DayNight.debugSetTime(t)
window.dbgSpace = () => console.log(Space.debug())

/*
window.dbgOpenChestAt = Game.debugOpenChestAt
window.dbgGiveCard = Game.giveCard
window.dbgRemoveCard = Game.removeCard
window.dbgListCards = Game.listCardsDebug
window.dbgCanGive = (id) => {
  const r = Game.canGiveCardReason(id)
  console.log(r ? '⛔ ' + r : '✅ можно')
}*/
