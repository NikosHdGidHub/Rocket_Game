// patch8.mjs — LOD.changeAltitude / changeBack / FOG.far3D в QUALITY_PRESETS.
// Запуск: node patch8.mjs
import fs from 'node:fs'

const read = (p) => {
  const raw = fs.readFileSync(p, 'utf-8')
  const isCRLF = raw.includes('\r\n')
  return { text: raw.replace(/\r\n/g, '\n'), isCRLF }
}
const write = (p, text, isCRLF) =>
  fs.writeFileSync(p, isCRLF ? text.replace(/\n/g, '\r\n') : text, 'utf-8')

function replaceOrSkip(s, oldStr, newStr, label) {
  if (s.includes(newStr)) {
    console.log(`⏭️  ${label} — уже применено`)
    return s
  }
  if (!s.includes(oldStr)) {
    console.error(`\n❌ Не найден блок: ${label}`)
    console.error('Искали (первые 500):')
    console.error(oldStr.slice(0, 500))
    process.exit(1)
  }
  console.log(`✅ ${label}`)
  return s.replace(oldStr, newStr)
}

// ============================================================
// 1) config.js — QUALITY_PRESETS: добавить lod + fog
// ============================================================
{
  const { text, isCRLF } = read('scripts/config.js')
  let s = text

  const OLD = `export const QUALITY_PRESETS = /** @type {const} */ ({
  low: {
    label: 'Низкое',
    desc: 'Максимум FPS, без теней',
    renderer: { antialias: false, pixelRatioCap: 0.8, maxChunksPerFrame: 1 },
    props: { density: 1000, maxRenderDistance: 1000 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 40 },
    farTiles: { segments: 100, segmentsHigh: 40 },
    overlay: { enabled: false, canvasSize: 512 },
    space: { stars: { count: 800 }, spheres: { maxCount: 1024 } },
    chestBeam: { style: 'cylinder' },
  },
  medium: {
    label: 'Среднее',
    desc: 'Баланс качества и производительности',
    renderer: { antialias: false, pixelRatioCap: 1.5, maxChunksPerFrame: 2 },
    props: { density: 2000, maxRenderDistance: 1500 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 48 },
    farTiles: { segments: 140, segmentsHigh: 48 },
    overlay: { enabled: true, canvasSize: 1024 },
    space: { stars: { count: 1500 }, spheres: { maxCount: 2560 } },
    chestBeam: { style: 'spiral', quality: 'simple' },
  },
  high: {
    label: 'Высокое',
    desc: 'Рекомендуется для мощных устройств',
    renderer: { antialias: true, pixelRatioCap: 1, maxChunksPerFrame: 2 },
    props: { density: 3200, maxRenderDistance: 1900 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 53 },
    farTiles: { segments: 190, segmentsHigh: 53 },
    overlay: { enabled: true, canvasSize: 1024 },
    space: { stars: { count: 2500 }, spheres: { maxCount: 4096 } },
    chestBeam: { style: 'spiral', quality: 'full' },
  },
  ultra: {
    label: 'Ультра',
    desc: 'Максимум качества (сильный GPU)',
    renderer: { antialias: true, pixelRatioCap: 2, maxChunksPerFrame: 3 },
    props: { density: 3800, maxRenderDistance: 2000 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 64 },
    farTiles: { segments: 220, segmentsHigh: 64 },
    overlay: { enabled: true, canvasSize: 1536 },
    space: { stars: { count: 2500 }, spheres: { maxCount: 4096 } },
    chestBeam: { style: 'spiral', quality: 'full' },
  },
})`

  const NEW = `export const QUALITY_PRESETS = /** @type {const} */ ({
  low: {
    label: 'Низкое',
    desc: 'Максимум FPS, без теней',
    renderer: { antialias: false, pixelRatioCap: 0.8, maxChunksPerFrame: 1 },
    props: { density: 1000, maxRenderDistance: 1000 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 40 },
    farTiles: { segments: 100, segmentsHigh: 40 },
    overlay: { enabled: false, canvasSize: 512 },
    space: { stars: { count: 800 }, spheres: { maxCount: 1024 } },
    chestBeam: { style: 'cylinder' },
    // 2D-режим наступает раньше (меньше нагрузка на 3D),
    // туман в 3D ближе (меньше chunk-ов рендерить).
    lod: { changeAltitude: 900, changeBack: 800 },
    fog: { far3D: 1400 },
  },
  medium: {
    label: 'Среднее',
    desc: 'Баланс качества и производительности',
    renderer: { antialias: false, pixelRatioCap: 1.5, maxChunksPerFrame: 2 },
    props: { density: 2000, maxRenderDistance: 1500 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 48 },
    farTiles: { segments: 140, segmentsHigh: 48 },
    overlay: { enabled: true, canvasSize: 1024 },
    space: { stars: { count: 1500 }, spheres: { maxCount: 2560 } },
    chestBeam: { style: 'spiral', quality: 'simple' },
    lod: { changeAltitude: 1050, changeBack: 950 },
    fog: { far3D: 1700 },
  },
  high: {
    label: 'Высокое',
    desc: 'Рекомендуется для мощных устройств',
    renderer: { antialias: true, pixelRatioCap: 1, maxChunksPerFrame: 2 },
    props: { density: 3200, maxRenderDistance: 1900 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 53 },
    farTiles: { segments: 190, segmentsHigh: 53 },
    overlay: { enabled: true, canvasSize: 1024 },
    space: { stars: { count: 2500 }, spheres: { maxCount: 4096 } },
    chestBeam: { style: 'spiral', quality: 'full' },
    // Совпадает с дефолтами в CFG.LOD / CFG.FOG (эталон).
    lod: { changeAltitude: 1100, changeBack: 1000 },
    fog: { far3D: 2000 },
  },
  ultra: {
    label: 'Ультра',
    desc: 'Максимум качества (сильный GPU)',
    renderer: { antialias: true, pixelRatioCap: 2, maxChunksPerFrame: 3 },
    props: { density: 3800, maxRenderDistance: 2000 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 64 },
    farTiles: { segments: 220, segmentsHigh: 64 },
    overlay: { enabled: true, canvasSize: 1536 },
    space: { stars: { count: 2500 }, spheres: { maxCount: 4096 } },
    chestBeam: { style: 'spiral', quality: 'full' },
    // 2D-режим наступает позже (дольше в 3D),
    // туман в 3D дальше (больше обзор).
    lod: { changeAltitude: 1300, changeBack: 1150 },
    fog: { far3D: 2400 },
  },
})`

  s = replaceOrSkip(s, OLD, NEW, 'config.js / QUALITY_PRESETS + lod + fog')
  write('scripts/config.js', s, isCRLF)
}

// ============================================================
// 2) config.js — документируем, что LOD/FOG.far3D переопределяются
// ============================================================
{
  const { text, isCRLF } = read('scripts/config.js')
  let s = text

  // LOD блок
  const OLD1 = `export const LOD = /** @type {const} */ ({
  /** Высота над рельефом (м), при которой включается 2D-режим. */
  changeAltitude: 1100,
  /** Должна быть меньше changeAltitude */
  changeBack: 1000,`

  const NEW1 = `export const LOD = /** @type {const} */ ({
  /**
   * Высота над рельефом (м), при которой включается 2D-режим.
   * ВАЖНО: переопределяется QUALITY_PRESETS[current].lod.changeAltitude
   * при applyToConfig() (см. lib/settings.js) ДО чтения этого поля.
   * Значение ниже — это дефолт (= high-пресет).
   *
   * Инварианты при правке:
   *   changeAltitude < altRef2D (3000)          — диапазон 2D-тумана > 0
   *   changeAltitude < FAR_TILES.altitudeHigh   — 2D включается раньше,
   *                                                чем far-tiles грубеют
   *   changeAltitude ≳ CHUNKS.preloadAltitude/2 — успевают предзагружаться
   */
  changeAltitude: 1100,
  /**
   * Высота (м) деактивации 2D-режима. Гистерезис — должен быть МЕНЬШЕ
   * changeAltitude. Переопределяется из QUALITY_PRESETS.
   */
  changeBack: 1000,`

  s = replaceOrSkip(s, OLD1, NEW1, 'config.js / LOD docs')

  // FOG.far3D
  const OLD2 = `  // 3D-режим (низко над землёй)
  near3D: 100,
  far3D: 2000,`

  const NEW2 = `  // 3D-режим (низко над землёй)
  //
  // ВАЖНО: far3D переопределяется QUALITY_PRESETS[current].fog.far3D
  // при applyToConfig() (см. lib/settings.js) ДО чтения этого поля.
  // Значение ниже — дефолт (= high-пресет).
  //
  // Инварианты при правке:
  //   far3D > farGround (350) — 3D-туман должен быть шире, чем у земли
  //   far3D ≲ farGround2D (2200) — иначе при активации 2D произойдёт
  //                              видимый «dip» дальности тумана
  //   far3D < CAMERA.far (15000) — обрезание не упирается в плоскость
  near3D: 100,
  far3D: 2000,`

  s = replaceOrSkip(s, OLD2, NEW2, 'config.js / FOG.far3D docs')
  write('scripts/config.js', s, isCRLF)
}

// ============================================================
// 3) quality.js — apply() применяет новые поля
// ============================================================
{
  const { text, isCRLF } = read('scripts/lib/quality.js')
  let s = text

  const OLD = `  if (preset.chestBeam) {
    Object.assign(CFG.CHESTS.beam, preset.chestBeam)
  }
}`

  const NEW = `  if (preset.chestBeam) {
    Object.assign(CFG.CHESTS.beam, preset.chestBeam)
  }

  // LOD-переход в 2D: высота активации и гистерезис.
  if (preset.lod) {
    if (typeof preset.lod.changeAltitude === 'number') {
      CFG.LOD.changeAltitude = preset.lod.changeAltitude
    }
    if (typeof preset.lod.changeBack === 'number') {
      CFG.LOD.changeBack = preset.lod.changeBack
    }
  }

  // Туман в 3D-режиме: дальняя плоскость.
  if (preset.fog) {
    if (typeof preset.fog.far3D === 'number') {
      CFG.FOG.far3D = preset.fog.far3D
    }
  }
}`

  s = replaceOrSkip(s, OLD, NEW, 'quality.js / apply lod + fog')
  write('scripts/lib/quality.js', s, isCRLF)
}

// ============================================================
// 4) quality.js — describeDiff() показывает новые отличия
// ============================================================
{
  const { text, isCRLF } = read('scripts/lib/quality.js')
  let s = text

  const OLD = `  if (a.overlay.enabled !== b.overlay.enabled) {
    lines.push(
      \`2D-лес (overlay): \${a.overlay.enabled ? 'вкл' : 'выкл'} → \${b.overlay.enabled ? 'вкл' : 'выкл'}\`
    )
  } else if (a.overlay.enabled && a.overlay.canvasSize !== b.overlay.canvasSize) {
    lines.push(\`Текстура леса (2D): \${a.overlay.canvasSize}px → \${b.overlay.canvasSize}px\`)
  }

  return lines
}`

  const NEW = `  if (a.overlay.enabled !== b.overlay.enabled) {
    lines.push(
      \`2D-лес (overlay): \${a.overlay.enabled ? 'вкл' : 'выкл'} → \${b.overlay.enabled ? 'вкл' : 'выкл'}\`
    )
  } else if (a.overlay.enabled && a.overlay.canvasSize !== b.overlay.canvasSize) {
    lines.push(\`Текстура леса (2D): \${a.overlay.canvasSize}px → \${b.overlay.canvasSize}px\`)
  }

  // LOD: высота перехода в 2D-режим.
  if (a.lod && b.lod && a.lod.changeAltitude !== b.lod.changeAltitude) {
    lines.push(
      \`Высота перехода в 2D: \${a.lod.changeAltitude} м → \${b.lod.changeAltitude} м\`
    )
  }

  // Туман в 3D: дальняя плоскость.
  if (a.fog && b.fog && a.fog.far3D !== b.fog.far3D) {
    lines.push(\`Дальность тумана (3D): \${a.fog.far3D} м → \${b.fog.far3D} м\`)
  }

  return lines
}`

  s = replaceOrSkip(s, OLD, NEW, 'quality.js / describeDiff lod + fog')
  write('scripts/lib/quality.js', s, isCRLF)
}

console.log('\n🎉 Готово.')
console.log('   • QUALITY_PRESETS получили секции lod + fog')
console.log('   • Quality.apply() применяет их к CFG.LOD / CFG.FOG')
console.log('   • describeDiff() показывает что изменится при смене пресета')
console.log('   • Добавлены комментарии с инвариантами в config.js')
