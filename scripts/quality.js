/* ================================================================
   quality.js — детект устройства + применение пресетов из config.js.

   Экспорт:
     detectDeviceClass()        → 'low' | 'medium' | 'high' | 'ultra'
     resolvePreset(setting)     → конкретный id ('auto' → детект)
     apply(presetId)            → мутирует CFG.*
     getLabel(presetId)         → строка для UI
     describeDiff(cur, next)    → массив строк-изменений

   Важно: apply() должен быть вызван ДО того, как scene.js / chunks.js
   прочитают конфиг. Это делает settings.js в top-level.
================================================================ */
import * as CFG from './config.js'

export const PRESET_IDS = ['low', 'medium', 'high', 'ultra']
export const SETTING_VALUES = ['auto', ...PRESET_IDS]

let _detectedCache = null

/* ================================================================
   DETECT — скоринг по нескольким сигналам.
   Отдельные сигналы ненадёжны (Firefox/Safari прячут renderer,
   iPad Pro мощнее ноутбуков), поэтому суммируем.
================================================================ */
export function detectDeviceClass() {
  if (_detectedCache) return _detectedCache

  const signals = {
    mobile: false,
    weakGpu: false,
    strongGpu: false,
    cores: 0,
    memory: 0,
  }

  try {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches
    const touch = (navigator.maxTouchPoints || 0) > 0
    signals.mobile = !!coarse || touch
  } catch (_) {}

  signals.cores = navigator.hardwareConcurrency || 0
  signals.memory = navigator.deviceMemory || 0

  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      const str = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ''
      if (str) {
        if (/ANGLE \(Intel.*(UHD|Iris|HD Graphics)/i.test(str)) signals.weakGpu = true
        else if (/ANGLE \((NVIDIA|AMD|Radeon|Apple M)/i.test(str)) signals.strongGpu = true
      }
      // освобождаем контекст сразу
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch (_) {}

  let score = 0
  if (signals.strongGpu) score += 3
  if (signals.weakGpu) score -= 3
  if (signals.cores >= 8) score += 1
  else if (signals.cores > 0 && signals.cores < 4) score -= 1
  if (signals.memory >= 8) score += 1
  else if (signals.memory > 0 && signals.memory <= 2) score -= 1
  if (signals.mobile) score -= 1

  let result
  if (score >= 3) result = 'ultra'
  else if (score >= 1) result = 'high'
  else if (score <= -3) result = 'low'
  else if (score <= -1) result = 'medium'
  else result = 'medium' // нейтрально — безопасная середина

  _detectedCache = result
  return result
}

/* ================================================================
   RESOLVE / APPLY
================================================================ */
export function resolvePreset(qualitySetting) {
  if (qualitySetting === 'auto') return detectDeviceClass()
  if (PRESET_IDS.includes(qualitySetting)) return qualitySetting
  return 'medium'
}

export function apply(presetId) {
  const preset = CFG.QUALITY_PRESETS[presetId] || CFG.QUALITY_PRESETS.medium

  CFG.RENDERER.antialias = preset.renderer.antialias
  CFG.RENDERER.pixelRatioCap = preset.renderer.pixelRatioCap
  CFG.RENDERER.maxChunksPerFrame = preset.renderer.maxChunksPerFrame

  CFG.PROPS.density = preset.props.density
  CFG.PROPS.maxRenderDistance = preset.props.maxRenderDistance

  CFG.LIGHTS.shadow.enabled = preset.lights.shadow.enabled

  CFG.CHUNKS.segments = preset.chunks.segments

  CFG.FAR_TILES.segments = preset.farTiles.segments
  CFG.FAR_TILES.segmentsHigh = preset.farTiles.segmentsHigh

  if (typeof preset.overlay.enabled === 'boolean') {
    CFG.OVERLAY.enabled = preset.overlay.enabled
  }
  CFG.OVERLAY.canvasSize = preset.overlay.canvasSize

  CFG.SPACE.stars.count = preset.space.stars.count
  CFG.SPACE.spheres.maxCount = preset.space.spheres.maxCount
}

/* ================================================================
   UI HELPERS
================================================================ */
export function getLabel(presetId) {
  const p = CFG.QUALITY_PRESETS[presetId]
  return p ? p.label : presetId
}

/** Список строк «что изменится» между двумя пресетами. */
export function describeDiff(currentId, nextId) {
  const a = CFG.QUALITY_PRESETS[currentId]
  const b = CFG.QUALITY_PRESETS[nextId]
  if (!a || !b) return []

  const lines = []

  if (a.lights.shadow.enabled !== b.lights.shadow.enabled) {
    lines.push(
      `Тени: ${a.lights.shadow.enabled ? 'включены' : 'выключены'} → ${b.lights.shadow.enabled ? 'включены' : 'выключены'}`
    )
  }
  if (a.props.maxRenderDistance !== b.props.maxRenderDistance) {
    lines.push(
      `Дальность отрисовки: ${a.props.maxRenderDistance} м → ${b.props.maxRenderDistance} м`
    )
  }
  if (a.props.density !== b.props.density) {
    lines.push(`Плотность растительности: ${a.props.density} → ${b.props.density}`)
  }
  if (a.renderer.antialias !== b.renderer.antialias) {
    lines.push(
      `Сглаживание: ${a.renderer.antialias ? 'вкл' : 'выкл'} → ${b.renderer.antialias ? 'вкл' : 'выкл'}`
    )
  }
  if (a.overlay.canvasSize !== b.overlay.canvasSize) {
    lines.push(`Текстура леса (2D): ${a.overlay.canvasSize}px → ${b.overlay.canvasSize}px`)
  }

  return lines
}
