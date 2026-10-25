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
