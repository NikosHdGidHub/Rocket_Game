/* ================================================================
   abilities.js — активные способности игрока (сейчас — «Форсаж»).

   Логика отделена от game.js и ui.js:
     • состояние — в state.js (G.abilities.<key>)
     • параметры уровней — в config.js (CFG.ABILITIES.<key>.levels)
     • здесь — только переходы состояний и хелперы для UI.

   Жизненный цикл:
     locked (level=0) → ready (level≥1) → active → cooldown → ready → …
   Активировать можно только в фазе 'fly' и только когда isReady.
================================================================ */
import * as CFG from './config.js'
import { G, time } from './state.js'

const AB = CFG.ABILITIES

/* ---------- Хелперы ---------- */
function maxLevel(key) {
  const def = AB[key]
  return def ? def.levels.length : 0
}

function levelCfg(key) {
  const a = G.abilities[key]
  const def = AB[key]
  if (!a || !def || a.level <= 0) return null
  const idx = Math.min(a.level, def.levels.length) - 1
  return def.levels[idx]
}

/* ================================================================
   СИНХРОНИЗАЦИЯ С КАРТОЧКАМИ
   Уровень способности = число карточек, но не выше maxLevel.
   Вызывать после loadProgress() — там восстанавливается G.cards.
================================================================ */
export function syncFromCards() {
  for (const key of Object.keys(AB)) {
    const a = G.abilities[key]
    if (!a) continue
    const cards = G.cards[key] || 0
    a.level = Math.min(cards, maxLevel(key))
  }
}

/* Событие: получена карточка способности (из openChest в game.js). */
export function onCardObtained(key) {
  if (!AB[key]) return
  syncFromCards()
  const a = G.abilities[key]
  if (!a) return
  // Свежая способность — сразу готова: кулдаун сбрасываем.
  a.active = false
  a.activeEnd = 0
  a.cooldownEnd = 0
}

/* ================================================================
   ПРОВЕРКИ
================================================================ */
export function isReady(key) {
  const a = G.abilities[key]
  if (!a || a.level <= 0) return false
  if (a.active) return false
  return time.gameTime >= a.cooldownEnd
}

export function isActive(key) {
  const a = G.abilities[key]
  return !!(a && a.active)
}

/** Множитель тяги. 1.0 — способность не активна / нет уровня. */
export function thrustMultiplier(key) {
  if (!isActive(key)) return 1.0
  const lv = levelCfg(key)
  return lv ? lv.multiplier : 1.0
}

/* ================================================================
   ДЕЙСТВИЯ
================================================================ */
/** Попытка активации. Возвращает true, если сработало. */
export function activate(key) {
  if (G.phase !== 'fly') return false
  if (!isReady(key)) return false
  const a = G.abilities[key]
  const lv = levelCfg(key)
  if (!a || !lv) return false
  a.active = true
  a.activeEnd = time.gameTime + lv.duration
  return true
}

/* ================================================================
   ПРОГРЕСС (0..1) — для UI
================================================================ */
/** 0 = только что активировалась, 1 = закончилась. */
export function getActiveProgress(key) {
  const a = G.abilities[key]
  if (!a || !a.active) return 0
  const lv = levelCfg(key)
  if (!lv || lv.duration <= 0) return 1
  const remaining = a.activeEnd - time.gameTime
  return Math.max(0, Math.min(1, 1 - remaining / lv.duration))
}

/** 0 = только что началась перезарядка, 1 = готово. */
export function getCooldownProgress(key) {
  const a = G.abilities[key]
  if (!a || a.level <= 0) return 0
  if (a.active) return 0
  const lv = levelCfg(key)
  if (!lv) return 0
  const remaining = a.cooldownEnd - time.gameTime
  if (remaining <= 0) return 1
  return Math.max(0, Math.min(1, 1 - remaining / lv.cooldown))
}

/* ================================================================
   PER-FRAME
   Завершает активную фазу и запускает кулдаун.
================================================================ */
export function update(_dt) {
  for (const key of Object.keys(AB)) {
    const a = G.abilities[key]
    if (!a) continue
    if (a.active && time.gameTime >= a.activeEnd) {
      a.active = false
      const lv = levelCfg(key)
      if (lv) a.cooldownEnd = time.gameTime + lv.cooldown
    }
  }
}

/* ================================================================
   СБРОС (при посадке / старте нового полёта)
   Кулдаун и активная фаза обнуляются, уровень сохраняется.
================================================================ */
export function reset() {
  for (const key of Object.keys(AB)) {
    const a = G.abilities[key]
    if (!a) continue
    a.active = false
    a.activeEnd = 0
    a.cooldownEnd = 0
  }
}

/* ================================================================
   СНИМОК ДЛЯ UI
================================================================ */
export function getState(key) {
  const a = G.abilities[key]
  const def = AB[key]
  if (!a || !def) return null
  return {
    key,
    icon: def.icon,
    name: def.name,
    level: a.level,
    unlocked: a.level > 0,
    active: a.active,
    ready: isReady(key),
    activeProgress: getActiveProgress(key),
    cooldownProgress: getCooldownProgress(key),
  }
}