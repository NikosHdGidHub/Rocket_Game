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
import { G } from './state.js'

/* ================================================================
   1. Инициализация модулей (порядок важен!)
================================================================ */
Scene.init() // renderer / camera / sky / lights / ground
Entities.init() // boss + rocket + chests
UI.init({
  onLaunch: Game.startKick,
  onBuy: Game.buy,
  onReset: Game.resetProgress,
  upgrades: Game.UPGRADES,
  costOf: Game.costOf,
})
Game.init() // loadProgress + resetRocket + HUD

Entities.resyncChests() // ← теперь флаги сундуков актуальны

Lod.setPhaseGetter(() => G.phase)

Chunks.init() // навешивает sky-fog на propMat
Lod.init() // создаёт farGroundMat (нужен groundTex)

/* ================================================================
   2. Первичная загрузка с прогресс-баром.
================================================================ */
async function initialLoad() {
  const $loading = document.getElementById('loading')
  const $bar = document.getElementById('loadingBar')
  const $text = document.getElementById('loadingText')
  if ($loading) $loading.style.display = 'flex'

  // ---------- Считаем общий объём ----------
  const totalChunks = Chunks.countInitial()
  const totalFar = Lod.countInitialFar()
  const totalOverlays = Lod.countInitialOverlays()
  const total = totalChunks + totalFar + totalOverlays

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

  // ---------- 3) Overlay (точечные деревья) ----------
  label = 'Лес'
  await Lod.loadInitialOverlays((done) => {
    doneGlobal = totalChunks + totalFar + done
    setBar()
  })

  if ($loading) $loading.style.display = 'none'

  requestAnimationFrame(loop)
  setTimeout(() => UI.showToast('ПНИ РАКЕТУ! 🦵', CFG.UI.toastColors.upgrade), 400)
}

/* ================================================================
   3. Главный цикл.
================================================================ */
let last = performance.now()

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now

  Game.update(dt) // фазы босса, физика ракеты, камера, сундуки
  Chunks.update() // очередь 3D-чанков + persistent visibility
  Lod.update(dt) // LOD, fog-ellipse, far + overlay очереди
  UI.update() // HUD/панели по фазе
  Scene.updateScenery() // солнце и купол следуют за камерой

  Scene.render()
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
  // lod / rocketState локально не экспортируются напрямую — читаем через state
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
