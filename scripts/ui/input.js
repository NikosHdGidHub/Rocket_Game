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
