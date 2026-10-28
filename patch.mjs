// patch.mjs — split scripts/config.js → _config_core.ts + _config_world.ts
//             + _config_game.ts + config.ts (barrel).
//
// Run: node patch.mjs   (из корня проекта)
import fs from 'node:fs'
import path from 'node:path'

const read = (p) => fs.readFileSync(p, 'utf-8')
const write = (p, content) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf-8')
}
const exists = (p) => fs.existsSync(p)
const rename = (a, b) => fs.renameSync(a, b)

// ---------- Guard ----------
if (!exists('scripts/config.js')) {
  if (exists('scripts/config.ts') && exists('scripts/_config_core.ts')) {
    console.log('⏭️  Patch already applied')
    process.exit(0)
  }
  console.error('❌ scripts/config.js not found (run from project root)')
  process.exit(1)
}
if (exists('scripts/config.ts') && exists('scripts/_config_core.ts')) {
  console.log('⏭️  Patch already applied')
  process.exit(0)
}

// ---------- Read + strip JSDoc {const} casts (валидны в .js, не нужны в .ts) ----------
const original = read('scripts/config.js')

// CRLF → LF: иначе split(SEP) не находит ни одного разделителя на Windows.
// Заодно страхует от смешанных переводов строк (часть файла \n, часть \r\n).
const src = original.replace(/\r\n?/g, '\n').replace(/\/\*\* @type \{const\} \*\//g, '')

// ---------- Split by section header ----------
// SEP — канонический вид (LF, ровно 64 '='), используется и для split, и для склейки.
// Терпимый регэксп: 8+ '=', хвостовые пробелы/табы перед \n — чтобы не падать,
// если в config.js кто-то случайно сдвинет одну '=' или поставит пробел в конце.
const SEP = '\n/* ================================================================\n'
const SEP_RE = /\n\/\* ={8,}[ \t]*\n/
const chunks = src.split(SEP_RE)

// Диагностика: какие секции реально нашли. Помогает, если byTitle упадёт
// (сразу видно — переименовали заголовок или это CRLF где-то в середине файла).
if (chunks.length > 1) {
  console.log(`📑 Найдено секций: ${chunks.length - 1}`)
  chunks.slice(1).forEach((c) => {
    const nl = c.indexOf('\n')
    console.log('   •', c.slice(0, nl).trim())
  })
}
const sections = chunks.map((c, i) => {
  const nl = c.indexOf('\n')
  return {
    index: i,
    title: i === 0 ? '__FILE_HEADER__' : c.slice(0, nl).trim(),
    raw: (i === 0 ? '' : SEP) + c,
  }
})

function byTitle(prefix) {
  const s = sections.find((sec) => sec.title.startsWith(prefix))
  if (!s) {
    console.error(`❌ Section not found: "${prefix}"`)
    process.exit(1)
  }
  return s
}

// ---------- Hand-written replacement for GAME ----------
const GAME_CORE_SRC = `/* ================================================================
   GAME_CORE — ядро цикла: частота физики, ограничения, коллизии.
   Объединяется в GAME в config.ts вместе с GAME_GAME.
================================================================ */
export const GAME_CORE = {
  /**
   * Частота шага физики (Гц).
   * 60 — быстро, но при 400+ м/с Euler-интеграция даёт заметную ошибку.
   * 120 — компромисс (рекомендуется).
   * 240 — максимальная точность, ×2 CPU к физике.
   * ВАЖНО: калькулятор (calculator/simulation.js) берёт dt отсюда же.
   */
  physicsHz: 120,

  /**
   * Максимальный dt кадра (сек). Верхний предел accumulator —
   * защита от «спирали смерти» при долгих фризах.
   */
  maxFrameDt: 0.1,

  /**
   * Потолок шагов физики за кадр. 0 = авто из maxFrameDt × physicsHz + 2.
   */
  maxPhysicsSteps: 0,

  /**
   * Swept-коллизия: сэмплируем отрезок prevPos → pos и ловим
   * «пролёт сквозь гору» на высокой горизонтальной скорости.
   */
  collision: {
    swept: true,
    sweptSamples: 4,
  },
}
`

const GAME_GAME_SRC = `/* ================================================================
   GAME_GAME — игровой баланс и параметры полёта.
   Объединяется в GAME в config.ts вместе с GAME_CORE.
================================================================ */
export const GAME_GAME = {
  /** Гравитация (м/с²). 9.8 — как в реальности. */
  gravity: 9.8,

  /** Высота ракеты над землёй в состоянии покоя (м). */
  restY: 0.95,

  /** Пауза (с) между «камера вернулась к стартовой позиции» */
  prekickDelay: 0.3,

  /** Порог «камера вернулась» (м). */
  prekickCamTolerance: 2.0,

  /** Начальный угол старта (радианы). 20° — оптимально для дальности. */
  launchAngle: (20 * Math.PI) / 180,

  /** Снос траектории в плоскости XZ (радианы). */
  flightYaw: Math.atan(1 / 100),

  /** Аэродинамическая стабилизация (рад/с). */
  aeroAlign: 0.2,

  /** Минимальная скорость (м/с), ниже которой стабилизация отключается. */
  aeroAlignMinSpeed: 5.0,

  /** Угловое ускорение от клавиши W/S (рад/с²). */
  angAcc: 5.0,

  /** Вязкое затухание угловой скорости (1/с). */
  angDamp: 0.8,

  /** Потолок угловой скорости (рад/с). */
  angMax: 18.0,

  /** Плотность воздуха по высоте (экспоненциальное падение). */
  airHeight: 6000,

  /** Высота отключения двигателей. */
  airEngineHeight: 10000,

  /** Общая сложность игры (0.75 - 2.0). */
  upgrade_cost_diff: 1.4,

  /** Сколько монет у игрока на старте. */
  initialCoins: 5,

  /** Рекорд дистанции на старте (м). */
  initialBest: 0,

  /** Начальные уровни апгрейдов. Каждый начинается с 1. */
  initialUpgrades: { power: 1, aero: 1, fuel: 1, thrust: 1 },
}
`

const RULES_PARAMS_SRC = `/* ================================================================
   RULES_PARAMS — параметры формул (чистые данные для config.html).
   Исполняемые функции RULES собираются в config.ts.
================================================================ */
export const RULES_PARAMS = {
  launchSpeed: { base: 20, mult: 6 },
  maxFuel: { base: 1.8, mult: 1.758 },
  thrustAcc: { base: 12, mult: 3.0 },

  /**
   * Коэффициент сопротивления воздуха в зависимости от угла атаки.
   * aligned, broadside, backward — Cd при α = 0°, 90°, 180°.
   * aeroScale — как апгрейд «Аэродинамика» снижает Cd.
   */
  drag: {
    aligned: 0.0025,
    broadside: 0.0155,
    backward: 0.0055,
    aeroScale: 0.45,
  },
}
`

// ---------- Section → target file map ----------
const worldSections = [
  byTitle('МИР И SEED'),
  byTitle('НЕБО'),
  byTitle('СВЕТ'),
  byTitle('ТУМАН'),
  byTitle('СМЕНА ДНЯ И НОЧИ'),
  byTitle('РЕЛЬЕФ'),
  byTitle('ЦВЕТА РЕЛЬЕФА ПО ВЫСОТЕ'),
  byTitle('ТЕКСТУРА ЗЕМЛИ'),
  byTitle('ЧАНКИ 3D'),
  byTitle('LOD'),
  byTitle('ДАЛЬНИЕ ТАЙЛЫ'),
  byTitle('OVERLAY'),
  byTitle('ПРОПСЫ'),
  byTitle('КОСМОС'),
  byTitle('SIGN'),
]

const coreSections = [
  byTitle('RENDERER'),
  byTitle('КАМЕРА'),
  byTitle('SAVE'),
  byTitle('UI'),
  byTitle('ЗВУКИ'),
  byTitle('GPU_HINT'),
  byTitle('QUALITY_PRESETS'),
  byTitle('FPS'),
]

const gameSections = [
  byTitle('БОСС'),
  byTitle('РАКЕТА'),
  byTitle('АПГРЕЙДЫ'),
  byTitle('СУНДУКИ'),
  byTitle('ГЕМЫ'),
  byTitle('СПОСОБНОСТИ'),
  byTitle('ДОСТИЖЕНИЯ'),
]

const CORE_HEADER = `/* ================================================================
   _config_core.ts — настройки ядра игры.
   Секции: RENDERER, CAMERA, SAVE, GAME_CORE, UI, SOUNDS, GPU_HINT,
   QUALITY_PRESETS, FPS.

   ФАЙЛ СОДЕРЖИТ ТОЛЬКО ДАННЫЕ — никакой логики.
   ================================================================ */

`

const WORLD_HEADER = `/* ================================================================
   _config_world.ts — настройки мира.
   Секции: WORLD_SEED, SKY, LIGHTS, FOG, DAYNIGHT, TERRAIN,
   TERRAIN_STOPS, GROUND_TEX, TERRAIN_COLOR_NOISE, CHUNKS, LOD,
   FAR_TILES, OVERLAY, PROPS, SPACE, SIGN.

   ФАЙЛ СОДЕРЖИТ ТОЛЬКО ДАННЫЕ — никакой логики.
   ================================================================ */

`

const GAME_HEADER = `/* ================================================================
   _config_game.ts — игровые параметры, баланс, карточки, способности.
   Секции: GAME_GAME, BOSS, ROCKET, UPGRADES, RULES_PARAMS, CHESTS,
   GEMS, CARDS, ABILITIES, ACHIEVEMENTS.

   ФАЙЛ СОДЕРЖИТ ТОЛЬКО ДАННЫЕ — исполняемые RULES собираются в config.ts.
   ================================================================ */

`

const coreFile = CORE_HEADER + coreSections.map((s) => s.raw).join('') + '\n' + GAME_CORE_SRC
const worldFile = WORLD_HEADER + worldSections.map((s) => s.raw).join('') + '\n'
const gameFile =
  GAME_HEADER +
  GAME_GAME_SRC +
  '\n' +
  gameSections.map((s) => s.raw).join('') +
  '\n' +
  RULES_PARAMS_SRC

// ---------- Barrel ----------
const BARREL = `/* ================================================================
   config.ts — баррель: объединяет 3 конфига и собирает RULES.

   Экспортирует те же символы, что и старый scripts/config.js,
   чтобы все существующие импорты \`import * as CFG from '../config.js'\`
   продолжали работать (Vite резолвит config.js → config.ts).

   Дополнительно:
   • GAME = { ...GAME_CORE, ...GAME_GAME } — тот же объект, что раньше.
   • RULES — исполняемые функции, построенные из RULES_PARAMS + GAME.
   • applyQualityPreset(presetId) — применяет пресет к CFG.
     Вызывается из lib/quality.js → lib/settings.js.
   ================================================================ */

import { RENDERER, QUALITY_PRESETS, GAME_CORE } from './_config_core.js'
import {
  CHUNKS,
  PROPS,
  LIGHTS,
  FAR_TILES,
  OVERLAY,
  SPACE,
  LOD,
  FOG,
} from './_config_world.js'
import { CHESTS, GAME_GAME, RULES_PARAMS } from './_config_game.js'

export * from './_config_core.js'
export * from './_config_world.js'
export * from './_config_game.js'

// ─── Объединённый GAME (тот же набор полей, что и раньше) ───
export const GAME = { ...GAME_CORE, ...GAME_GAME }

// ─── Исполняемые RULES, собранные из RULES_PARAMS + GAME ───
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

// ─── Применение пресета графики (как раньше в lib/quality.js) ───
export function applyQualityPreset(presetId: string): void {
  const preset =
    (QUALITY_PRESETS as Record<string, typeof QUALITY_PRESETS.medium>)[presetId] ||
    QUALITY_PRESETS.medium

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
    Object.assign(CHESTS.beam, preset.chestBeam as any)
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

write('scripts/_config_core.ts', coreFile)
write('scripts/_config_world.ts', worldFile)
write('scripts/_config_game.ts', gameFile)
write('scripts/config.ts', BARREL)

// ---------- Patch quality.js ----------
{
  const qPath = 'scripts/lib/quality.js'
  let q = read(qPath)
  const NEW_APPLY = `export function apply(presetId) {
  // Тело apply переехало в config.ts::applyQualityPreset,
  // чтобы config.html мог применять пресеты без импорта lib/.
  CFG.applyQualityPreset(presetId)
}`

  if (q.includes('CFG.applyQualityPreset(presetId)')) {
    console.log('⏭️  quality.js: apply() уже делегирует')
  } else {
    const re = /export function apply\(presetId\) \{[\s\S]*?\n\}/
    if (re.test(q)) {
      q = q.replace(re, NEW_APPLY)
      write(qPath, q)
      console.log('✅ quality.js: apply() → CFG.applyQualityPreset')
    } else {
      console.warn('⚠️  quality.js: не нашли export function apply() — пропускаем')
    }
  }
}

// ---------- Backup old config.js ----------
rename('scripts/config.js', 'scripts/config.js.bak')

// ---------- Report ----------
console.log('')
console.log('🎉 Готово.')
console.log('')
console.log('Создано:')
console.log('  scripts/_config_core.ts    (~20 секций)')
console.log('  scripts/_config_world.ts   (~15 секций)')
console.log('  scripts/_config_game.ts    (~10 секций)')
console.log('  scripts/config.ts          ← баррель')
console.log('')
console.log('Изменено:')
console.log('  scripts/lib/quality.js     apply() → CFG.applyQualityPreset')
console.log('')
console.log('Переименовано:')
console.log('  scripts/config.js → scripts/config.js.bak (можно удалить)')
console.log('')
console.log('Проверь:')
console.log('  npm run dev                 # игра')
console.log('  localhost:5173/calculator/  # калькулятор')
