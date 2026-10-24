/* ================================================================
   settings.js — пользовательские настройки (localStorage, отдельно от
   игрового прогресса — не сбрасываются кнопкой 🗑️).

   ВАЖНО: этот модуль имеет top-level side effect — при импорте он
   загружает настройки и применяет их к CFG. Поэтому chunks.js
   обязан импортировать его ДО того, как прочитает CFG.PROPS.density.
================================================================ */
import * as CFG from './config.js'

const KEY = 'rocket_game_settings_v1'

export const settings = {
  /** Режим слабого устройства: плотность растительности ×0.5. */
  lowSpecMode: false,

  /** Громкость звуков (0..1). undefined = ещё не трогал, взять из config. */
  soundVolume: undefined,

  /** Включены ли звуки вообще. */
  soundEnabled: true,
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return

    if (typeof data.lowSpecMode === 'boolean') settings.lowSpecMode = data.lowSpecMode

    if (
      typeof data.soundVolume === 'number' &&
      isFinite(data.soundVolume) &&
      data.soundVolume >= 0 &&
      data.soundVolume <= 1
    ) {
      settings.soundVolume = data.soundVolume
    }

    if (typeof data.soundEnabled === 'boolean') settings.soundEnabled = data.soundEnabled
  } catch (e) {
    console.warn('settings.load failed:', e)
  }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('settings.save failed:', e)
  }
}

/** Применяет настройки к CFG (мутация объекта). */
export function applyToConfig() {
  if (settings.lowSpecMode) {
    CFG.PROPS.density = Math.floor(CFG.PROPS.densityLow)
    CFG.RENDERER.maxChunksPerFrame = 1
    CFG.PROPS.maxRenderDistance = CFG.PROPS.maxRenderDistanceFast
  }
}

// --- Top-level side effect (см. шапку файла) ---
load()
applyToConfig()
