// patch5.mjs — v3:
//  1) allPositions → вычисляется в config.ts (не в _config_game.ts).
//  2) applyQualityPreset создаёт НОВЫЕ объекты (let-биндинги), не мутирует.
//  3) Virtual-поля (перезаписываемые пресетами) — строки-маркеры.
//  4) as const на всех секциях.
// Run: node patch5.mjs
import fs from 'node:fs'

const read = (p) => {
  const raw = fs.readFileSync(p, 'utf-8')
  return { text: raw.replace(/\r\n/g, '\n'), crlf: raw.includes('\r\n') }
}
const save = (p, { text, crlf }) => {
  fs.writeFileSync(p, crlf ? text.replace(/\n/g, '\r\n') : text, 'utf-8')
}

function replaceOrDie(obj, oldStr, newStr, label) {
  if (!obj.text.includes(oldStr)) {
    console.error(`\n❌ Not found: ${label}`)
    console.error('Looking for:')
    console.error(oldStr.slice(0, 400))
    process.exit(1)
  }
  obj.text = obj.text.replace(oldStr, newStr)
}

// ============================================================
//  _config_core.ts — RENDERER virtuals + as const
// ============================================================
{
  const f = read('scripts/_config_core.ts')

  replaceOrDie(
    f,
    '  antialias: false,\n\n  /**\n   * Ограничение pixel ratio',
    "  antialias: 'По умолчанию: false — устанавливается в пресетах',\n\n  /**\n   * Ограничение pixel ratio",
    'RENDERER.antialias'
  )
  replaceOrDie(
    f,
    '  pixelRatioCap: 2,\n\n  /**\n   * Экспозиция ACES',
    "  pixelRatioCap: 'По умолчанию: 2 — устанавливается в пресетах',\n\n  /**\n   * Экспозиция ACES",
    'RENDERER.pixelRatioCap'
  )
  replaceOrDie(
    f,
    '  maxChunksPerFrame: 2,\n}',
    "  maxChunksPerFrame: 'По умолчанию: 2 — устанавливается в пресетах',\n} as const",
    'RENDERER.maxChunksPerFrame + as const'
  )

  save('scripts/_config_core.ts', f)
  console.log('✅ _config_core.ts: RENDERER virtuals + as const')
}

// ============================================================
//  _config_world.ts — virtuals + as const на 8 секциях
// ============================================================
{
  const f = read('scripts/_config_world.ts')

  // LIGHTS.shadow.enabled
  replaceOrDie(
    f,
    '  shadow: {\n    enabled: true, // ← включаем',
    "  shadow: {\n    enabled: 'По умолчанию: true — устанавливается в пресетах',",
    'LIGHTS.shadow.enabled'
  )

  // FOG.far3D
  replaceOrDie(
    f,
    '  near3D: 100,\n  far3D: 2000,',
    "  near3D: 100,\n  far3D: 'По умолчанию: 2000 — устанавливается в пресетах',",
    'FOG.far3D'
  )

  // CHUNKS.segments
  replaceOrDie(
    f,
    '  segments: 53,\n\n  /** Сколько чанков грузить ВПЕРЁД',
    "  segments: 'По умолчанию: 53 — устанавливается в пресетах',\n\n  /** Сколько чанков грузить ВПЕРЁД",
    'CHUNKS.segments'
  )

  // LOD.changeAltitude / changeBack
  replaceOrDie(
    f,
    '  changeAltitude: 1100,',
    "  changeAltitude: 'По умолчанию: 1100 — устанавливается в пресетах',",
    'LOD.changeAltitude'
  )
  replaceOrDie(
    f,
    '  changeBack: 1000,',
    "  changeBack: 'По умолчанию: 1000 — устанавливается в пресетах',",
    'LOD.changeBack'
  )

  // FAR_TILES.segments / segmentsHigh
  replaceOrDie(
    f,
    '  /** Сегментов на сторону дальнего тайла (сетка). 120 - 200*/\n  segments: 190,',
    "  /** Сегментов на сторону дальнего тайла (сетка). 120 - 200*/\n  segments: 'По умолчанию: 190 — устанавливается в пресетах',",
    'FAR_TILES.segments'
  )
  replaceOrDie(
    f,
    '  segmentsHigh: 53,',
    "  segmentsHigh: 'По умолчанию: 53 — устанавливается в пресетах',",
    'FAR_TILES.segmentsHigh'
  )

  // OVERLAY.enabled / canvasSize
  replaceOrDie(
    f,
    '/**Показывать точечные деревья в 2D-режиме.*/\n  enabled: true,',
    "/**Показывать точечные деревья в 2D-режиме.*/\n  enabled: 'По умолчанию: true — устанавливается в пресетах',",
    'OVERLAY.enabled'
  )
  replaceOrDie(
    f,
    '  canvasSize: 1024,',
    "  canvasSize: 'По умолчанию: 1024 — устанавливается в пресетах',",
    'OVERLAY.canvasSize'
  )

  // PROPS.density / maxRenderDistance
  replaceOrDie(
    f,
    '  /** Плотность попыток на чанк. Количество объектов на чанк */\n  density: 3500,',
    "  /** Плотность попыток на чанк. Количество объектов на чанк */\n  density: 'По умолчанию: 3500 — устанавливается в пресетах',",
    'PROPS.density'
  )
  replaceOrDie(
    f,
    '  maxRenderDistance: 2000,',
    "  maxRenderDistance: 'По умолчанию: 2000 — устанавливается в пресетах',",
    'PROPS.maxRenderDistance'
  )

  // SPACE.stars.count / spheres.maxCount
  replaceOrDie(
    f,
    '    count: 2500,',
    "    count: 'По умолчанию: 2500 — устанавливается в пресетах',",
    'SPACE.stars.count'
  )
  replaceOrDie(
    f,
    '    maxCount: 4096,',
    "    maxCount: 'По умолчанию: 4096 — устанавливается в пресетах',",
    'SPACE.spheres.maxCount'
  )

  // Add "as const" to mutable sections (find the last `\n}\n` before next block)
  for (const name of ['LIGHTS', 'FOG', 'CHUNKS', 'LOD', 'FAR_TILES', 'OVERLAY', 'PROPS', 'SPACE']) {
    const re = new RegExp(`(export const ${name} = \\{[\\s\\S]*?)\\n\\}\\n`)
    if (re.test(f.text)) {
      f.text = f.text.replace(re, '$1\n} as const\n')
    } else {
      console.warn(`⚠️  Could not add as const to ${name}`)
    }
  }

  save('scripts/_config_world.ts', f)
  console.log('✅ _config_world.ts: virtuals + as const на 8 секциях')
}

// ============================================================
//  _config_game.ts — CHESTS → CHESTS_BASE, virtuals, allPositions removed
// ============================================================
{
  const f = read('scripts/_config_game.ts')

  // 1) Rename CHESTS → CHESTS_BASE
  replaceOrDie(
    f,
    'export const CHESTS = {',
    'export const CHESTS_BASE = {',
    'CHESTS → CHESTS_BASE'
  )

  // 2) Remove allPositions block (with its comment)
  const ALL_POS_BLOCK = `  /** Единый отсортированный список ВСЕХ X. Используется везде, где
      раньше был CHESTS.xPositions: initChests, ачивки, прогресс-бар. */
  allPositions: [3000, 5000, 6000, 8000, 12000, 15000, 17000, 23000, 30000, 38000],

`
  replaceOrDie(f, ALL_POS_BLOCK, '', 'CHESTS.allPositions block removal')

  // 3) beam virtuals
  replaceOrDie(
    f,
    "    style: 'spiral',\n    quality: 'full',",
    "    style: 'По умолчанию: spiral — устанавливается в пресетах',\n    quality: 'По умолчанию: full — устанавливается в пресетах',",
    'CHESTS.beam.style/quality'
  )

  // 4) ACHIEVEMENTS: replace CHESTS.allPositions.length BEFORE rename cascade
  //    (после шага 1 осталось "CHESTS_BASE.allPositions.length" — его и меняем)
  if (f.text.includes('CHESTS_BASE.allPositions.length')) {
    f.text = f.text.replace(/CHESTS_BASE\.allPositions\.length/g, '_chestsAllPosLen')
  } else if (f.text.includes('CHESTS.allPositions.length')) {
    f.text = f.text.replace(/CHESTS\.allPositions\.length/g, '_chestsAllPosLen')
  }

  // 5) Add `as const` to CHESTS_BASE and append _chestsAllPosLen after it
  //    Find closing `\n}` followed by `\n\n/* =` (next section = ГЕМЫ)
  const chestsCloseRe = /(export const CHESTS_BASE = \{[\s\S]*?)\n\}\n(\n\/\* =)/
  if (!chestsCloseRe.test(f.text)) {
    console.error('❌ Could not locate CHESTS_BASE closing brace')
    process.exit(1)
  }
  f.text = f.text.replace(
    chestsCloseRe,
    `$1\n} as const\n\n// Длина allPositions — вычисляется в config.ts, здесь только число\n// (используется ACHIEVEMENTS для target).\nconst _chestsAllPosLen =\n  CHESTS_BASE.xPositions.length + Object.keys(CHESTS_BASE.specialChests).length\n$2`
  )

  save('scripts/_config_game.ts', f)
  console.log('✅ _config_game.ts: CHESTS_BASE, virtuals, _chestsAllPosLen, as const')
}

// ============================================================
//  config.ts — full rewrite
// ============================================================
{
  const BARREL = `/* ================================================================
   config.ts — barrel: объединяет три конфига, собирает GAME/RULES,
   вычисляет CHESTS.allPositions и применяет графические пресеты.

   Экспортирует те же символы, что и старый scripts/config.js,
   чтобы импорты \`import * as CFG from '../config.js'\` продолжали
   работать (Vite резолвит config.js → config.ts).

   ПРИНЦИП:
   — В _config_*.ts — только данные + \`as const\`.
   — Всё, что вычисляется (GAME, RULES, CHESTS.allPositions,
     виртуальные поля из пресетов), собирается здесь.
   — applyQualityPreset() НЕ мутирует исходные объекты:
     он создаёт новые и переприсваивает let-биндинги.
     Это даёт возможность держать \`as const\` на _config_*.ts
     и при этом иметь живые (перезаписываемые) экспорты здесь.
   ================================================================ */

import {
  RENDERER as _RENDERER,
  QUALITY_PRESETS,
  GAME_CORE,
} from './_config_core.js'
import {
  LIGHTS as _LIGHTS,
  FOG as _FOG,
  CHUNKS as _CHUNKS,
  LOD as _LOD,
  FAR_TILES as _FAR_TILES,
  OVERLAY as _OVERLAY,
  PROPS as _PROPS,
  SPACE as _SPACE,
} from './_config_world.js'
import {
  CHESTS_BASE,
  PHYSICS,
  CONTROL,
  GAME_START,
  RULES_PARAMS,
} from './_config_game.js'

// ---------- Static re-exports (as const, никогда не мутируются) ----------
export {
  CAMERA, SAVE, GAME_CORE, UI, SOUNDS, GPU_HINT, QUALITY_PRESETS, FPS,
} from './_config_core.js'
export {
  WORLD_SEED, SKY, DAYNIGHT, TERRAIN, TERRAIN_STOPS, GROUND_TEX,
  TERRAIN_COLOR_NOISE, SIGN,
} from './_config_world.js'
export {
  PHYSICS, CONTROL, GAME_START, UPGRADES, RULES_PARAMS,
  GEMS, CARDS, ABILITIES, ACHIEVEMENTS, BOSS, ROCKET,
} from './_config_game.js'

// ---------- Mutable configs ----------
// Исходные значения _config_*.ts содержат виртуальные строки-маркеры
// для полей, которые переопределяются пресетом (например,
// RENDERER.antialias = "По умолчанию: false — устанавливается в пресетах").
//
// applyQualityPreset() переприсваивает эти биндинги новыми объектами
// с реальными значениями. Порядок гарантирует settings.js: он
// импортируется первым в main.js и в top-level вызывает applyToConfig().
//
// Тип \`any\` намеренно скрывает строки-маркеры от потребителей
// (все потребители — .js, TS их всё равно не проверяет, но \`any\`
// страхует будущую миграцию на .ts).
export let RENDERER: any = _RENDERER
export let LIGHTS: any = _LIGHTS
export let FOG: any = _FOG
export let CHUNKS: any = _CHUNKS
export let LOD: any = _LOD
export let FAR_TILES: any = _FAR_TILES
export let OVERLAY: any = _OVERLAY
export let PROPS: any = _PROPS
export let SPACE: any = _SPACE

// ---------- CHESTS = CHESTS_BASE + вычисленный allPositions ----------
const _allPositions = [
  ...CHESTS_BASE.xPositions,
  ...Object.keys(CHESTS_BASE.specialChests).map(Number),
].sort((a, b) => a - b)
export let CHESTS: any = { ...CHESTS_BASE, allPositions: _allPositions }

// ---------- GAME = GAME_CORE + PHYSICS + CONTROL + GAME_START ----------
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

// ---------- RULES — исполняемые функции из RULES_PARAMS ----------
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

// ---------- applyQualityPreset ----------
// Создаёт НОВЫЕ объекты для каждой секции, затронутой пресетом,
// и переприсваивает let-биндинги. Исходные объекты из _config_*.ts
// не мутируются (они \`as const\` — мутация вообще невозможна).
export function applyQualityPreset(presetId: string): void {
  const PRESETS = QUALITY_PRESETS as unknown as Record<string, any>
  const preset = PRESETS[presetId] || PRESETS.medium

  RENDERER = {
    ...RENDERER,
    antialias: preset.renderer.antialias,
    pixelRatioCap: preset.renderer.pixelRatioCap,
    maxChunksPerFrame: preset.renderer.maxChunksPerFrame,
  }

  LIGHTS = {
    ...LIGHTS,
    shadow: { ...LIGHTS.shadow, enabled: preset.lights.shadow.enabled },
  }

  CHUNKS = { ...CHUNKS, segments: preset.chunks.segments }

  FAR_TILES = {
    ...FAR_TILES,
    segments: preset.farTiles.segments,
    segmentsHigh: preset.farTiles.segmentsHigh,
  }

  OVERLAY = {
    ...OVERLAY,
    enabled: preset.overlay.enabled,
    canvasSize: preset.overlay.canvasSize,
  }

  PROPS = {
    ...PROPS,
    density: preset.props.density,
    maxRenderDistance: preset.props.maxRenderDistance,
  }

  SPACE = {
    ...SPACE,
    stars: { ...SPACE.stars, count: preset.space.stars.count },
    spheres: { ...SPACE.spheres, maxCount: preset.space.spheres.maxCount },
  }

  if (preset.lod) {
    LOD = { ...LOD, ...preset.lod }
  }
  if (preset.fog) {
    FOG = { ...FOG, ...preset.fog }
  }
  if (preset.chestBeam) {
    CHESTS = { ...CHESTS, beam: { ...CHESTS.beam, ...preset.chestBeam } }
  }
}
`

  save('scripts/config.ts', { text: BARREL, crlf: false })
  console.log('✅ config.ts: full rewrite (let-exports + applyQualityPreset non-mutating)')
}

console.log('')
console.log('🎉 Готово.')
console.log('')
console.log('Что изменилось:')
console.log('  • _config_*.ts: virtual-поля (перезаписываемые пресетом) — строки-маркеры;')
console.log('    на всех секциях — as const.')
console.log('  • _config_game.ts: CHESTS → CHESTS_BASE (без allPositions);')
console.log('    _chestsAllPosLen — локальный computed для ACHIEVEMENTS.')
console.log('  • config.ts: все mutable-секции теперь let + any;')
console.log('    CHESTS.allPositions считается здесь;')
console.log('    applyQualityPreset() создаёт новые объекты, не мутирует.')
console.log('')
console.log('Проверь: npm run dev + localhost:5173/calculator/')