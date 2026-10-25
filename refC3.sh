#!/usr/bin/env bash
set -e

# ============================================================
# 1. lib/debug.js — overlay + window.dbg* фасад
# ============================================================
cat > scripts/lib/debug.js <<'EOF'
/* ================================================================
   debug.js — overlay с FPS-метриками + фасад над window.dbg*.
   Включается через ?debug в URL или window.__dbgOn = true.
================================================================ */
import { renderer } from '../views/scene.js'
import * as Chunks from '../views/chunks/index.js'
import * as Lod from '../views/lod/index.js'
import * as DayNight from '../views/daynight.js'
import * as Space from '../views/space.js'
import * as Game from '../core/game.js'
import { G, lod, rocketState } from '../state.js'
import { settings } from './settings.js'
import * as Quality from './quality.js'
import { debugTerrainProfile } from '../world/world.js'

let _on = false
let _root = null

const _timers = {
  physics: 0,
  visuals: 0,
  chunks: 0,
  lod: 0,
  daynight: 0,
  space: 0,
  ui: 0,
  scenery: 0,
  render: 0,
  total: 0,
}

const _frameTimes = []
const _fpsWindow = 60
let _lastUpdate = 0

/* ================================================================
   OVERLAY
================================================================ */
function _initOverlay() {
  _root = document.createElement('div')
  _root.id = '__dbgOverlay'
  _root.style.cssText = `
    position: fixed; top: 8px; right: 8px; z-index: 99999;
    background: rgba(0,0,0,0.82); color: #7dffa0;
    font: 11px/1.5 ui-monospace, monospace;
    padding: 8px 10px; border-radius: 6px; pointer-events: none;
    white-space: pre; min-width: 210px; border: 1px solid #2a4a2a;
  `
  document.body.appendChild(_root)
}

export function enabled() {
  return _on
}

export function mark(name, ms) {
  if (!_on) return
  _timers[name] = (_timers[name] || 0) * 0.85 + ms * 0.15
}

export function frame(realDtMs) {
  if (!_on) return
  _frameTimes.push(realDtMs)
  if (_frameTimes.length > _fpsWindow) _frameTimes.shift()

  const now = performance.now()
  if (now - _lastUpdate < 250) return
  _lastUpdate = now

  let sum = 0
  let max = 0
  for (const t of _frameTimes) {
    sum += t
    if (t > max) max = t
  }
  const avg = sum / _frameTimes.length
  const fps = 1000 / avg

  const info = renderer.info
  const calls = info.render.calls
  const tris = info.render.triangles

  const total = _timers.total
  const pct = (v) => (total > 0 ? Math.round((v / total) * 100) + '%' : '—')

  let text =
    `FPS:   ${fps.toFixed(1)}   (avg ${avg.toFixed(1)}ms, max ${max.toFixed(1)}ms)\n` +
    `Frame: ${total.toFixed(1)}ms\n` +
    `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n` +
    `physics  ${_timers.physics.toFixed(2)}ms ${pct(_timers.physics)}\n` +
    `visuals  ${_timers.visuals.toFixed(2)}ms ${pct(_timers.visuals)}\n` +
    `chunks   ${_timers.chunks.toFixed(2)}ms ${pct(_timers.chunks)}\n` +
    `lod      ${_timers.lod.toFixed(2)}ms ${pct(_timers.lod)}\n` +
    `daynight ${_timers.daynight.toFixed(2)}ms\n` +
    `space    ${_timers.space.toFixed(2)}ms\n` +
    `ui       ${_timers.ui.toFixed(2)}ms\n` +
    `scenery  ${_timers.scenery.toFixed(2)}ms\n` +
    `render   ${_timers.render.toFixed(2)}ms ${pct(_timers.render)}\n` +
    `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n` +
    `draw calls: ${calls}\n` +
    `triangles:  ${(tris / 1000).toFixed(0)}k`

  try {
    const stats = window.__dbgChunks?.()
    if (stats) {
      text +=
        `\nchunks: ${stats.chunks}/${stats.persistentLoaded}\n` +
        `pool:   ${stats.poolBusy}/${stats.poolSize} busy\n` +
        `pending: ${stats.pending}`
    }
  } catch (_) {}

  _root.textContent = text
}

/* ================================================================
   window.dbg* — глобальные хелперы для консоли
================================================================ */
function _registerGlobalHelpers() {
  window.__dbgChunks = Chunks.getStats

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
    console.log(
      `lodFade=${lod.fade.toFixed(2)} in2DMode=${lod.in2D} ` +
        `altSmooth=${lod.altSmooth.toFixed(0)} ` +
        `rocketX=${rocketState.pos.x.toFixed(0)} rocketY=${rocketState.pos.y.toFixed(0)}`
    )
  }

  window.dbgPersistent = () => console.table(Chunks.debugPersistent())
  window.dbgDayNight = () => DayNight.debug()
  window.dbgSetDayTime = (t) => DayNight.debugSetTime(t)
  window.dbgSpace = () => console.log(Space.debug())
  window.dbgTerrain = (xs) => debugTerrainProfile(xs)

  window.dbgQuality = () => ({
    setting: settings.quality,
    resolved: settings._resolvedPreset,
    label: Quality.getLabel(settings._resolvedPreset),
  })

  window.dbgOpenChestAt = (x) => Game.debugOpenChestAt(x)
  window.dbgGiveCard = (id, opts) => Game.giveCard(id, opts)
  window.dbgRemoveCard = (id, opts) => Game.removeCard(id, opts)
  window.dbgListCards = () => Game.listCardsDebug()
  window.dbgCanGive = (id) => {
    const r = Game.canGiveCardReason(id)
    console.log(r ? '⛔ ' + r : '✅ можно')
  }
  window.dbgGiveGems = (n = 10) => {
    G.gems += n
    Game.saveProgress()
    import('../ui/cardsModal.js').then((CM) => CM.refresh())
    console.log(`+${n} 💎 → всего ${G.gems}`)
  }
}

/* ================================================================
   init
================================================================ */
export function init() {
  _on = new URLSearchParams(location.search).has('debug') || window.__dbgOn === true
  if (_on) _initOverlay()
  _registerGlobalHelpers()
}
EOF

# ============================================================
# 2. Удаляем старый debug.js
# ============================================================
rm scripts/debug.js

# ============================================================
# 3. Обновляем main.js — новый путь к debug + убираем старые
#    window.dbg* вручную (они теперь внутри lib/debug.js)
# ============================================================
sed -i "s|from './debug.js'|from './lib/debug.js'|g" scripts/main.js
sed -i "/^window.__dbgChunks = Chunks.getStats$/d" scripts/main.js

# Удаляем блок с window.dbg* в конце main.js (от "4. Debug-хелперы" до конца файла)
# Обрезаем блок "4. Debug-хелперы" из main.js (чистый bash, без Python/Node)
line=$(grep -n "4\. Debug-хелперы" scripts/main.js 2>/dev/null | head -1 | cut -d: -f1)
if [ -n "$line" ]; then
  start=$(head -n "$line" scripts/main.js | grep -nE "^/\* ={4,}" | tail -1 | cut -d: -f1)
  if [ -n "$start" ]; then
    head -n $((start - 1)) scripts/main.js > scripts/main.js.tmp
    mv scripts/main.js.tmp scripts/main.js
    echo "✅ Обрезано с строки $start"
  else
    echo "⚠️  Заголовок /* ===... не найден — правь main.js вручную"
  fi
else
  echo "ℹ️  Блока с '4. Debug-хелперы' в main.js нет"
fi

# ============================================================
# 4. Проверка
# ============================================================
echo ""
echo "=== lib/debug.js существует? ==="
ls -la scripts/lib/debug.js
echo ""
echo "=== scripts/debug.js удалён? ==="
if [ -f scripts/debug.js ]; then echo "❌ ещё есть"; else echo "✅ удалён"; fi
echo ""
echo "=== main.js: старые window.dbg* вычищены? ==="
if grep -n "window.dbg" scripts/main.js 2>/dev/null; then
  echo "⚠️ остались — удалите вручную"
else
  echo "✅ Нет"
fi
echo ""
echo "=== main.js: путь к debug обновлён? ==="
grep -n "lib/debug.js" scripts/main.js