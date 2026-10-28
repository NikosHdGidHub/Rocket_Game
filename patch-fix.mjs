// patch-fix.mjs — чиним TS-ошибку 2352 в scripts/config.ts.
// Run: node patch-fix.mjs   (из корня проекта)
import fs from 'node:fs'

const PATH = 'scripts/config.ts'
if (!fs.existsSync(PATH)) {
  console.error('❌ scripts/config.ts not found (run from project root)')
  process.exit(1)
}

const OLD = `  const preset =
    (QUALITY_PRESETS as Record<string, typeof QUALITY_PRESETS.medium>)[presetId] ||
    QUALITY_PRESETS.medium`

const NEW = `  // Приводим через unknown: union-тип QUALITY_PRESETS слишком узкий
  // (у low.chestBeam нет quality, у medium — есть). Для редактора это ок.
  const PRESETS = QUALITY_PRESETS as unknown as Record<string, any>
  const preset = PRESETS[presetId] || PRESETS.medium`

let s = fs.readFileSync(PATH, 'utf-8')

if (s.includes('as unknown as Record<string, any>')) {
  console.log('⏭️  Already fixed')
  process.exit(0)
}

if (!s.includes(OLD)) {
  console.error('❌ Target block not found in scripts/config.ts')
  console.error('Искали:')
  console.error(OLD)
  process.exit(1)
}

s = s.replace(OLD, NEW)
fs.writeFileSync(PATH, s, 'utf-8')
console.log('✅ scripts/config.ts: applyQualityPreset() cast fixed')
