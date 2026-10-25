#!/usr/bin/env bash
set -e

# ============================================================
# 1. ui/hud.js
# ============================================================
cat > scripts/ui/hud.js <<'EOF'
/* ================================================================
   hud.js — HUD: счётчики, полоса топлива, сундук-прогресс, угол, форсаж.
================================================================ */
import { G } from '../state.js'
import * as Abilities from '../abilities.js'

const $dist = document.getElementById('dist')
const $chestProgress = document.getElementById('chestProgress')
const $chestFill = document.getElementById('chestFill')
const $chestDist = document.getElementById('chestDist')
const $coins = document.getElementById('coins')
const $best = document.getElementById('best')
const $fuelFill = document.getElementById('fuelFill')
const $fuelText = document.getElementById('fuelText')
const $alignText = document.getElementById('alignText')
const $forsageBtn = document.getElementById('forsageBtn')

let _lastDist = -1
let _lastCoins = -1
let _lastBest = -1
let _lastFuel = -1
let _lastForsageSig = null
let _lastAlignText = ''
let _lastAlignColor = ''

export function updateHUD() {
  if (G.coins !== _lastCoins) {
    _lastCoins = G.coins
    $coins.textContent = G.coins
  }
  const b = Math.floor(G.best)
  if (b !== _lastBest) {
    _lastBest = b
    $best.textContent = b
  }
}

export function setHUDDist(x) {
  const v = Math.max(0, Math.floor(x))
  if (v === _lastDist) return
  _lastDist = v
  $dist.textContent = v
}

export function setAlignText(deg, state) {
  const text = state.aligned ? '🎯 0°' : Math.round(deg) + '°'
  if (text !== _lastAlignText) {
    $alignText.textContent = text
    _lastAlignText = text
  }
  if (state.textColor !== _lastAlignColor) {
    $alignText.style.color = state.textColor
    _lastAlignColor = state.textColor
  }
}

export function updateChestProgress(distance, progress, near, missed = false) {
  if (distance === null) {
    $chestProgress.classList.remove('on', 'near', 'missed')
    return
  }

  $chestProgress.classList.add('on')
  $chestFill.style.width = (Math.max(0, Math.min(1, progress)) * 100).toFixed(1) + '%'

  const absDist = Math.abs(distance)
  let text
  if (absDist < 1000) {
    text = (distance < 0 ? '-' : '') + Math.round(absDist) + ' м'
  } else if (absDist < 10000) {
    text = (distance < 0 ? '-' : '') + (absDist / 1000).toFixed(1) + ' км'
  } else {
    text = (distance < 0 ? '-' : '') + Math.round(absDist / 1000) + ' км'
  }
  $chestDist.textContent = text

  $chestProgress.classList.toggle('near', !!near && !missed)
  $chestProgress.classList.toggle('missed', !!missed)
}

export function updateFuelBar(fuel, maxFuel) {
  if (fuel !== _lastFuel) {
    _lastFuel = fuel
    $fuelFill.style.width = (fuel / maxFuel) * 100 + '%'
    $fuelText.textContent = fuel.toFixed(1)
  }
}

export function updateForsageButton() {
  if (!$forsageBtn) return
  const st = Abilities.getState('forsage')
  if (!st) return

  let cls, fill
  if (!st.unlocked) {
    cls = 'blocked'
    fill = 0
  } else if (st.active) {
    cls = 'active'
    fill = st.activeProgress * 100
  } else if (st.ready) {
    cls = 'ready'
    fill = 100
  } else {
    cls = 'cooldown'
    fill = st.cooldownProgress * 100
  }

  const sig = cls + ':' + Math.round(fill)
  if (sig === _lastForsageSig) return
  _lastForsageSig = sig

  $forsageBtn.className = 'forsage-btn ' + cls
  $forsageBtn.style.setProperty('--fill', fill.toFixed(1) + '%')
}
EOF

# ============================================================
# 2. ui/shop.js
# ============================================================
cat > scripts/ui/shop.js <<'EOF'
/* ================================================================
   shop.js — магазин апгрейдов в нижней панели.
================================================================ */
import { G } from '../state.js'

const $shop = document.getElementById('shop')

let _onBuy = null
let _upgrades = []
let _costOf = () => 0

export function init({ onBuy, upgrades, costOf }) {
  _onBuy = onBuy
  _upgrades = upgrades
  _costOf = costOf
}

export function renderShop() {
  $shop.innerHTML = ''
  for (const u of _upgrades) {
    const lvl = G.upgrades[u.key]
    const max = u.maxLevel ?? Infinity
    const isMax = lvl >= max
    const cost = isMax ? 0 : _costOf(u)
    const can = !isMax && G.coins >= cost

    const btn = document.createElement('button')
    btn.className = 'upg' + (can ? '' : ' disabled') + (isMax ? ' maxed' : '')
    btn.disabled = isMax
    btn.innerHTML = `
      <div class="u-main">
        <div class="u-name">
          <span class="u-lvl">${lvl}</span>
          <span class="u-icon">${u.icon}</span>
          <span class="u-title">${u.name}</span>
        </div>
        <div class="u-desc">${isMax ? 'Максимум' : u.desc}</div>
      </div>
      <div class="u-cost">${isMax ? 'MAX' : cost + ' 💲'}</div>`
    btn.addEventListener('click', () => _onBuy && _onBuy(u))
    $shop.appendChild(btn)
  }
}
EOF

# ============================================================
# 3. ui/toast.js
# ============================================================
cat > scripts/ui/toast.js <<'EOF'
/* ================================================================
   toast.js — всплывающие сообщения (крупный центр + мелкий notice).
================================================================ */
import * as CFG from '../config.js'

const $toast = document.getElementById('toast')
let toastTimer

export function showToast(text, color = CFG.UI.toastColors.default) {
  $toast.textContent = text
  $toast.style.color = color
  $toast.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $toast.classList.remove('on'), CFG.UI.toastDuration)
}

export function showLandToast(dist, isRecord) {
  $toast.innerHTML = ''

  if (isRecord) {
    const $icon = document.createElement('div')
    $icon.className = 'toast-icon'
    $icon.textContent = '🏆'
    $toast.appendChild($icon)
  }

  const $text = document.createElement('div')
  $text.textContent = `${Math.floor(dist)} м`
  $toast.appendChild($text)

  $toast.style.color = isRecord ? CFG.UI.toastColors.upgrade : CFG.UI.toastColors.land
  $toast.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $toast.classList.remove('on'), CFG.UI.toastDuration)
}

let _noticeTimer = null
export function showNotice(text, durationMs = 3500, color = null) {
  const $notice = document.getElementById('notice')
  if (!$notice) return
  $notice.textContent = text
  if (color) $notice.style.color = color
  else $notice.style.removeProperty('color')
  $notice.classList.add('on')
  clearTimeout(_noticeTimer)
  _noticeTimer = setTimeout(() => $notice.classList.remove('on'), durationMs)
}
EOF

# ============================================================
# 4. ui/cardPopup.js
# ============================================================
cat > scripts/ui/cardPopup.js <<'EOF'
/* ================================================================
   cardPopup.js — попап выбора карточки.
================================================================ */
import { G } from '../state.js'
import * as CardsModal from './cardsModal.js'

let _currentCardCloseHandler = null

export function showCardChoices(cards, onPick, opts = {}) {
  CardsModal.close()

  const $popup = document.getElementById('cardPopup')
  const $container = document.getElementById('cardChoices')
  if (!$popup || !$container) return

  if (_currentCardCloseHandler) {
    $popup.removeEventListener('click', _currentCardCloseHandler)
    _currentCardCloseHandler = null
  }

  $container.innerHTML = ''
  const single = cards.length === 1

  for (const card of cards) {
    const el = createCardElement(card, single, opts)
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      closeCardPopup()
      onPick(card)
    })
    $container.appendChild(el)
  }

  $popup.classList.add('on')

  if (single) {
    _currentCardCloseHandler = () => {
      closeCardPopup()
      onPick(cards[0])
    }
    $popup.addEventListener('click', _currentCardCloseHandler)
  }
}

function closeCardPopup() {
  const $popup = document.getElementById('cardPopup')
  if ($popup) $popup.classList.remove('on')
  if (_currentCardCloseHandler && $popup) {
    $popup.removeEventListener('click', _currentCardCloseHandler)
    _currentCardCloseHandler = null
  }
}

function createCardElement(card, isSingle, opts = {}) {
  const isUpgrade =
    opts.isUpgradeOverride !== undefined ? opts.isUpgradeOverride : (G.cards[card.id] || 0) >= 1

  const el = document.createElement('div')
  el.className = 'card'
  if (card.color != null) {
    el.style.borderColor = '#' + card.color.toString(16).padStart(6, '0')
  }

  let label
  if (isSingle) label = isUpgrade ? 'УЛУЧШЕНИЕ' : 'РЕДКАЯ НАХОДКА'
  else label = 'ВЫБЕРИ КАРТУ'

  let effectsHtml = ''
  if (card.special) {
    const descText = isUpgrade && card.desc_upgrade ? card.desc_upgrade : card.desc_buff
    if (descText) effectsHtml = `<div class="card-buff">${descText}</div>`
  } else {
    if (card.desc_buff) effectsHtml += `<div class="card-buff">▲ ${card.desc_buff}</div>`
    if (card.desc_debuff) effectsHtml += `<div class="card-debuff">▼ ${card.desc_debuff}</div>`
  }

  const hint = isSingle ? 'тап — закрыть' : 'тап — выбрать'

  el.innerHTML = `
    <div class="card-glow"></div>
    <div class="card-label">${label}</div>
    <div class="card-icon">${card.icon}</div>
    <div class="card-name">${card.name}</div>
    ${card.variant ? `<div class="card-variant">${card.variant}</div>` : ''}
    <div class="card-effects">${effectsHtml}</div>
    <div class="card-hint">${hint}</div>
  `
  return el
}
EOF

# ============================================================
# 5. ui/input.js
# ============================================================
cat > scripts/ui/input.js <<'EOF'
/* ================================================================
   input.js — клавиатура, тач-кнопки, canvas pointer, кнопки запуска.
================================================================ */
import { G, input } from '../state.js'
import { renderer } from '../views/scene.js'

let _onLaunch = null
let _onReset = null
let _onAchievements = null
let _onActivateAbility = null

function bindHold(el, setter) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    setter(true)
  })
  el.addEventListener('pointerup', () => setter(false))
  el.addEventListener('pointerleave', () => setter(false))
  el.addEventListener('pointercancel', () => setter(false))
}

export function init({ onLaunch, onReset, onAchievements, onActivateAbility }) {
  _onLaunch = onLaunch
  _onReset = onReset
  _onAchievements = onAchievements
  _onActivateAbility = onActivateAbility

  const $pushBtn = document.getElementById('pushBtn')
  const $rotUp = document.getElementById('rotUp')
  const $rotDown = document.getElementById('rotDown')
  const $forsageBtn = document.getElementById('forsageBtn')
  const $launch = document.getElementById('launch')

  addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault()
      input.boost = true
      if (!e.repeat && (G.phase === 'ready' || G.phase === 'landed')) {
        _onLaunch && _onLaunch()
      }
    }
    if (e.code === 'KeyF') {
      e.preventDefault()
      if (!e.repeat) _onActivateAbility && _onActivateAbility('forsage')
    }
    if (e.code === 'KeyW') {
      input.keys.W = true
      e.preventDefault()
    }
    if (e.code === 'KeyS') {
      input.keys.S = true
      e.preventDefault()
    }
  })

  addEventListener('keyup', (e) => {
    if (e.code === 'Space') input.boost = false
    if (e.code === 'KeyW') input.keys.W = false
    if (e.code === 'KeyS') input.keys.S = false
  })

  bindHold($rotUp, (v) => (input.touch.W = v))
  bindHold($rotDown, (v) => (input.touch.S = v))
  bindHold($pushBtn, (v) => (input.boost = v))
  if ($forsageBtn) {
    $forsageBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      _onActivateAbility && _onActivateAbility('forsage')
    })
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (G.phase === 'ready' || G.phase === 'landed') {
      _onLaunch && _onLaunch()
      return
    }
    if (G.phase === 'fly' && e.pointerType === 'mouse') {
      input.boost = true
    }
  })
  addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') input.boost = false
  })
  addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'mouse') input.boost = false
  })

  $launch.addEventListener('click', (e) => {
    e.stopPropagation()
    if (G.phase === 'ready' || G.phase === 'landed') _onLaunch && _onLaunch()
  })

  document.getElementById('resetBtn').addEventListener('click', (e) => {
    e.stopPropagation()
    _onReset && _onReset()
  })

  const $achBtn = document.getElementById('achBtn')
  if ($achBtn) {
    $achBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      _onAchievements && _onAchievements()
    })
  }
}
EOF

# ============================================================
# 6. ui/settingsPanel.js
# ============================================================
cat > scripts/ui/settingsPanel.js <<'EOF'
/* ================================================================
   settingsPanel.js — панель ⚙️: качество, FPS, звук, GPU-hint.
================================================================ */
import * as CFG from '../config.js'
import { G } from '../state.js'
import { renderer } from '../views/scene.js'
import * as Settings from '../lib/settings.js'
import * as Sounds from '../lib/sounds.js'
import * as Quality from '../lib/quality.js'
import * as ConfirmModal from './confirmModal.js'
import { showToast } from './toast.js'

export function init() {
  const $settingsBtn = document.getElementById('settingsBtn')
  const $settingsPanel = document.getElementById('settingsPanel')
  const $settingsClose = document.getElementById('settingsClose')

  /* ---------- Quality ---------- */
  const $qualityGroup = document.getElementById('qualityBtnGroup')
  const $qualityAutoHint = document.getElementById('qualityAutoHint')
  const $qualityAutoResolved = document.getElementById('qualityAutoResolved')
  const $qualityDesc = document.getElementById('qualityDesc')

  function refreshQualityUI() {
    if (!$qualityGroup) return
    const current = Settings.settings.quality
    const resolved = Settings.settings._resolvedPreset
    const btns = $qualityGroup.querySelectorAll('.settings-qbtn')
    btns.forEach((b) => {
      b.classList.toggle('active', b.dataset.value === current)
    })
    if ($qualityAutoHint && $qualityAutoResolved) {
      if (current === 'auto') {
        $qualityAutoHint.hidden = false
        $qualityAutoResolved.textContent = Quality.getLabel(resolved)
      } else {
        $qualityAutoHint.hidden = true
      }
    }
    if ($qualityDesc) $qualityDesc.textContent = Quality.getDesc(resolved)
  }

  if ($qualityGroup) {
    refreshQualityUI()
    $qualityGroup.addEventListener('click', async (e) => {
      const btn = e.target.closest('.settings-qbtn')
      if (!btn) return
      const nextId = btn.dataset.value
      if (!nextId) return
      const currentId = Settings.settings.quality
      if (nextId === currentId) return

      const currentResolved = Quality.resolvePreset(currentId)
      const nextResolved = Quality.resolvePreset(nextId)

      if (currentResolved === nextResolved) {
        Settings.settings.quality = nextId
        Settings.save()
        refreshQualityUI()
        showToast(
          `Качество: ${nextId === 'auto' ? 'Авто' : Quality.getLabel(nextResolved)}`,
          CFG.UI.toastColors.upgrade
        )
        return
      }

      const lines = Quality.describeDiff(currentResolved, nextResolved)
      let bodyHtml = `<p>Применить пресет «<b>${Quality.getLabel(nextResolved)}</b>»?</p>`
      if (lines.length > 0) {
        bodyHtml += '<ul>' + lines.map((l) => `<li>${l}</li>`).join('') + '</ul>'
      } else {
        bodyHtml += '<p><i>Визуальных изменений не будет.</i></p>'
      }
      const inFlight = G.phase !== 'ready' && G.phase !== 'landed'
      if (inFlight) {
        bodyHtml += '<p style="color:#ff9f1a"><b>⚠️ Текущий полёт будет прерван.</b></p>'
      }
      bodyHtml += '<p style="opacity:0.65">Игра перезагрузится.</p>'

      const ok = await ConfirmModal.confirm({
        title: 'Смена качества графики',
        body: bodyHtml,
        confirmText: 'Применить и перезагрузить',
        cancelText: 'Отмена',
      })

      if (!ok) {
        refreshQualityUI()
        return
      }

      Settings.settings.quality = nextId
      Settings.save()
      showToast('Применяем… 🔄', CFG.UI.toastColors.upgrade)
      setTimeout(() => location.reload(), 350)
    })
  }

  /* ---------- FPS toggle ---------- */
  const $showFpsToggle = document.getElementById('showFpsToggle')
  const $fpsCounter = document.getElementById('fpsCounter')
  function applyFpsVisibility() {
    if (!$fpsCounter) return
    $fpsCounter.classList.toggle('hidden', !Settings.settings.showFps)
  }
  if ($showFpsToggle) {
    $showFpsToggle.checked = Settings.settings.showFps
    $showFpsToggle.addEventListener('change', () => {
      Settings.settings.showFps = $showFpsToggle.checked
      Settings.save()
      applyFpsVisibility()
    })
  }
  applyFpsVisibility()

  /* ---------- Sounds ---------- */
  const $soundVolume = document.getElementById('soundVolume')
  if ($soundVolume) {
    const saved = Settings.settings.soundVolume
    const initial = typeof saved === 'number' ? saved : CFG.SOUNDS.masterVolume
    $soundVolume.value = Math.round(initial * 100)
    let volumeDirty = false
    $soundVolume.addEventListener('input', () => {
      const v = +$soundVolume.value / 100
      Settings.settings.soundVolume = v
      Sounds.setMasterVolume(v)
      if (!volumeDirty) {
        volumeDirty = true
        setTimeout(() => {
          Settings.save()
          volumeDirty = false
        }, 250)
      }
    })
    $soundVolume.addEventListener('change', () => {
      Sounds.play('achStage')
    })
  }

  const $soundEnabledToggle = document.getElementById('soundEnabledToggle')
  if ($soundEnabledToggle) {
    $soundEnabledToggle.checked = Settings.settings.soundEnabled
    $soundEnabledToggle.addEventListener('change', () => {
      Settings.settings.soundEnabled = $soundEnabledToggle.checked
      Settings.save()
      if ($soundEnabledToggle.checked) Sounds.play('achStage')
    })
  }

  /* ---------- GPU hint ---------- */
  const $gpuHint = document.getElementById('gpuHint')
  const $gpuHintStatus = document.getElementById('gpuHintStatus')
  const $gpuHintToggle = document.getElementById('gpuHintToggle')
  const $gpuHintBody = document.getElementById('gpuHintBody')
  const $gpuHintArrow = document.getElementById('gpuHintArrow')

  if ($gpuHint && CFG.GPU_HINT.enabled) {
    try {
      const gl = renderer.getContext()
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      const rendererStr = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ''
      if (rendererStr && CFG.GPU_HINT.integratedPattern.test(rendererStr)) {
        const m = rendererStr.match(/ANGLE \([^,]+,\s*(.+?)\s*(?:\(|Direct|,|$)/)
        const display = m ? m[1] : 'встроенная графика'
        $gpuHintStatus.textContent = `⚠️ Сейчас: ${display} (встроенная — вероятная причина лагов)`
        $gpuHint.hidden = false
      }
    } catch (e) {
      console.warn('gpu hint: не удалось определить renderer:', e)
    }
  }

  if ($gpuHintToggle && $gpuHintBody && $gpuHintArrow) {
    $gpuHintToggle.addEventListener('click', () => {
      const show = $gpuHintBody.hidden
      $gpuHintBody.hidden = !show
      $gpuHintArrow.textContent = show ? '▾' : '▸'
    })
  }

  if ($settingsBtn && $settingsPanel) {
    $settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      $settingsPanel.classList.add('on')
    })
    $settingsPanel.addEventListener('click', (e) => {
      if (e.target === $settingsPanel) $settingsPanel.classList.remove('on')
    })
  }
  if ($settingsClose && $settingsPanel) {
    $settingsClose.addEventListener('click', (e) => {
      e.stopPropagation()
      $settingsPanel.classList.remove('on')
    })
  }
}
EOF

# ============================================================
# 7. ui/achievementsPopup.js
# ============================================================
cat > scripts/ui/achievementsPopup.js <<'EOF'
/* ================================================================
   achievementsPopup.js — очередь попапов достижений + FPS-виджет.
================================================================ */
import * as CFG from '../config.js'
import * as Sounds from '../lib/sounds.js'

const achQueue = []
let achBusy = false

export function showAchievementPopup(ach, milestone = null) {
  achQueue.push({ ach, milestone })
  if (!achBusy) drainAchQueue()
}

function drainAchQueue() {
  if (achQueue.length === 0) {
    achBusy = false
    return
  }
  const $container = document.getElementById('achToast')
  if (!$container) {
    achBusy = false
    return
  }

  achBusy = true
  const { ach, milestone } = achQueue.shift()

  const $el = document.createElement('div')
  $el.className = 'ach-toast tier-' + ach.tier

  const descHtml = ach.desc
    ? `<div class="ach-toast-desc">
         <span class="ach-toast-desc-text">${ach.desc}</span>
         ${
           milestone
             ? `<span class="ach-toast-desc-sep">—</span><span class="ach-toast-milestone">${milestone.label}</span>`
             : ''
         }
       </div>`
    : ''

  $el.innerHTML = `
    <div class="ach-toast-icon">${ach.icon}</div>
    <div class="ach-toast-text">
      <div class="ach-toast-label">Достижение</div>
      <div class="ach-toast-name">${ach.name}</div>
      ${descHtml}
    </div>`
  $container.appendChild($el)

  Sounds.play(milestone ? 'achStage' : 'ach')

  setTimeout(() => {
    $el.classList.add('out')
    setTimeout(() => {
      $el.remove()
      drainAchQueue()
    }, 380)
  }, 2500)
}

let _lastFpsValue = -1

export function updateFpsDisplay(avgFps) {
  const $fpsValue = document.getElementById('fpsValue')
  const $counter = document.getElementById('fpsCounter')
  if (!$fpsValue || !$counter) return
  const v = Math.round(avgFps)
  if (v !== _lastFpsValue) {
    _lastFpsValue = v
    $fpsValue.textContent = v
  }
  const F = CFG.FPS
  $counter.classList.toggle('warn', v < F.warnThreshold && v >= F.criticalThreshold)
  $counter.classList.toggle('critical', v < F.criticalThreshold)
}

let _lastLowFpsShown = -1

export function showLowFpsBadge(avgFps) {
  const $badge = document.getElementById('qualityFpsBadge')
  if (!$badge) return
  const v = Math.round(avgFps)
  if (v === _lastLowFpsShown && !$badge.hidden) return
  _lastLowFpsShown = v
  $badge.hidden = false
  $badge.innerHTML = `⚠️ Низкий FPS: <b>~${v}</b>. Рекомендуем снизить качество.`
}
EOF

# ============================================================
# 8. ui/index.js
# ============================================================
cat > scripts/ui/index.js <<'EOF'
/* ================================================================
   ui/index.js — публичный API UI: init + update + re-exports.
================================================================ */
import { G } from '../state.js'
import * as Shop from './shop.js'
import * as Input from './input.js'
import * as SettingsPanel from './settingsPanel.js'
import { updateForsageButton } from './hud.js'

export {
  updateHUD, setHUDDist, setAlignText, updateChestProgress,
  updateFuelBar, updateForsageButton,
} from './hud.js'
export { renderShop } from './shop.js'
export { showToast, showLandToast, showNotice } from './toast.js'
export { showCardChoices } from './cardPopup.js'
export { showAchievementPopup, updateFpsDisplay, showLowFpsBadge } from './achievementsPopup.js'

let _lastInFlight = null

export function init(callbacks) {
  Shop.init({
    onBuy: callbacks.onBuy,
    upgrades: callbacks.upgrades,
    costOf: callbacks.costOf,
  })
  Input.init({
    onLaunch: callbacks.onLaunch,
    onReset: callbacks.onReset,
    onAchievements: callbacks.onAchievements,
    onActivateAbility: callbacks.onActivateAbility,
  })
  SettingsPanel.init()
}

export function update() {
  updateForsageButton()
  const inFlight = G.phase === 'fly'
  if (inFlight === _lastInFlight) return
  _lastInFlight = inFlight

  const $boostUI = document.getElementById('boostUI')
  const $helpText = document.getElementById('helpText')
  const $touchUI = document.getElementById('touchControls')
  const $launch = document.getElementById('launch')
  const $shop = document.getElementById('shop')

  if (inFlight) {
    $boostUI.classList.add('on')
    $helpText.classList.add('on')
    $touchUI.classList.remove('hidden')
  } else {
    $boostUI.classList.remove('on')
    $helpText.classList.remove('on')
    $touchUI.classList.add('hidden')
  }
  const panelVisible = G.phase === 'ready' || G.phase === 'landed'
  $launch.classList.toggle('hidden', !panelVisible)
  $shop.style.display = panelVisible ? '' : 'none'
}
EOF

# ============================================================
# 9. Удаляем старый ui.js, обновляем импорты
# ============================================================
rm scripts/ui.js
sed -i "s|from './ui.js'|from './ui/index.js'|g" scripts/main.js

# ============================================================
# 10. Проверка
# ============================================================
echo ""
echo "=== ui/ ==="
ls -la scripts/ui/
echo ""
echo "=== Старые импорты ui.js? ==="
if grep -rn "from './ui.js'\|from '../ui.js'" scripts/ 2>/dev/null; then
  echo "❌ НАЙДЕНЫ"
else
  echo "✅ Нет"
fi