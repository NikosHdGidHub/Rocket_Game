/* ================================================================
   config.ts — баррель: объединяет три конфига и собирает GAME/RULES.

   Экспортирует те же символы, что и старый scripts/config.js,
   чтобы импорты `import * as CFG from '../config.js'` продолжали
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
