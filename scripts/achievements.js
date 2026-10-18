/* ================================================================
   achievements.js — логика достижений: состояние, хуки на события,
   сохранение. Определения — в config.js (CFG.ACHIEVEMENTS).
================================================================ */
import * as CFG from './config.js'
import { G, time } from './state.js'

export const ACHIEVEMENTS = CFG.ACHIEVEMENTS

/* ================================================================
   СОСТОЯНИЕ
================================================================ */
export const A = {
  unlocked: new Set(), // 'first_launch', ...
  stepUnlocked: new Set(), // 'first_steps:0', ...
  progress: {}, // key → накопленное значение
  startTimes: {}, // key → Date.now() старта таймера (time-limited)
}

/* ================================================================
   ХЕЛПЕРЫ
================================================================ */
function ach(key) {
  return ACHIEVEMENTS.find((a) => a.key === key)
}

/* ================================================================
   СЛУШАТЕЛИ
================================================================ */
const listeners = []
export function onChange(fn) {
  listeners.push(fn)
}

function emit(ach, milestone = null, stepIdx = -1) {
  for (const fn of listeners) {
    try {
      fn(ach, milestone, stepIdx)
    } catch (e) {
      console.warn('ach listener failed:', e)
    }
  }
}

/* ================================================================
   TIME-LIMITED (универсально — работает для любой ачивки с timeLimit)
================================================================ */

/** Запускает таймер, если он ещё не запущен. */
export function startTimeLimit(key) {
  const a = ach(key)
  if (!a || !a.timeLimit) return
  if (Object.hasOwn(A.startTimes, key)) return
  A.startTimes[key] = time.gameTime // секунды
}

/** @returns {boolean} true, если лимит истёк и ачивка ещё не получена. */
export function isTimeLimitedFailed(key) {
  const a = ach(key)
  if (!a || !a.timeLimit) return false
  if (A.unlocked.has(key)) return false
  if (!Object.hasOwn(A.startTimes, key)) return false
  const elapsedSec = time.gameTime - A.startTimes[key]
  return elapsedSec >= a.timeLimit / 1000 // сравниваем в секундах
}

/** @returns {number} секунд до истечения лимита (0, если не time-limited). */
export function timeLimitedRemainingSec(key) {
  const a = ach(key)
  if (!a || !a.timeLimit) return 0
  if (!Object.hasOwn(A.startTimes, key)) return a.timeLimit / 1000
  const elapsedSec = time.gameTime - A.startTimes[key]
  return Math.max(0, a.timeLimit / 1000 - elapsedSec)
}

/* ================================================================
   ВНУТРЕННИЕ
================================================================ */
function unlock(key) {
  if (A.unlocked.has(key)) return
  A.unlocked.add(key)
  const a = ach(key)
  if (a) emit(a, null, -1)
  if (key !== 'hundred') checkHundred()
}

function unlockStep(a, i) {
  const composite = a.key + ':' + i
  if (A.stepUnlocked.has(composite)) return
  A.stepUnlocked.add(composite)
  emit(a, a.steps[i], i)

  const allDone = a.steps.every((_, idx) => A.stepUnlocked.has(a.key + ':' + idx))
  if (allDone && !A.unlocked.has(a.key)) {
    A.unlocked.add(a.key)
    if (a.key !== 'hundred') checkHundred()
  }
}

function checkHundred() {
  const others = ACHIEVEMENTS.filter((a) => a.key !== 'hundred')
  if (others.every((a) => A.unlocked.has(a.key))) unlock('hundred')
}

function setProgress(key, value) {
  const prev = A.progress[key] || 0
  if (value > prev) A.progress[key] = value
}

function checkSteps(key, value) {
  const a = ach(key)
  if (!a || !a.steps) return
  for (let i = 0; i < a.steps.length; i++) {
    if (value >= a.steps[i].target) unlockStep(a, i)
  }
}

/* ================================================================
   ПУБЛИЧНЫЕ СОБЫТИЯ
================================================================ */
export function onLaunch() {
  startTimeLimit('sprinter')
  unlock('first_launch')
}

export function onLand({ dist, altitude, speed, nearestChestDist }) {
  // 🌱 Первые шаги — суммарно, многоэтапное
  const total = (A.progress.first_steps || 0) + Math.max(0, dist)
  setProgress('first_steps', total)
  checkSteps('first_steps', total)

  if (dist > 100) {
    // 🚶‍♂️ Путник
    const t = (A.progress.traveler || 0) + 1
    setProgress('traveler', t)
    checkSteps('traveler', t)

    // 🗿 Обыватель — не растёт выше target, не считается после анлока
    if (!A.unlocked.has('citizen')) {
      const target = ach('citizen').target
      const c = Math.min(target, (A.progress.citizen || 0) + 1)
      setProgress('citizen', c)
      if (c >= target) unlock('citizen')
    }
  }

  if (altitude > ach('climber').const_target) unlock('climber')
  if (dist >= ach('orbit').const_target) unlock('orbit')
  if (dist >= ach('intercontinental').const_target) unlock('intercontinental')
  if (speed > 0 && speed < ach('soft_landing').const_target) unlock('soft_landing')
  if (nearestChestDist !== null && nearestChestDist <= ach('sniper').const_target) unlock('sniper')
}

export function onBuy() {
  // Обыватель сбрасывается при апгрейде, но только если ещё не получен
  if (!A.unlocked.has('citizen')) {
    A.progress.citizen = 0
  }

  const allMax = CFG.UPGRADES.every((u) => G.upgrades[u.key] >= u.maxLevel)
  if (allMax) unlock('maximalist')
}

export function onChestOpen(openedCount) {
  const collectorTarget = ach('collector').target
  const capped = Math.min(collectorTarget, openedCount)
  setProgress('collector', capped)
  if (capped >= collectorTarget) unlock('collector')

  if (!A.unlocked.has('sprinter') && !isTimeLimitedFailed('sprinter')) {
    setProgress('sprinter', capped)
    if (capped >= ach('sprinter').target) unlock('sprinter')
  }
}

/* ================================================================
   SAVE / LOAD
================================================================ */
export function serialize() {
  const startElapsed = {}
  for (const [k, start] of Object.entries(A.startTimes)) {
    startElapsed[k] = time.gameTime - start // сколько уже прошло
  }
  return {
    unlocked: [...A.unlocked],
    stepUnlocked: [...A.stepUnlocked],
    progress: { ...A.progress },
    startElapsed, // ← новый формат
  }
}

export function deserialize(data) {
  if (!data || typeof data !== 'object') return
  const hasStepArray = Array.isArray(data.stepUnlocked)

  if (Array.isArray(data.unlocked)) {
    for (const k of data.unlocked) {
      const a = ach(k)
      if (!a) continue
      A.unlocked.add(k)
      // Миграция со старого формата: нет stepUnlocked — считаем все шаги выполненными
      if (a.steps && !hasStepArray) {
        for (let i = 0; i < a.steps.length; i++) A.stepUnlocked.add(k + ':' + i)
      }
    }
  }

  if (hasStepArray) {
    for (const k of data.stepUnlocked) {
      if (typeof k !== 'string') continue
      const [key, idxs] = k.split(':')
      const idx = +idxs
      const a = ach(key)
      if (a && a.steps && a.steps[idx]) A.stepUnlocked.add(k)
    }
  }

  if (data.progress && typeof data.progress === 'object') {
    for (const [k, v] of Object.entries(data.progress)) {
      if (typeof v === 'number' && isFinite(v) && v >= 0) A.progress[k] = v
    }
  }

  // ---------- Миграция таймеров ----------
  // Порядок ВАЖЕН: старые форматы обрабатываем первыми,
  // новые перезаписывают (приоритет новее).

  // 1) Самый старый формат: sprintStart (одиночное число, ms)
  if (typeof data.sprintStart === 'number' && isFinite(data.sprintStart) && data.sprintStart > 0) {
    const a = ach('sprinter')
    if (a && a.timeLimit) {
      const elapsedSec = Math.min(
        a.timeLimit / 1000,
        Math.max(0, (Date.now() - data.sprintStart) / 1000)
      )
      A.startTimes.sprinter = time.gameTime - elapsedSec
    }
  }

  // 2) Старый формат: startTimes (Date.now() ms per key)
  if (data.startTimes && typeof data.startTimes === 'object') {
    for (const [k, v] of Object.entries(data.startTimes)) {
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) continue
      const a = ach(k)
      if (!a || !a.timeLimit) continue
      const elapsedSec = Math.min(a.timeLimit / 1000, Math.max(0, (Date.now() - v) / 1000))
      A.startTimes[k] = time.gameTime - elapsedSec
    }
  }

  // 3) Новый формат: startElapsed (секунды с начала, per key)
  if (data.startElapsed && typeof data.startElapsed === 'object') {
    for (const [k, v] of Object.entries(data.startElapsed)) {
      if (typeof v !== 'number' || !isFinite(v) || v < 0) continue
      const a = ach(k)
      if (!a || !a.timeLimit) continue
      A.startTimes[k] = time.gameTime - v
    }
  }
}

export function reset() {
  A.unlocked.clear()
  A.stepUnlocked.clear()
  A.progress = {}
  A.startTimes = {}
}
