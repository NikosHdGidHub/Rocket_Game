// patch3.mjs — добавляет dbgMaxUpgrades (все апгрейды на MAX)
// Запуск: node patch3.mjs
import fs from 'node:fs'

const R = (p) => p
const read = (p) => {
  const raw = fs.readFileSync(R(p), 'utf-8')
  const isCRLF = raw.includes('\r\n')
  return { text: raw.replace(/\r\n/g, '\n'), isCRLF }
}
const write = (p, text, isCRLF) => {
  fs.writeFileSync(R(p), isCRLF ? text.replace(/\n/g, '\r\n') : text, 'utf-8')
}

function replaceOrSkip(s, oldStr, newStr, label) {
  if (s.includes(newStr)) {
    console.log(`⏭️  ${label} — уже применено`)
    return s
  }
  if (!s.includes(oldStr)) {
    console.error(`\n❌ Не найден блок: ${label}`)
    console.error('Искали (первые 200 символов):')
    console.error(oldStr.slice(0, 200))
    process.exit(1)
  }
  console.log(`✅ ${label}`)
  return s.replace(oldStr, newStr)
}

// ============================================================
// 1) game.js — добавляем giveMaxUpgrades
// ============================================================
{
  const { text, isCRLF } = read('scripts/core/game.js')
  let s = text

  const OLD = `  saveProgress()
  Achievements.onBuy()
}

/* ================================================================
   Старт / посадка
================================================================ */`

  const NEW = `  saveProgress()
  Achievements.onBuy()
}

/** DEBUG: выставляет ВСЕ апгрейды на максимальный уровень. */
export function giveMaxUpgrades() {
  for (const u of CFG.UPGRADES) {
    G.upgrades[u.key] = u.maxLevel ?? 12
  }
  UI.updateHUD()
  UI.renderShop()
  saveProgress()
  Achievements.onBuy()
  UI.showToast('⚡ Все апгрейды MAX', CFG.UI.toastColors.upgrade)
  console.log('[dbg] Все апгрейды на MAX:', { ...G.upgrades })
  return true
}

/* ================================================================
   Старт / посадка
================================================================ */`

  s = replaceOrSkip(s, OLD, NEW, 'game.js / giveMaxUpgrades')
  write('scripts/core/game.js', s, isCRLF)
}

// ============================================================
// 2) debug.js — регистрируем window.dbgMaxUpgrades
// ============================================================
{
  const { text, isCRLF } = read('scripts/lib/debug.js')
  let s = text

  const OLD = `  window.dbgGiveGems = (n = 10) => {
    G.gems += n
    Game.saveProgress()
    CardsModal.refresh()
    console.log(\`+\${n} 💎 → всего \${G.gems}\`)
  }`

  const NEW = `  window.dbgGiveGems = (n = 10) => {
    G.gems += n
    Game.saveProgress()
    CardsModal.refresh()
    console.log(\`+\${n} 💎 → всего \${G.gems}\`)
  }
  window.dbgMaxUpgrades = () => Game.giveMaxUpgrades()`

  s = replaceOrSkip(s, OLD, NEW, 'debug.js / dbgMaxUpgrades')
  write('scripts/lib/debug.js', s, isCRLF)
}

console.log('\n🎉 Готово. Открой консоль в игре и введи:')
console.log('   dbgMaxUpgrades()')