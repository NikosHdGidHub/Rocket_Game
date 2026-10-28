/* ================================================================
   config.ts — barrel: объединяет три конфига, собирает GAME/RULES,
   вычисляет CHESTS.allPositions и применяет графические пресеты.

   Экспортирует те же символы, что и старый scripts/config.js,
   чтобы импорты `import * as CFG from '../config.js'` продолжали
   работать (Vite резолвит config.js → config.ts).

   ПРИНЦИП:
   — В _config_*.ts — только данные + `as const`.
   — Всё, что вычисляется (GAME, RULES, CHESTS.allPositions,
     виртуальные поля из пресетов), собирается здесь.
   — applyQualityPreset() НЕ мутирует исходные объекты:
     он создаёт новые и переприсваивает let-биндинги.
     Это даёт возможность держать `as const` на _config_*.ts
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
// Тип `any` намеренно скрывает строки-маркеры от потребителей
// (все потребители — .js, TS их всё равно не проверяет, но `any`
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
// не мутируются (они `as const` — мутация вообще невозможна).
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
