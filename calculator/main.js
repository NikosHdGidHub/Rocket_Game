/* ================================================================
   main.js — точка входа калькулятора. Инициализация форм и
   подписка на кнопки/табы.
================================================================ */
import { simulateAdaptive, findOptimumAsync } from './simulation.js'
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

/* ---------- Найти оптимум ---------- */
document.getElementById('opt-btn').addEventListener('click', async () => {
  const btn = document.getElementById('opt-btn')
  const origText = btn.textContent
  btn.textContent = '⏳ 0/91…'
  btn.disabled = true
  await new Promise((r) => setTimeout(r, 20))

  try {
    const { upgrades, cards, opts } = UI.readState('')
    const optData = await findOptimumAsync(upgrades, cards, opts, (done) => {
      btn.textContent = `⏳ ${done}/91…`
    })
    UI.renderOptimum(optData)
  } finally {
    btn.textContent = origText
    btn.disabled = false
  }
})

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