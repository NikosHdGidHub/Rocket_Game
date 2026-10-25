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
