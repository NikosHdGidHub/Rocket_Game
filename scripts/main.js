/* ================================================================
   main.js — точка входа. Только init + главный цикл.
   Вся логика — в модулях (см. соседние файлы).
================================================================ */

// 0) Настройки — ОБЯЗАТЕЛЬНО первыми: их top-level side effect
//    применяет quality preset к CFG до чтения scene.js / chunks.js.
import './lib/settings.js'

// 1) Остальное
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
import * as Sounds from './lib/sounds.js'
import * as Sign from './sign.js'
import * as Debug from './debug.js'
import * as FpsMonitor from './services/fpsMonitor.js'

/* ================================================================
   1. Инициализация модулей (порядок важен!)
================================================================ */
Scene.init() // renderer / camera / sky / lights / ground
DayNight.init() // грузим сохранённое время суток и сразу применяем
Sign.init() // асинхронно грузит шрифт и добавляет надпись
Entities.init() // boss + rocket + chests
Sounds.init() //звуки

// Модалка: привязываем табы и кнопки (idempotent, можно вызвать до UI.init)
AchModal.init()
CardsModal.init({
  onBuy: (id) => Game.buyCard(id),
  onSell: (id) => Game.sellCard(id),
  canBuy: (id) => Game.canBuyCard(id),
  canSell: (id) => Game.canSellCard(id),
  getTradePreview: (id, delta) => Game.getCardTradePreview(id, delta),
})

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

Entities.resyncChests()
Entities.resyncGems()
Lod.setPhaseGetter(() => G.phase)

Chunks.init() // навешивает sky-fog на propMat
Lod.init() // создаёт farGroundMat (нужен groundTex)
Space.init() //  (создаёт звёзды и InstancedMesh сфер)

/* ================================================================
   2. Первичная загрузка с прогресс-баром.
================================================================ */
async function initialLoad() {
  Debug.init()
  window.__dbgChunks = Chunks.getStats
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

  // FPS-монитор запускаем ТОЛЬКО теперь — иначе warmup истекает
  // ещё во время прогрузки чанков, и первый же тик выдаёт ложный
  // «низкий FPS».
  let _fpsNoticeShown = false
  FpsMonitor.init({
    onAverage: (fps) => UI.updateFpsDisplay(fps),
    onLow: (fps, level) => {
      if (!_fpsNoticeShown) {
        _fpsNoticeShown = true
        const N = CFG.FPS.notification
        UI.showNotice(level === 'critical' ? N.criticalText : N.warnText, N.durationMs, N.color)
      }
      UI.showLowFpsBadge(fps)
    },
  })

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
const MAX_STEPS = 10 // до 10 шагов за кадр (~166 мс)

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
  const frameStart = performance.now()

  // ─── Физика: fixed step ───
  const tPhys = performance.now()
  accumulator += realDt
  let steps = 0
  while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
    time.gameTime += FIXED_DT
    Game.updatePhysics(FIXED_DT)
    accumulator -= FIXED_DT
    steps++
  }
  if (steps >= MAX_STEPS) accumulator = 0
  Debug.mark('physics', performance.now() - tPhys)

  // ─── Визуал: раз в кадр ───
  const tVis = performance.now()
  const alpha = accumulator / FIXED_DT
  const visualTime = time.gameTime - FIXED_DT + FIXED_DT * alpha
  Game.updateVisuals(realDt, alpha, visualTime)
  Debug.mark('visuals', performance.now() - tVis)

  let t = performance.now()
  Chunks.update()
  Debug.mark('chunks', performance.now() - t)

  t = performance.now()
  Lod.update(realDt)
  Debug.mark('lod', performance.now() - t)

  t = performance.now()
  DayNight.update(realDt)
  Debug.mark('daynight', performance.now() - t)

  t = performance.now()
  Space.update()
  Debug.mark('space', performance.now() - t)

  t = performance.now()
  UI.update()
  Debug.mark('ui', performance.now() - t)

  t = performance.now()
  Scene.updateScenery()
  Debug.mark('scenery', performance.now() - t)

  t = performance.now()
  Scene.render()
  Debug.mark('render', performance.now() - t)

  const total = performance.now() - frameStart
  Debug.mark('total', total)
  Debug.frame(realDt * 1000)
  FpsMonitor.frame(realDt * 1000)

  requestAnimationFrame(loop)
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

window.dbgQuality = async () => {
  const S = await import('./lib/settings.js')
  const Q = await import('./lib/quality.js')
  return {
    setting: S.settings.quality,
    resolved: S.settings._resolvedPreset,
    label: Q.getLabel(S.settings._resolvedPreset),
  }
}

/*
window.dbgOpenChestAt = Game.debugOpenChestAt
window.dbgGiveCard = Game.giveCard
window.dbgRemoveCard = Game.removeCard
window.dbgListCards = Game.listCardsDebug
window.dbgCanGive = (id) => {
  const r = Game.canGiveCardReason(id)
  console.log(r ? '⛔ ' + r : '✅ можно')
}*/
/*
window.dbgGiveGems = (n = 10) => {
  G.gems += n
  Game.saveProgress()
  CardsModal.refresh()
  console.log(`+${n} 💎 → всего ${G.gems}`)
}*/
