/* ================================================================
   main.js — точка входа калькулятора.
================================================================ */
import {
  simulateAdaptive,
  findOptimumAsync,
  findOptimumExactAsync,
} from './simulation.js'
import * as UI from './ui.js'

/* ---------- Табы ---------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'))
    tab.classList.add('active')
    document.getElementById(tab.dataset.tab).classList.add('active')
  })
})

/* ---------- Формы ---------- */
UI.buildUpgradeInputs('upgrades-inputs')
UI.buildCardInputs('cards-inputs')
UI.buildOptsInputs('opts-inputs')
UI.buildCompareColumn('upA', 'A-')
UI.buildCompareColumn('upB', 'B-')

/* ---------- Симулировать ---------- */
document.getElementById('sim-btn').addEventListener('click', () => {
  const { upgrades, cards, opts } = UI.readState('')
  const result = simulateAdaptive(upgrades, cards, opts)
  UI.renderSingleResult(result, upgrades, cards, opts)
})

/* ---------- Оптимизация (общий обработчик для обеих кнопок) ---------- */
async function runOptimization(fn, activeBtnId, otherBtnId) {
  const btn = document.getElementById(activeBtnId)
  const btnOther = document.getElementById(otherBtnId)
  const origText = btn.textContent

  btn.textContent = '⏳ 0…'
  btn.disabled = true
  btnOther.disabled = true
  await new Promise((r) => setTimeout(r, 20))

  try {
    const { upgrades, cards, opts } = UI.readState('')
    const t0 = performance.now()
    const optData = await fn(upgrades, cards, opts, (done, total, msg) => {
      const sec = Math.round((performance.now() - t0) / 1000)
      btn.textContent = `⏳ ${done}/${total} · ${sec}с`
      if (msg) btn.title = msg
    })
    UI.renderOptimum(optData)
  } finally {
    btn.textContent = origText
    btn.disabled = false
    btnOther.disabled = false
    btn.title = ''
  }
}

document.getElementById('opt-btn').addEventListener('click', () =>
  runOptimization(findOptimumAsync, 'opt-btn', 'opt-exact-btn')
)

document.getElementById('opt-exact-btn').addEventListener('click', () =>
  runOptimization(findOptimumExactAsync, 'opt-exact-btn', 'opt-btn')
)

/* ---------- Сравнить ---------- */
document.getElementById('cmp-btn').addEventListener('click', () => {
  const stateA = UI.readState('A-')
  const stateB = UI.readState('B-')
  const resA = simulateAdaptive(stateA.upgrades, stateA.cards, stateA.opts)
  const resB = simulateAdaptive(stateB.upgrades, stateB.cards, stateB.opts)
  UI.renderCompare(resA, resB)
})

/* ---------- Текущий билд ---------- */
document.getElementById('load-save-btn').addEventListener('click', () => {
  UI.loadSave('')
})

document.querySelectorAll('[data-load]').forEach((btn) => {
  btn.addEventListener('click', () => {
    UI.loadSave(btn.dataset.load)
  })
})