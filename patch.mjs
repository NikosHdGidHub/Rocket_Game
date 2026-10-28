// patch3.mjs — v2: as const, no formulas, GAME split into
//   GAME_CORE + PHYSICS + CONTROL + GAME_START.
// Run: node patch3.mjs
import fs from 'node:fs'
import path from 'node:path'

const read = (p) => fs.readFileSync(p, 'utf-8')
const write = (p, content) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf-8')
}
const exists = (p) => fs.existsSync(p)

// ---------- Guard ----------
if (!exists('scripts/config.js.bak')) {
  console.error('❌ scripts/config.js.bak not found. Run patch.mjs first.')
  process.exit(1)
}
// ---------- Read original (with @type {const}), strip annotations ----------
const original = read('scripts/config.js.bak')
// config.js.bak — байт-копия исходного config.js, а он CRLF.
// split(SEP) на CRLF не находит разделителей → sections = 1 (__HEADER__).
// Нормализуем ДО split — тот же приём, что и в patch.mjs.
const src = original.replace(/\r\n?/g, '\n').replace(/\/\*\* @type \{const\} \*\//g, '')

// ---------- Split sections ----------
const SEP = '\n/* ================================================================\n'
const chunks = src.split(SEP)

const sections = chunks.map((c, i) => {
  if (i === 0) return { title: '__HEADER__', raw: c }
  const nl = c.indexOf('\n')
  return { title: c.slice(0, nl).trim(), raw: SEP + c }
})

function getSection(prefix) {
  const s = sections.find((sec) => sec.title.startsWith(prefix))
  if (!s) {
    console.error(`❌ Section not found: "${prefix}"`)
    process.exit(1)
  }
  return s
}

// ---------- addAsConst: insert " as const" at end of a specific export ----------
function addAsConst(raw, name) {
  const prefix = `export const ${name} = `
  const start = raw.indexOf(prefix)
  if (start === -1) return raw
  const exprStart = start + prefix.length

  let i = exprStart
  let depth = 0
  let inStr = false
  let strCh = ''

  while (i < raw.length) {
    const ch = raw[i]
    if (inStr) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === strCh) {
        inStr = false
        i++
        continue
      }
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = true
      strCh = ch
      i++
      continue
    }
    if (ch === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i++
      continue
    }
    if (ch === '/' && raw[i + 1] === '*') {
      i += 2
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      i++
      if (depth === 0) return raw.slice(0, i) + ' as const' + raw.slice(i)
      continue
    }
    if (depth === 0 && (ch === '\n' || ch === ';')) {
      let endPos = i
      while (endPos > exprStart && /\s/.test(raw[endPos - 1])) endPos--
      return raw.slice(0, endPos) + ' as const' + raw.slice(endPos)
    }
    i++
  }
  return raw
}

// ---------- Helper: apply transform + optional as const ----------
function fixSection(title, transformRaw, asConstNames = []) {
  const sec = getSection(title)
  let raw = transformRaw ? transformRaw(sec.raw) : sec.raw
  for (const name of asConstNames) raw = addAsConst(raw, name)
  return raw
}

// ---------- Specific formula fixes ----------
const terrainRaw = fixSection(
  'РЕЛЬЕФ',
  (r) => r.replace('growthRate: 1 / 10000,', 'growthRate: 0.0001,'),
  ['TERRAIN']
)

const rocketRaw = fixSection(
  'РАКЕТА',
  (r) => {
    let s = r
    s = s.replace('recordingTimeLimit: 5 * 60,', 'recordingTimeLimit: 300,')
    s = s.replace('minSamplesLimit: 3 * 6 * 30,', 'minSamplesLimit: 540,')
    return s
  },
  ['ROCKET']
)

const achRaw = fixSection(
  'ДОСТИЖЕНИЯ',
  (r) => r.replace('timeLimit: 25 * 60 * 1000,', 'timeLimit: 1500000,'),
  ['ACHIEVEMENTS']
)

// CHESTS: remove private consts, inline all arrays (no as const — beam mutable)
const chestsRaw = fixSection('СУНДУКИ', (r) => {
  let s = r
  s = s.replace(/const _chestX = \[[\s\S]*?\]\n+/, '')
  s = s.replace(/const _specialChests = \{[\s\S]*?\}\n+/, '')
  s = s.replace(
    'xPositions: _chestX,',
    'xPositions: [3000, 5000, 8000, 12000, 17000, 23000, 30000, 38000],'
  )
  s = s.replace(
    'specialChests: _specialChests,',
    "specialChests: { 6000: 'forsage', 15000: 'forsage' },"
  )
  s = s.replace(
    /allPositions: \[\.\.\._chestX, \.\.\.Object\.keys\(_specialChests\)\.map\(Number\)\]\.sort\(\(a, b\) => a - b\),/,
    'allPositions: [3000, 5000, 6000, 8000, 12000, 15000, 17000, 23000, 30000, 38000],'
  )
  return s
})

// ---------- New sections ----------
const GAME_CORE_SECTION = `

/* ================================================================
   GAME_CORE — ядро игрового цикла: частота физики, коллизии,
   параметры покоя и старта полёта.
================================================================ */
export const GAME_CORE = ({
  /** Частота шага физики (Гц). */
  physicsHz: 120,

  /** Максимальный dt кадра (сек). */
  maxFrameDt: 0.1,

  /** Потолок шагов физики за кадр. 0 = авто. */
  maxPhysicsSteps: 0,

  /** Swept-коллизия. */
  collision: {
    swept: true,
    sweptSamples: 4,
  },

  /** Высота ракеты над землёй в состоянии покоя (м). */
  restY: 0.95,

  /** Пауза (с) перед стартом. */
  prekickDelay: 0.3,

  /** Порог «камера вернулась» (м). */
  prekickCamTolerance: 2.0,

  /** Отношение 1 м по Z на flightYawRatio м по X. */
  flightYawRatio: 100,
}) as const
`

const PHYSICS_SECTION = `

/* ================================================================
   PHYSICS — физика полёта.
================================================================ */
export const PHYSICS = ({
  /** Гравитация (м/с²). */
  gravity: 9.8,

  /** Плотность воздуха по высоте. */
  airHeight: 6000,

  /** Высота отключения двигателей. */
  airEngineHeight: 10000,

  /** Начальный угол старта, °. */
  launchAngleDeg: 20,
}) as const
`

const CONTROL_SECTION = `

/* ================================================================
   CONTROL — управление и аэродинамика.
================================================================ */
export const CONTROL = ({
  /** Аэродинамическая стабилизация (рад/с). */
  aeroAlign: 0.2,

  /** Минимальная скорость стабилизации. */
  aeroAlignMinSpeed: 5.0,

  /** Угловое ускорение от W/S (рад/с²). */
  angAcc: 5.0,

  /** Вязкое затухание (1/с). */
  angDamp: 0.8,

  /** Потолок угловой скорости (рад/с). */
  angMax: 18.0,
}) as const
`

const GAME_START_SECTION = `

/* ================================================================
   GAME_START — стартовые значения игрока и сложность.
================================================================ */
export const GAME_START = ({
  /** Общая сложность игры. */
  upgrade_cost_diff: 1.4,

  /** Монет на старте. */
  initialCoins: 5,

  /** Рекорд на старте (м). */
  initialBest: 0,

  /** Начальные уровни апгрейдов. */
  initialUpgrades: { power: 1, aero: 1, fuel: 1, thrust: 1 },
}) as const
`

const RULES_PARAMS_SECTION = `

/* ================================================================
   RULES_PARAMS — параметры формул (данные для config.html).
   Исполняемые функции RULES собираются в config.ts.
================================================================ */
export const RULES_PARAMS = ({
  launchSpeed: { base: 20, mult: 6 },
  maxFuel: { base: 1.8, mult: 1.758 },
  thrustAcc: { base: 12, mult: 3.0 },
  drag: {
    aligned: 0.0025,
    broadside: 0.0155,
    backward: 0.0055,
    aeroScale: 0.45,
  },
}) as const
`

// ================================================================
//  _config_core.ts
// ================================================================
const CORE_HEADER = `/* ================================================================
   _config_core.ts — настройки ядра игры.
   Секции: RENDERER, CAMERA, SAVE, GAME_CORE, UI, SOUNDS, GPU_HINT,
           QUALITY_PRESETS, FPS.

   ФАЙЛ СОДЕРЖИТ ТОЛЬКО ДАННЫЕ. Никаких формул.
   Всё, что требует вычислений, собирается в config.ts.

   Правило as const:
   • Применяется к секциям, которые не мутируются в рантайме.
   • RENDERER мутируется в applyQualityPreset(), поэтому БЕЗ as const.
================================================================ */
`

const coreFile =
  CORE_HEADER +
  getSection('RENDERER').raw +
  fixSection('КАМЕРА', null, ['CAMERA']) +
  fixSection('SAVE', null, ['SAVE']) +
  GAME_CORE_SECTION +
  fixSection('UI', null, ['UI']) +
  fixSection('ЗВУКИ', null, ['SOUNDS']) +
  fixSection('GPU_HINT', null, ['GPU_HINT']) +
  fixSection('QUALITY_PRESETS', null, ['QUALITY_PRESETS']) +
  fixSection('FPS', null, ['FPS'])

// ================================================================
//  _config_world.ts
// ================================================================
const WORLD_HEADER = `/* ================================================================
   _config_world.ts — настройки мира.
   Секции: WORLD_SEED, SKY, LIGHTS, FOG, DAYNIGHT, TERRAIN,
           TERRAIN_STOPS, GROUND_TEX, TERRAIN_COLOR_NOISE, CHUNKS,
           LOD, FAR_TILES, OVERLAY, PROPS, SPACE, SIGN.

   ФАЙЛ СОДЕРЖИТ ТОЛЬКО ДАННЫЕ. Никаких формул.

   Правило as const:
   • Применяется к неизменяемым данным.
   • LIGHTS, FOG, CHUNKS, LOD, FAR_TILES, OVERLAY, PROPS, SPACE —
     мутируются в applyQualityPreset(), поэтому БЕЗ as const.
================================================================ */
`

const worldFile =
  WORLD_HEADER +
  fixSection('МИР И SEED', null, ['WORLD_SEED']) +
  fixSection('НЕБО', null, ['SKY']) +
  getSection('СВЕТ').raw + // mutable
  getSection('ТУМАН').raw + // mutable
  fixSection('СМЕНА ДНЯ И НОЧИ', null, ['DAYNIGHT']) +
  terrainRaw +
  fixSection('ЦВЕТА РЕЛЬЕФА ПО ВЫСОТЕ', null, ['TERRAIN_STOPS']) +
  fixSection('ТЕКСТУРА ЗЕМЛИ', null, ['GROUND_TEX', 'TERRAIN_COLOR_NOISE']) +
  getSection('ЧАНКИ 3D').raw + // mutable
  getSection('LOD').raw + // mutable
  getSection('ДАЛЬНИЕ ТАЙЛЫ').raw + // mutable
  getSection('OVERLAY').raw + // mutable
  getSection('ПРОПСЫ').raw + // mutable
  getSection('КОСМОС').raw + // mutable
  fixSection('SIGN', null, ['SIGN'])

// ================================================================
//  _config_game.ts
// ================================================================
const GAME_HEADER = `/* ================================================================
   _config_game.ts — игровые параметры, баланс, карточки, способности.
   Секции: PHYSICS, CONTROL, GAME_START, UPGRADES, RULES_PARAMS,
           CHESTS, GEMS, CARDS, ABILITIES, ACHIEVEMENTS, BOSS, ROCKET.

   ФАЙЛ СОДЕРЖИТ ТОЛЬКО ДАННЫЕ. Функции RULES собираются в config.ts.

   Правило as const:
   • Применяется к неизменяемым данным.
   • CHESTS мутируется в applyQualityPreset() (beam), поэтому БЕЗ as const.
================================================================ */
`

const gameFile =
  GAME_HEADER +
  PHYSICS_SECTION +
  CONTROL_SECTION +
  GAME_START_SECTION +
  fixSection('АПГРЕЙДЫ', null, ['UPGRADES']) +
  RULES_PARAMS_SECTION +
  chestsRaw + // mutable (no as const)
  fixSection('ГЕМЫ', null, ['GEMS', 'CARDS']) +
  fixSection('СПОСОБНОСТИ', null, ['ABILITIES']) +
  achRaw +
  fixSection('БОСС', null, ['BOSS']) +
  rocketRaw

// ================================================================
//  config.ts (barrel)
// ================================================================
const BARREL = `/* ================================================================
   config.ts — баррель: объединяет три конфига и собирает GAME/RULES.

   Экспортирует те же символы, что и старый scripts/config.js,
   чтобы импорты \`import * as CFG from '../config.js'\` продолжали
   работать (Vite резолвит config.js → config.ts).

   Дополнительно:
   • GAME = { ...GAME_CORE, ...PHYSICS, ...CONTROL, ...GAME_START }
     + вычисленные launchAngle и flightYaw.
   • RULES — исполняемые функции из RULES_PARAMS + GAME.
   • applyQualityPreset(presetId) — применяет пресет к CFG.
   ================================================================ */

import { GAME_CORE, RENDERER, QUALITY_PRESETS } from './_config_core.js'
import {
  LIGHTS,
  FOG,
  CHUNKS,
  LOD,
  FAR_TILES,
  OVERLAY,
  PROPS,
  SPACE,
} from './_config_world.js'
import { PHYSICS, CONTROL, GAME_START, RULES_PARAMS, CHESTS } from './_config_game.js'

export * from './_config_core.js'
export * from './_config_world.js'
export * from './_config_game.js'

// ---- GAME = core + physics + control + start + computed ----
const { flightYawRatio, ...gameCoreRest } = GAME_CORE
const { launchAngleDeg, ...physicsRest } = PHYSICS

export const GAME = {
  ...gameCoreRest,
  ...physicsRest,
  ...CONTROL,
  ...GAME_START,
  flightYaw: Math.atan(1 / flightYawRatio),
  launchAngle: (launchAngleDeg * Math.PI) / 180,
}

// ---- RULES = pure functions ----
export const RULES = {
  launchSpeed: (u: { power: number }) =>
    RULES_PARAMS.launchSpeed.base + u.power * RULES_PARAMS.launchSpeed.mult,

  maxFuel: (u: { fuel: number }) =>
    RULES_PARAMS.maxFuel.base + (u.fuel - 1) * RULES_PARAMS.maxFuel.mult,

  thrustAcc: (u: { thrust: number }) =>
    RULES_PARAMS.thrustAcc.base + (u.thrust - 1) * RULES_PARAMS.thrustAcc.mult,

  drag: RULES_PARAMS.drag,

  dragCoefAtAngle: (u: { aero: number }, alpha: number) => {
    const D = RULES_PARAMS.drag
    const c = Math.cos(alpha)
    const a = D.broadside
    const b = (D.aligned - D.backward) / 2
    const c2 = D.aligned - a - b
    const base = a + b * c + c2 * c * c
    const scale = 1 / (1 + (u.aero - 1) * D.aeroScale)
    return base * scale
  },

  airDensity: (y: number) => Math.exp(-Math.max(0, y) / GAME.airHeight),

  upgradeCost: (u: { base: number; growth: number }, lvl: number) =>
    Math.floor(u.base * Math.pow(u.growth * GAME.upgrade_cost_diff, lvl - 1)),
}

// ---- applyQualityPreset ----
export function applyQualityPreset(presetId: string): void {
  // Приводим через unknown: union QUALITY_PRESETS слишком узкий
  // (у low.chestBeam нет quality, у medium — есть).
  const PRESETS = QUALITY_PRESETS as unknown as Record<string, any>
  const preset = PRESETS[presetId] || PRESETS.medium

  RENDERER.antialias = preset.renderer.antialias
  RENDERER.pixelRatioCap = preset.renderer.pixelRatioCap
  RENDERER.maxChunksPerFrame = preset.renderer.maxChunksPerFrame

  PROPS.density = preset.props.density
  PROPS.maxRenderDistance = preset.props.maxRenderDistance

  LIGHTS.shadow.enabled = preset.lights.shadow.enabled

  CHUNKS.segments = preset.chunks.segments

  FAR_TILES.segments = preset.farTiles.segments
  FAR_TILES.segmentsHigh = preset.farTiles.segmentsHigh

  if (typeof preset.overlay.enabled === 'boolean') {
    OVERLAY.enabled = preset.overlay.enabled
  }
  OVERLAY.canvasSize = preset.overlay.canvasSize

  SPACE.stars.count = preset.space.stars.count
  SPACE.spheres.maxCount = preset.space.spheres.maxCount

  if (preset.chestBeam) {
    Object.assign(CHESTS.beam, preset.chestBeam)
  }

  if (preset.lod) {
    if (typeof preset.lod.changeAltitude === 'number') {
      LOD.changeAltitude = preset.lod.changeAltitude
    }
    if (typeof preset.lod.changeBack === 'number') {
      LOD.changeBack = preset.lod.changeBack
    }
  }

  if (preset.fog) {
    if (typeof preset.fog.far3D === 'number') {
      FOG.far3D = preset.fog.far3D
    }
  }
}
`

// ---------- Write ----------
write('scripts/_config_core.ts', coreFile)
write('scripts/_config_world.ts', worldFile)
write('scripts/_config_game.ts', gameFile)
write('scripts/config.ts', BARREL)

// ---------- Verify quality.js ----------
{
  const qPath = 'scripts/lib/quality.js'
  if (exists(qPath)) {
    const q = read(qPath)
    if (!q.includes('CFG.applyQualityPreset(presetId)')) {
      console.warn('⚠️  quality.js: apply() не делегирует в CFG.applyQualityPreset')
      console.warn('   Смотри patch-fix.mjs / patch.mjs')
    }
  }
}

console.log('')
console.log('🎉 Готово.')
console.log('')
console.log('Перезаписано:')
console.log('  scripts/_config_core.ts')
console.log('  scripts/_config_world.ts')
console.log('  scripts/_config_game.ts')
console.log('  scripts/config.ts')
console.log('')
console.log('Изменения:')
console.log('  • as const — на неизменяемых секциях (mutable = без as const)')
console.log('  • Формулы → литералы:')
console.log('      growthRate: 1/10000            → 0.0001')
console.log('      recordingTimeLimit: 5*60        → 300')
console.log('      minSamplesLimit: 3*6*30         → 540')
console.log('      timeLimit: 25*60*1000           → 1500000')
console.log('      allPositions                    → литеральный массив')
console.log('  • launchAngle / flightYaw вычисляются в config.ts')
console.log('  • GAME = GAME_CORE + PHYSICS + CONTROL + GAME_START')
console.log('  • RULES_PARAMS (данные) + RULES (функции в config.ts)')
