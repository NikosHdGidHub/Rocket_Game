/* ================================================================
   save.js — сохранение/загрузка прогресса и призрака.
================================================================ */
import * as CFG from '../config.js'
import { G, time, ghostRecorder, bestFlight } from '../state.js'
import * as Achievements from '../achievements.js'
import * as DayNight from '../views/daynight.js'
import * as UI from '../ui/index.js'

export function saveProgress() {
  if (!CFG.SAVE.autoSave) return
  try {
    const data = {
      v: CFG.SAVE.version,
      coins: G.coins,
      best: G.best,
      upgrades: { ...G.upgrades },
      cards: { ...G.cards },
      openedChests: [...G.openedChests],
      gems: G.gems,
      collectedGems: [...G.collectedGems],
      achievements: Achievements.serialize(),
      totalPlaytime: time.totalPlaytime + time.gameTime,
    }
    localStorage.setItem(CFG.SAVE.key, JSON.stringify(data))
  } catch (e) {
    console.warn('saveProgress failed:', e)
  }
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(CFG.SAVE.key)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return

    if (typeof data.coins === 'number' && isFinite(data.coins) && data.coins >= 0) {
      G.coins = Math.floor(data.coins)
    }
    if (typeof data.best === 'number' && isFinite(data.best) && data.best >= 0) {
      G.best = data.best
    }
    if (
      typeof data.totalPlaytime === 'number' &&
      isFinite(data.totalPlaytime) &&
      data.totalPlaytime >= 0
    ) {
      time.totalPlaytime = data.totalPlaytime
    }
    if (data.upgrades && typeof data.upgrades === 'object') {
      for (const key of Object.keys(CFG.GAME.initialUpgrades)) {
        const v = data.upgrades[key]
        if (typeof v === 'number' && isFinite(v) && v >= 1) {
          const uCfg = CFG.UPGRADES.find((u) => u.key === key)
          const max = uCfg?.maxLevel ?? Infinity
          G.upgrades[key] = Math.min(Math.floor(v), max)
        }
      }
    }
    if (data.cards && typeof data.cards === 'object') {
      for (const [id, count] of Object.entries(data.cards)) {
        if (typeof count !== 'number' || !isFinite(count) || count < 0) continue
        if (CFG.CARDS.some((c) => c.id === id)) {
          G.cards[id] = Math.floor(count)
        }
      }
    }
    if (Array.isArray(data.openedChests)) {
      for (const x of data.openedChests) {
        if (typeof x === 'number' && isFinite(x)) G.openedChests.add(x)
      }
    }
    if (typeof data.gems === 'number' && isFinite(data.gems) && data.gems >= 0) {
      G.gems = Math.floor(data.gems)
    }
    if (Array.isArray(data.collectedGems)) {
      for (const x of data.collectedGems) {
        if (typeof x === 'number' && isFinite(x)) G.collectedGems.add(x)
      }
    }
    Achievements.deserialize(data.achievements)
  } catch (e) {
    console.warn('loadProgress failed:', e)
  }
}

export function resetProgress() {
  const ok = confirm(
    'Сбросить весь прогресс? Монеты, рекорд и апгрейды будут потеряны.\nИгра перезапустится.'
  )
  if (!ok) return

  try {
    localStorage.removeItem(CFG.SAVE.key)
    localStorage.removeItem(CFG.ROCKET.ghost.storageKey)
  } catch (e) {
    console.warn('resetProgress: не удалось очистить localStorage:', e)
  }
  DayNight.reset()

  UI.showToast('Прогресс сброшен 🗑️', '#ff7a7a')

  setTimeout(() => location.reload(), 500)
}

/* ================================================================
   GHOST PERSISTENCE — base64 для Float32Array
================================================================ */
function u8ToBase64(u8) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToU8(b64) {
  const binary = atob(b64)
  const u8 = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i)
  return u8
}

export function saveGhostFlight() {
  if (ghostRecorder.samples.length < CFG.ROCKET.minSamplesLimit) return
  try {
    const float32 = new Float32Array(ghostRecorder.samples)
    bestFlight.samples = float32
    bestFlight.best = G.best

    const bytes = new Uint8Array(float32.buffer)
    const b64 = u8ToBase64(bytes)
    localStorage.setItem(
      CFG.ROCKET.ghost.storageKey,
      JSON.stringify({ v: 1, best: G.best, samples: b64 })
    )
  } catch (e) {
    console.warn('saveGhostFlight failed:', e)
  }
}

export function loadGhostFlight() {
  try {
    const raw = localStorage.getItem(CFG.ROCKET.ghost.storageKey)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || typeof data.samples !== 'string') return

    const bytes = base64ToU8(data.samples)
    if (bytes.length % 4 !== 0) return
    const float32 = new Float32Array(bytes.buffer)
    if (float32.length < 12) return

    bestFlight.samples = float32
    bestFlight.best = typeof data.best === 'number' ? data.best : 0
  } catch (e) {
    console.warn('loadGhostFlight failed:', e)
  }
}
