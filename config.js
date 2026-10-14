/* ================================================================
   config.js — все настройки игры в одном месте.
   Меняй здесь, логика в index.html не трогается.
================================================================ */

/* ---------- Мир и seed ---------- */
export const WORLD_SEED = 1337

/* ---------- Renderer ---------- */
export const RENDERER = {
  antialias: true,
  pixelRatioCap: 2,
  toneMappingExposure: 1.15,
}

/* ---------- Небо (шейдерный купол) ---------- */
export const SKY = {
  zenith: 0x2f6fce, // зенит — глубокий синий
  horizon: 0xd9ebf8, // горизонт — дымчатый, тёплый
  sun: 0xfff0c0, // солнце — тёплый жёлтый
  sunDir: [28, 32, 22], // направление, совпадает с LIGHTS.sunOffset*
  exponent: 0.85,
  hazeColor: [0.06, 0.04, 0.0],
  hazePow: 4.0,
  glowPow: 6.0,
  glowAmt: 0.4,
  corePow: 240.0,
  coreAmt: 1.2,
  domeRadius: 1400,
  domeSegW: 32,
  domeSegH: 16,
}

/* ---------- Свет ---------- */
export const LIGHTS = {
  hemiSky: 0xb8d8f0,
  hemiGround: 0x4a7a35,
  hemiIntensity: 1.05,
  sunColor: 0xfff0d0,
  sunIntensity: 1.9,
  sunOffset: [28, 32, 22], // позиция относительно камеры (двигается в такт)
  shadow: {
    enabled: false,
    mapSize: 2048,
    cameraSize: 45,
    near: 1,
    far: 160,
    bias: -0.0008,
  },
}

/* ---------- Туман ---------- */
export const FOG = {
  // Стартовые значения
  initialNear: 80,
  initialFar: 300,
  // 3D-режим (низко над землёй)
  near3D: 90,
  far3D: 620,
  // 2D-режим (высоко в воздухе)
  near2D: 500,
  far2D: 2000,
}

/* ---------- Рельеф ---------- */
export const TERRAIN = {
  // Базовые волны
  baseWaves: [
    { amp: 5.5, freq: 0.016, phase: 0.4, axis: 'x', fn: 'sin' },
    { amp: 2.4, freq: 0.041, phase: 1.9, axis: 'x', fn: 'sin' },
    { amp: 3.0, freq: 0.02, phase: 0.8, axis: 'z', fn: 'cos' },
    { amp: 4.0, freq: 0.011, phase: 2.5, axis: 'xz', fn: 'sin' },
    { amp: 0.9, freq: 0.085, phase: 3.1, axis: 'x', fn: 'sin' },
    { amp: 0.7, freq: 0.1, phase: 1.4, axis: 'z', fn: 'cos' },
  ],
  dip: { amp: 5.5, freq: 0.0075, phase: 1.2, axis: 'x' },

  // Горы
  mountainsStart: 1000,
  mountainsRamp: 1800,
  mountainFloor: 80,
  mountainScale: 0.65,

  // Глобальный рост после «полки»
  growthStart: 2800,
  growthRate: 1 / 10000,

  // Ridged-noise компоненты
  ridges: [
    { freq: 0.00085, seed: 0.4, sharp: 5.2, amp: 300, swap: false },
    { freq: 0.0022, seed: 1.1, sharp: 4.0, amp: 130, swap: false },
    { freq: 0.0055, seed: 2.9, sharp: 2.4, amp: 45, swap: false },
    { freq: 0.0135, seed: 3.6, sharp: 1.3, amp: 15, swap: false },
    { freq: 0.0013, seed: 5.2, sharp: 3.5, amp: 180, swap: true },
    { freq: 0.0041, seed: 6.8, sharp: 1.4, amp: 60, swap: true },
  ],

  // Шум поверх гор
  noise: {
    heightRef: 500,
    bigFreq: 0.0035,
    bigOct: 3,
    bigAmp: 200,
    smallFreq: 0.018,
    smallOct: 2,
    smallAmp: 80,
  },

  // Плоская зона вокруг босса
  safeRadius: 6,
  safeRamp: 14,
}

/* ---------- Цвета рельефа по высоте ---------- */
export const TERRAIN_STOPS = [
  { h: -20, color: 0x1f3f15 },
  { h: -10, color: 0x3f6e2a },
  { h: 0, color: 0x6cbf4a },
  { h: 50, color: 0x89ec6a },
  { h: 150, color: 0x91ce7e },
  { h: 250, color: 0x8a8068 },
  { h: 300, color: 0x55504a },
  { h: 400, color: 0xeef3f8 },
  { h: 620, color: 0xffffff },
]

/* ---------- Текстура земли ---------- */
export const GROUND_TEX = {
  size: 256,
  base: '#e8e8e8',
  spots: 420,
  spotMin: 3,
  spotMax: 16,
  spotAlphaMin: 0.04,
  spotAlphaMax: 0.09,
  tile: 6,
}

/* ---------- Чанки 3D ---------- */
export const CHUNKS = {
  size: 200,
  segments: 40,
  loadForward: 5,
  loadBack: 1,
  loadSide: 3,
  unloadMargin: 1,
  perFrame: 3,
}

/* ---------- Дальние тайлы (2D-режим) ---------- */
export const FAR_TILES = {
  size: 1600,
  segments: 120,
  loadRadius: 2,
  unloadRadius: 3,
  perFrame: 3,
}

/* ---------- Overlay-точки (деревья в 2D) ---------- */
export const OVERLAY = {
  size: 1600,
  segments: 120,
  canvasSize: 1024,
  loadRadius: 2,
  unloadRadius: 3,
  perFrame: 1,
  points: 2200,
  safeRadius: 16,
  rockRatio: 0.18,
  bigTreeRatio: 0.35,
  rockColor: 'rgba(110, 102, 90, 0.7)',
  bigTreeColor: 'rgba(18, 55, 16, 0.9)',
  smallTreeColor: 'rgba(28, 75, 22, 0.75)',
}

/* ---------- Пропсы ---------- */
export const PROPS = {
  density: 2000, // деревьев/кустов/камней на чанк
  safeRadius: 16,
  thresholds: { pine: 0.45, oak: 0.6, bush: 0.82 },
  scales: {
    tree: [0.75, 1.45],
    rock: [0.6, 2.0],
  },
  shadow: {
    scale: 1.6,
    yOffset: 0.12,
    opacity: 0.32,
    color: 0x0a1a10,
    polygonOffset: -1,
  },
  colors: {
    trunk: 0x7a4a24,
    pine: 0x2f7d32,
    oak: 0x3f9440,
    bush: 0x2f7d32,
    rock: 0x8a8479,
  },
  material: {
    roughness: 0.92,
    metalness: 0,
  },
}

/* ---------- Босс ---------- */
export const BOSS = {
  position: [-2.6, 0, 0],
  colors: {
    skin: 0xd94f6b,
    dark: 0x2b2233,
    accent: 0xffd75e,
  },
}

/* ---------- Ракета ---------- */
export const ROCKET = {
  colors: {
    body: 0xf2f4f8,
    red: 0xe63946,
    glass: 0x2b3a55,
  },
  flame: {
    outer: 0xffb703,
    inner: 0xfff6d0,
    aligned: 0x9fe8ff,
    misaligned: 0xffb703,
  },
  exhaustLight: 0xff9a3c,
}

/* ---------- Камера ---------- */
export const CAMERA = {
  fov: 55,
  near: 0.1,
  far: 3000,
  initial: [6, 8, 26],

  maxViewHeight: 1000,
  baseAngle: 20,
  maxAngle: 60,

  baseRadius: 22,
  speedRadiusK: 0.12,
  maxSpeedRadius: 20,

  leadTime: -0.02,
  followBase: 7,
  followSpeedK: 0.15,
  followMaxSpeed: 18,
  blendIn: 3.0,
  blendOut: 1.8,

  lookAheadBase: 5,
  lookAheadBehind: 10,
  lookAheadAltK: 0.8,

  shakeDecayK: 2.2,
  shakeOnLand: 0.9,
  shakeAmpK: 0.5,
}

/* ---------- LOD ---------- */
export const LOD = {
  changeAltitude: 400,
  sampleRadius: 200,
  sampleCount: 8,
  fadeIn: 1.4,
  fadeOut: 2.0,
}

/* ---------- Игровые константы ---------- */
export const GAME = {
  gravity: 9.8,
  restY: 0.95,
  launchAngle: (20 * Math.PI) / 180,

  angAcc: 8.0,
  angDamp: 0.8,
  angMax: 18.0,

  initialCoins: 0,
  initialBest: 0,
  initialUpgrades: { power: 1, aero: 1, fuel: 1, thrust: 1 },
}

/* ---------- Апгрейды ---------- */
export const UPGRADES = [
  {
    key: 'power',
    icon: '🦵',
    name: 'Сила пинка',
    desc: 'Дальше и выше',
    base: 40,
    growth: 1.6,
  },
  {
    key: 'aero',
    icon: '🪶',
    name: 'Аэродинамика',
    desc: 'Меньше торможения',
    base: 45,
    growth: 1.6,
  },
  {
    key: 'fuel',
    icon: '⛽',
    name: 'Бак топлива',
    desc: 'Дольше ускорение',
    base: 35,
    growth: 1.55,
  },
  {
    key: 'thrust',
    icon: '🔥',
    name: 'Тяга двигателя',
    desc: 'Сильнее ускорение',
    base: 50,
    growth: 1.65,
  },
]

/* ---------- Формулы ---------- */
export const RULES = {
  launchSpeed: (u) => 20 + u.power * 6,
  maxFuel: (u) => 2.0 + (u.fuel - 1) * 0.45,
  thrustAcc: (u) => 12 + (u.thrust - 1) * 4,
  dragCoef: (u) => 0.0025 / (1 + (u.aero - 1) * 0.4),
  airDensity: (y) => Math.exp(-Math.max(0, y) / 20000),
  upgradeCost: (u, lvl) => Math.floor(u.base * Math.pow(u.growth, lvl - 1)),
}

/* ---------- UI ---------- */
export const UI = {
  toastDuration: 900,
  toastColors: {
    default: '#fff',
    upgrade: '#ffd75e',
    land: '#7dffa0',
  },
}
