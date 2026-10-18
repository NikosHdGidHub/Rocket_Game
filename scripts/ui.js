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

/* ---------- Внешние колбэки (заполняются в init) ---------- */
let _onLaunch = null
let _onBuy = null
let _onReset = null
let _upgrades = [] // ссылка на CFG.UPGRADES
let _costOf = () => 0 // колбэк расчёта цены
let _onAchievements = null

/* ================================================================
   Display-функции (вызываются из game.js)
================================================================ */
export function updateHUD() {
  $dist.textContent = Math.max(0, Math.floor(window.__rocketPosX || 0))
  $coins.textContent = G.coins
  $best.textContent = Math.floor(G.best)
}
// Внутренний хак: game.js обновит window.__rocketPosX перед вызовом.
// Проще: game.js сам передаёт x. Дадим уточнённую версию ниже.
export function setHUDDist(x) {
  $dist.textContent = Math.max(0, Math.floor(x))
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

export function setAlignText(deg) {
  if (deg < 8) {
    $alignText.textContent = '🎯 0°'
    $alignText.style.color = '#7dffa0'
  } else if (deg < 25) {
    $alignText.textContent = Math.round(deg) + '°'
    $alignText.style.color = '#ffd75e'
  } else {
    $alignText.textContent = Math.round(deg) + '°'
    $alignText.style.color = '#ff7a7a'
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
  $fuelFill.style.width = (fuel / maxFuel) * 100 + '%'
  $fuelText.textContent = fuel.toFixed(1)
}

let cardCloseHandler = null
export function showCardPopup(card) {
  const $popup = document.getElementById('cardPopup')
  document.getElementById('cardIcon').textContent = card.icon
  document.getElementById('cardName').textContent = card.name
  document.getElementById('cardDesc').textContent = card.desc
  $popup.classList.add('on')

  if (cardCloseHandler) $popup.removeEventListener('click', cardCloseHandler)
  cardCloseHandler = () => $popup.classList.remove('on')
  $popup.addEventListener('click', cardCloseHandler)
}

/* ================================================================
   Per-frame update: видимость панелей по фазе игры.
================================================================ */
export function update() {
  const inFlight = G.phase === 'fly'

  if (inFlight) {
    $boostUI.classList.add('on')
    $helpText.classList.add('on')
    $touchUI.classList.remove('hidden')
  } else {
    $boostUI.classList.remove('on')
    $helpText.classList.remove('on')
    $touchUI.classList.add('hidden')
  }

  // Панель магазина видна только в ready/landed
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
