/* ================================================================
   state.js — общее мутабельное состояние игры.
   Только данные. Импортирует только config + three.
   Все модули читают/пишут сюда, чтобы не плодить циклические импорты.
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'

/** Прогресс игрока (сохраняется). */
export const G = {
  phase: 'ready', // ready | prekick | windup | strike | fly | landed
  timer: 0,
  coins: CFG.GAME.initialCoins,
  best: CFG.GAME.initialBest,
  lastDist: 0,
  fuel: 0,
  upgrades: { ...CFG.GAME.initialUpgrades },
  cards: {}, // { fuel2x: n, thrust2x: n, ... }
  openedChests: new Set(), // X-координаты открытых сундуков
}

/** Кинематика ракеты. */
export const rocketState = {
  pos: new THREE.Vector3(0, CFG.GAME.restY, 0),
  vel: new THREE.Vector3(),
  angVel: 0,
}

/** LOD / смена 3D ⇄ 2D режима. */
export const lod = {
  fade: 0, // 0 = 3D, 1 = 2D
  in2D: false,
  showing3D: true, // показывать ли меши 3D-чанков и босса
  altSmooth: 0, // сглаженная высота над рельефом
  altInit: false, // была ли первая инициализация
}

/** Камера (сглаженные значения + цель). */
export const cam = {
  blend: 0, // 0 = сбоку, 1 = сзади
  shake: 0, // амплитуда тряски
  look: new THREE.Vector3(0, 3, 0),
  target: new THREE.Vector3(), // куда стремится (для prekick-детекта)
}

/** Ввод — объединённые клавиши/тач/boost. */
export const input = {
  boost: false,
  keys: { W: false, S: false },
  touch: { W: false, S: false },
}

/** Игровое время (секунды). Растёт только когда вкладка активна. */
export const time = {
  gameTime: 0,
}
