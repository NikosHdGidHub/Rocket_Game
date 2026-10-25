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
