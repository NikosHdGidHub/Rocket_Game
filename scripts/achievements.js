/* ================================================================
   achievements.js — логика достижений: определения, состояние,
   хуки на события игры, сохранение.

   Визуал — в achievementsModal.js. Здесь только данные.
================================================================ */
import * as CFG from './config.js'
import { G } from './state.js'

/* ================================================================
   ОПРЕДЕЛЕНИЯ
================================================================ */
export const ACHIEVEMENTS = [
  /* ---------- Лёгкие (зелёные) ---------- */
  { key: 'first_launch', icon: '🎈', tier: 'easy', name: 'Первый пуск', desc: 'Запустить ракету' },

  {
    key: 'first_steps',
    icon: '🌱',
    tier: 'easy',
    name: 'Первые шаги',
    desc: 'Пролететь суммарно',
    unit: 'm',
    steps: [
      { target: 1000, label: '1 км' },
      { target: 3000, label: '3 км' },
      { target: 10000, label: '10 км' },
      { target: 20000, label: '20 км' },
      { target: 50000, label: '50 км' },
      { target: 200000, label: '200 км' },
    ],
  },

  {
    key: 'traveler',
    icon: '🚶‍♂️',
    tier: 'easy',
    name: 'Путник',
    desc: 'Приземлений на 100+ м',
    steps: [
      { target: 10, label: '10' },
      { target: 30, label: '30' },
      { target: 100, label: '100' },
    ],
  },

  {
    key: 'climber',
    icon: '🧊',
    tier: 'easy',
    name: 'Скалолаз',
    desc: 'Сесть на высоте выше 500 м',
  },

  {
    key: 'citizen',
    icon: '🗿',
    tier: 'easy',
    name: 'Обыватель',
    desc: '5 запусков подряд без апгрейдов',
    target: 5,
  },

  /* ---------- Средние (фиолетовые) ---------- */
  { key: 'orbit', icon: '🚀', tier: 'medium', name: 'Орбита', desc: '25 км за один запуск' },

  { key: 'sniper', icon: '🎯', tier: 'medium', name: 'Снайпер', desc: 'Сесть в 40 м от сундука' },

  {
    key: 'collector',
    icon: '💥',
    tier: 'medium',
    name: 'Коллекционер',
    desc: 'Открыть все 8 сундуков',
    target: 8,
  },

  {
    key: 'soft_landing',
    icon: '🛬',
    tier: 'medium',
    name: 'Мягкая посадка',
    desc: 'Сесть со скоростью < 5 м/с',
  },

  /* ---------- Сложные (оранжевые) ---------- */
  {
    key: 'maximalist',
    icon: '🛒',
    tier: 'hard',
    name: 'Максималист',
    desc: 'Прокачать все улучшения на максимум',
  },

  {
    key: 'intercontinental',
    icon: '🌌',
    tier: 'hard',
    name: 'Межконтинентальный',
    desc: '500 км за один запуск',
  },

  {
    key: 'hundred',
    icon: '💯',
    tier: 'hard',
    name: '100%',
    desc: 'Выполнить все остальные достижения',
  },

  /* ---------- Спринтер: оранжевый по умолчанию, красный при провале ---------- */
  {
    key: 'sprinter',
    icon: '⏱️',
    tier: 'hard',
    name: 'Спринтер',
    desc: '8 сундуков за 15 минут',
    target: 8,
    timeLimited: true,
  },
]

/* ================================================================
   СОСТОЯНИЕ
================================================================ */
export const A = {
  unlocked: new Set(), // полностью выполненные ачивки (по ключу)
  stepUnlocked: new Set(), // 'first_steps:0', 'first_steps:1', ...
  progress: {}, // key → накопленное значение (для прогрессивных)
  sprintStart: 0,
}

const SPRINT_LIMIT_MS = 15 * 60 * 1000

/* ================================================================
   СЛУШАТЕЛИ
================================================================ */
const listeners = []
export function onChange(fn) {
  listeners.push(fn)
}

/** @param {object} ach  @param {object|null} milestone  @param {number} stepIdx */
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
   ВНУТРЕННИЕ
================================================================ */
function unlock(key) {
  if (A.unlocked.has(key)) return
  A.unlocked.add(key)
  const ach = ACHIEVEMENTS.find((a) => a.key === key)
  if (ach) emit(ach, null, -1)
  if (key !== 'hundred') checkHundred()
}

function unlockStep(ach, i) {
  const composite = ach.key + ':' + i
  if (A.stepUnlocked.has(composite)) return
  A.stepUnlocked.add(composite)
  emit(ach, ach.steps[i], i)

  // Все шаги сделаны → ачивка целиком выполнена
  const allDone = ach.steps.every((_, idx) => A.stepUnlocked.has(ach.key + ':' + idx))
  if (allDone && !A.unlocked.has(ach.key)) {
    A.unlocked.add(ach.key)
    if (ach.key !== 'hundred') checkHundred()
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

/** Проходит по шагам ачивки и разлочивает все, что покрыты value. */
function checkSteps(key, value) {
  const ach = ACHIEVEMENTS.find((a) => a.key === key)
  if (!ach || !ach.steps) return
  for (let i = 0; i < ach.steps.length; i++) {
    if (value >= ach.steps[i].target) unlockStep(ach, i)
  }
}

/* ================================================================
   ПУБЛИЧНЫЕ СОБЫТИЯ
================================================================ */
export function onLaunch() {
  if (!A.sprintStart) A.sprintStart = Date.now()
  unlock('first_launch')
}

export function onLand({ dist, altitude, speed, nearestChestDist }) {
  // 🌱 Первые шаги — суммарно, многоэтапное
  const total = (A.progress.first_steps || 0) + Math.max(0, dist)
  setProgress('first_steps', total)
  checkSteps('first_steps', total)

  if (dist > 100) {
    // 🚶‍♂️ Путник — счётчик посадок
    const t = (A.progress.traveler || 0) + 1
    setProgress('traveler', t)
    checkSteps('traveler', t)

    // 🗿 Обыватель — не растёт выше 5 и не считается после анлока
    if (!A.unlocked.has('citizen')) {
      const c = Math.min(5, (A.progress.citizen || 0) + 1)
      setProgress('citizen', c)
      if (c >= 5) unlock('citizen')
    }
  }

  if (altitude > 500) unlock('climber')
  if (dist >= 25000) unlock('orbit')
  if (dist >= 500000) unlock('intercontinental')
  if (speed > 0 && speed < 5) unlock('soft_landing')
  if (nearestChestDist !== null && nearestChestDist <= 40) unlock('sniper')
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
  const capped = Math.min(8, openedCount)
  setProgress('collector', capped)
  if (capped >= 8) unlock('collector')

  if (!A.unlocked.has('sprinter') && A.sprintStart && !isSprintFailed()) {
    setProgress('sprinter', capped)
    if (capped >= 8) unlock('sprinter')
  }
}

/* ================================================================
   ПРОИЗВОДНЫЕ (для UI)
================================================================ */
export function isSprintFailed() {
  if (A.unlocked.has('sprinter')) return false
  if (!A.sprintStart) return false
  return Date.now() - A.sprintStart >= SPRINT_LIMIT_MS
}

export function sprintRemainingSec() {
  if (!A.sprintStart) return SPRINT_LIMIT_MS / 1000
  const left = SPRINT_LIMIT_MS - (Date.now() - A.sprintStart)
  return Math.max(0, left / 1000)
}

/* ================================================================
   SAVE / LOAD
================================================================ */
export function serialize() {
  return {
    unlocked: [...A.unlocked],
    stepUnlocked: [...A.stepUnlocked],
    progress: { ...A.progress },
    sprintStart: A.sprintStart,
  }
}

export function deserialize(data) {
  if (!data || typeof data !== 'object') return

  const hasStepArray = Array.isArray(data.stepUnlocked)

  if (Array.isArray(data.unlocked)) {
    for (const k of data.unlocked) {
      const ach = ACHIEVEMENTS.find((a) => a.key === k)
      if (!ach) continue
      A.unlocked.add(k)
      // Миграция со старого формата: если нет stepUnlocked — считаем все шаги выполненными
      if (ach.steps && !hasStepArray) {
        for (let i = 0; i < ach.steps.length; i++) A.stepUnlocked.add(k + ':' + i)
      }
    }
  }

  if (hasStepArray) {
    for (const k of data.stepUnlocked) {
      if (typeof k !== 'string') continue
      const [key, idxs] = k.split(':')
      const idx = +idxs
      const ach = ACHIEVEMENTS.find((a) => a.key === key)
      if (ach && ach.steps && ach.steps[idx]) A.stepUnlocked.add(k)
    }
  }

  if (data.progress && typeof data.progress === 'object') {
    for (const [k, v] of Object.entries(data.progress)) {
      if (typeof v === 'number' && isFinite(v) && v >= 0) A.progress[k] = v
    }
  }

  if (typeof data.sprintStart === 'number' && isFinite(data.sprintStart) && data.sprintStart > 0) {
    A.sprintStart = data.sprintStart
  }
}

export function reset() {
  A.unlocked.clear()
  A.stepUnlocked.clear()
  A.progress = {}
  A.sprintStart = 0
}
