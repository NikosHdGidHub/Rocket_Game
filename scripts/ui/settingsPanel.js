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
