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
