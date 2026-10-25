/* ================================================================
   settings.js — пользовательские настройки (localStorage, отдельно от
   игрового прогресса — не сбрасываются кнопкой 🗑️).

   ВАЖНО: у этого модуля есть top-level side effect — load() +
   applyToConfig() при импорте. Он применяет выбранный пресет к CFG
   ДО того, как scene.js / chunks.js прочитают конфиг.

   Импортировать этот файл первым — до scene.js / chunks.js.
================================================================ */
import * as CFG from './config.js'
import * as Quality from './quality.js'

const KEY = 'rocket_game_settings_v1'

export const settings = {
  /** 'auto' | 'low' | 'medium' | 'high' | 'ultra' */
  quality: 'auto',

  /** Рантайм-поле: какой конкретно пресет выбран (для UI «Авто → Сейчас: X»).
   *  В localStorage не сохраняется. */
  _resolvedPreset: 'medium',

  /** Показывать счётчик FPS в HUD. */
  showFps: false,

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

    // ---- Миграция старого формата lowSpecMode → quality ----
    if (typeof data.lowSpecMode === 'boolean') {
      settings.quality = data.lowSpecMode ? 'low' : 'auto'
    }
    // ---- Новый формат ----
    if (typeof data.quality === 'string' && Quality.SETTING_VALUES.includes(data.quality)) {
      settings.quality = data.quality
    }
    if (typeof data.showFps === 'boolean') settings.showFps = data.showFps

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
    const { _resolvedPreset, ...persisted } = settings
    localStorage.setItem(KEY, JSON.stringify(persisted))
  } catch (e) {
    console.warn('settings.save failed:', e)
  }
}

/** Применяет выбранный (или определённый авто) пресет к CFG. */
export function applyToConfig() {
  const presetId = Quality.resolvePreset(settings.quality)
  Quality.apply(presetId)
  settings._resolvedPreset = presetId
}

// --- Top-level side effect (см. шапку файла) ---
load()
applyToConfig()