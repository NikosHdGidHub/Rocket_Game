/* ================================================================
   ui.js — DOM: HUD, магазин, toast, карточки, ввод.
   Экспортирует display-функции для game.js.
   Экшены (launch/buy/reset) вызываются через callbacks из init().
================================================================ */
import * as CFG from './config.js'
import { G, input } from './state.js'
import { renderer } from './scene.js'
import * as Settings from './settings.js'
import * as Sounds from './sounds.js'
import * as Abilities from './abilities.js'

/* ---------- Кэши DOM-элементов ---------- */
const $dist = document.getElementById('dist')
const $chestProgress = document.getElementById('chestProgress')
const $chestFill = document.getElementById('chestFill')
const $chestDist = document.getElementById('chestDist')
const $coins = document.getElementById('coins')
const $best = document.getElementById('best')
const $shop = document.getElementById('shop')
const $launch = document.getElementById('launch')
const $boostUI = document.getElementById('boostUI')
const $fuelFill = document.getElementById('fuelFill')
const $fuelText = document.getElementById('fuelText')
const $alignText = document.getElementById('alignText')
const $touchUI = document.getElementById('touchControls')
const $toast = document.getElementById('toast')
const $pushBtn = document.getElementById('pushBtn')
const $helpText = document.getElementById('helpText')
const $rotUp = document.getElementById('rotUp')
const $rotDown = document.getElementById('rotDown')
const $forsageBtn = document.getElementById('forsageBtn')

/* ---------- Внешние колбэки (заполняются в init) ---------- */
let _onLaunch = null
let _onBuy = null
let _onReset = null
let _upgrades = [] // ссылка на CFG.UPGRADES
let _costOf = () => 0 // колбэк расчёта цены
let _onAchievements = null
let _onActivateAbility = null
let _lastForsageSig = null

/* Кэши, чтобы не трогать DOM каждый кадр */
let _lastDist = -1
let _lastCoins = -1
let _lastBest = -1
let _lastFuel = -1
let _lastInFlight = null

/* ================================================================
   Display-функции (вызываются из game.js)
================================================================ */
export function updateHUD() {
  const d = Math.max(0, Math.floor(window.__rocketPosX || 0))
  if (d !== _lastDist) {
    _lastDist = d
    $dist.textContent = d
  }
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
// Внутренний хак: game.js обновит window.__rocketPosX перед вызовом.
// Проще: game.js сам передаёт x. Дадим уточнённую версию ниже.
export function setHUDDist(x) {
  const v = Math.max(0, Math.floor(x))
  if (v === _lastDist) return
  _lastDist = v
  $dist.textContent = v
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

let toastTimer
export function showToast(text, color = CFG.UI.toastColors.default) {
  $toast.textContent = text
  $toast.style.color = color
  $toast.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $toast.classList.remove('on'), CFG.UI.toastDuration)
}

/**
 * Сообщение о посадке.
 *   dist     — пройденное расстояние в метрах
 *   isRecord — если true, над цифрой появится кубок
 */
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

/* ================================================================
   Подсказка угла. Значения (цвет, aligned) приходят из angles.js —
   ui.js только отображает, не считает пороги.
================================================================ */
let _lastAlignText = ''
let _lastAlignColor = ''

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

/**
 * Прогрессбар «до следующего сундука».
 *   distance — метров до следующего сундука (null = нет цели, скрыть плашку).
 *   progress — 0..1, где 0 = только что прошли предыдущий сундук,
 *              1 = стоим прямо на следующем.
 *   near     — «совсем рядом» (< 300 м), включает зелёный акцент.
 */
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

function updateForsageButton() {
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

  // Не трогаем DOM лишний раз: сравниваем «сигнатуру» с точностью до 1%.
  const sig = cls + ':' + Math.round(fill)
  if (sig === _lastForsageSig) return
  _lastForsageSig = sig

  $forsageBtn.className = 'forsage-btn ' + cls
  $forsageBtn.style.setProperty('--fill', fill.toFixed(1) + '%')
}

let cardCloseHandler = null
export function showCardPopup(card, isUpgrade = false) {
  const $popup = document.getElementById('cardPopup')
  const $card = $popup.querySelector('.card')
  const $label = $popup.querySelector('.card-label')

  document.getElementById('cardIcon').textContent = card.icon
  document.getElementById('cardName').textContent = card.name

  // Для forsage: первая карточка → desc, повторная → desc_second.
  // Для остальных карточек desc_second отсутствует — поведение не меняется.
  const descText = isUpgrade && card.desc_second ? card.desc_second : card.desc
  document.getElementById('cardDesc').textContent = descText

  // Заголовок: «РЕДКАЯ НАХОДКА» → «УЛУЧШЕНИЕ» при апгрейде.
  if ($label) {
    $label.textContent = isUpgrade ? 'УЛУЧШЕНИЕ' : 'РЕДКАЯ НАХОДКА'
  }

  if ($card) {
    $card.style.borderColor =
      card.color != null ? '#' + card.color.toString(16).padStart(6, '0') : ''
  }

  $popup.classList.add('on')
  if (cardCloseHandler) $popup.removeEventListener('click', cardCloseHandler)
  cardCloseHandler = () => $popup.classList.remove('on')
  $popup.addEventListener('click', cardCloseHandler)
}

/* ================================================================
   Per-frame update: видимость панелей по фазе игры.
================================================================ */
export function update() {
  updateForsageButton()
  const inFlight = G.phase === 'fly'
  if (inFlight === _lastInFlight) return
  _lastInFlight = inFlight

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

/* ================================================================
   Ввод
================================================================ */
function bindHold(el, setter) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    setter(true)
  })
  el.addEventListener('pointerup', () => setter(false))
  el.addEventListener('pointerleave', () => setter(false))
  el.addEventListener('pointercancel', () => setter(false))
}

export function init(callbacks) {
  _onLaunch = callbacks.onLaunch
  _onBuy = callbacks.onBuy
  _onReset = callbacks.onReset
  _upgrades = callbacks.upgrades
  _costOf = callbacks.costOf
  _onAchievements = callbacks.onAchievements
  _onActivateAbility = callbacks.onActivateAbility

  /* ---------- Клавиатура ---------- */
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault()
      input.boost = true
      // Запуск — только по «свежему» нажатию, не по автоповтору зажатой клавиши.
      // Иначе: игрок держит газ → ракета садится в landed → repeat-keydown
      // мгновенно перезапускает полёт, не давая зайти в магазин.
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

  /* ---------- Тач-кнопки ---------- */
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

  /* ---------- Canvas ---------- */
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

  /* ---------- Кнопки ---------- */
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

  /* ---------- Settings panel ---------- */
  const $settingsBtn = document.getElementById('settingsBtn')
  const $settingsPanel = document.getElementById('settingsPanel')
  const $settingsClose = document.getElementById('settingsClose')
  const $lowSpecToggle = document.getElementById('lowSpecToggle')

  if ($lowSpecToggle) {
    // Показать сохранённое значение
    $lowSpecToggle.checked = Settings.settings.lowSpecMode

    $lowSpecToggle.addEventListener('change', () => {
      Settings.settings.lowSpecMode = $lowSpecToggle.checked
      Settings.save()
      // Мир уже загружен с прежней плотностью — перезагружаем страницу,
      // чтобы settings.js применил новое значение до генерации чанков.
      showToast('Применяем… 🔄', CFG.UI.toastColors.upgrade)
      setTimeout(() => location.reload(), 350)
    })
  }

  /* ---------- Звук: громкость ---------- */
  const $soundVolume = document.getElementById('soundVolume')
  if ($soundVolume) {
    // Показать сохранённое значение
    const saved = Settings.settings.soundVolume
    const initial = typeof saved === 'number' ? saved : CFG.SOUNDS.masterVolume
    $soundVolume.value = Math.round(initial * 100)

    let volumeDirty = false
    $soundVolume.addEventListener('input', () => {
      const v = +$soundVolume.value / 100
      Settings.settings.soundVolume = v
      Sounds.setMasterVolume(v)

      // Сохранение — с дебаунсом, чтобы не писать localStorage на каждый пиксель
      if (!volumeDirty) {
        volumeDirty = true
        setTimeout(() => {
          Settings.save()
          volumeDirty = false
        }, 250)
      }
    })

    // Превью-звук при отпускании ползунка — чтобы игрок «услышал» громкость
    $soundVolume.addEventListener('change', () => {
      Sounds.play('achStage')
    })
  }

  /* ---------- Звук: вкл/выкл ---------- */
  const $soundEnabledToggle = document.getElementById('soundEnabledToggle')
  if ($soundEnabledToggle) {
    $soundEnabledToggle.checked = Settings.settings.soundEnabled

    $soundEnabledToggle.addEventListener('change', () => {
      Settings.settings.soundEnabled = $soundEnabledToggle.checked
      Settings.save()
      if ($soundEnabledToggle.checked) Sounds.play('achStage') // короткий «тест»
    })
  }

  /* ---------- GPU-hint: показываем ТОЛЬКО если встроенная графика ---------- */
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
        // "ANGLE (Intel, Intel(R) UHD Graphics (0x46A3) Direct3D11...)" →
        // "Intel(R) UHD Graphics"
        const m = rendererStr.match(/ANGLE \([^,]+,\s*(.+?)\s*(?:\(|Direct|,|$)/)
        const display = m ? m[1] : 'встроенная графика'

        $gpuHintStatus.textContent = `⚠️ Сейчас: ${display} (встроенная — вероятная причина лагов)`
        $gpuHint.hidden = false
      }
      // На дискретной / при отсутствии данных — блок остаётся скрытым (hidden)
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

/* ================================================================
   Достижения: очередь всплывающих попапов
================================================================ */
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

  // Звук — в момент показа попапа, а не раньше.
  // Если попапов в очереди несколько — каждый получит свой звук.
  Sounds.play(milestone ? 'achStage' : 'ach')

  setTimeout(() => {
    $el.classList.add('out')
    setTimeout(() => {
      $el.remove()
      drainAchQueue()
    }, 380)
  }, 2500)
}
