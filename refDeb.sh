#!/usr/bin/env bash
set -e

# ============================================================
# 1. Патчим main.js через Python (строковые замены надёжнее sed)
# ============================================================
python3 - <<'PY' 2>/dev/null || python - <<'PY2'
import pathlib

p = pathlib.Path('scripts/main.js')
s = p.read_text(encoding='utf-8')

# --- 1. Убрать Debug import ---
OLD_IMPORT = "import * as Debug from './lib/debug.js'\n"
if OLD_IMPORT not in s:
    raise SystemExit("❌ Не найден import Debug — проверь main.js вручную")
s = s.replace(OLD_IMPORT, "", 1)

# --- 2. Добавить noop-объект после импорта FpsMonitor ---
ANCHOR = "import * as FpsMonitor from './services/fpsMonitor.js'\n"
if ANCHOR not in s:
    raise SystemExit("❌ Не найден import FpsMonitor — проверь main.js вручную")

NOOP = (
    "import * as FpsMonitor from './services/fpsMonitor.js'\n\n"
    "// DEBUG — noop в prod, real impl подгружается динамически в DEV.\n"
    "// import.meta.env.DEV → false в prod-билде, весь блок ниже\n"
    "// включая await import(...) выпиливается tree-shaker'ом.\n"
    "let Debug = {\n"
    "  init: () => {},\n"
    "  mark: () => {},\n"
    "  frame: () => {},\n"
    "  enabled: () => false,\n"
    "}\n"
)
s = s.replace(ANCHOR, NOOP, 1)

# --- 3. Обернуть Debug.init() + __dbgChunks в DEV-блок ---
OLD_LOAD = (
    "async function initialLoad() {\n"
    "  Debug.init()\n"
    "  window.__dbgChunks = Chunks.getStats\n"
)
NEW_LOAD = (
    "async function initialLoad() {\n"
    "  if (import.meta.env.DEV) {\n"
    "    Debug = await import('./lib/debug.js')\n"
    "    Debug.init()\n"
    "    window.__dbgChunks = Chunks.getStats\n"
    "  }\n"
)
if OLD_LOAD not in s:
    raise SystemExit("❌ Не найден блок Debug.init()/__dbgChunks — проверь main.js вручную")
s = s.replace(OLD_LOAD, NEW_LOAD, 1)

p.write_text(s, encoding='utf-8')
print("✅ main.js обновлён")
PY
import pathlib
p = pathlib.Path('scripts/main.js')
s = p.read_text(encoding='utf-8')

OLD_IMPORT = "import * as Debug from './lib/debug.js'\n"
if OLD_IMPORT not in s:
    raise SystemExit("❌ Не найден import Debug")
s = s.replace(OLD_IMPORT, "", 1)

ANCHOR = "import * as FpsMonitor from './services/fpsMonitor.js'\n"
if ANCHOR not in s:
    raise SystemExit("❌ Не найден import FpsMonitor")
NOOP = (
    "import * as FpsMonitor from './services/fpsMonitor.js'\n\n"
    "// DEBUG — noop в prod, real impl подгружается динамически в DEV.\n"
    "// import.meta.env.DEV → false в prod-билде, весь блок ниже\n"
    "// включая await import(...) выпиливается tree-shaker'ом.\n"
    "let Debug = {\n"
    "  init: () => {},\n"
    "  mark: () => {},\n"
    "  frame: () => {},\n"
    "  enabled: () => false,\n"
    "}\n"
)
s = s.replace(ANCHOR, NOOP, 1)

OLD_LOAD = (
    "async function initialLoad() {\n"
    "  Debug.init()\n"
    "  window.__dbgChunks = Chunks.getStats\n"
)
NEW_LOAD = (
    "async function initialLoad() {\n"
    "  if (import.meta.env.DEV) {\n"
    "    Debug = await import('./lib/debug.js')\n"
    "    Debug.init()\n"
    "    window.__dbgChunks = Chunks.getStats\n"
    "  }\n"
)
if OLD_LOAD not in s:
    raise SystemExit("❌ Не найден блок Debug.init()/__dbgChunks")
s = s.replace(OLD_LOAD, NEW_LOAD, 1)

p.write_text(s, encoding='utf-8')
print("✅ main.js обновлён")
PY2

# ============================================================
# 2. Пометить lib/debug.js как dev-only (для будущего себя)
# ============================================================
python3 - <<'PY' 2>/dev/null || python - <<'PY2'
import pathlib
p = pathlib.Path('scripts/lib/debug.js')
s = p.read_text(encoding='utf-8')
OLD = "/* ================================================================\n   debug.js — overlay с FPS-метриками + фасад над window.dbg*.\n   Включается через ?debug в URL или window.__dbgOn = true.\n================================================================ */"
NEW = "/* ================================================================\n   debug.js — DEV-ONLY. В production build не попадает.\n   Загружается динамически из main.js только при import.meta.env.DEV.\n\n   Overlay с FPS-метриками (?debug в URL) + фасад над window.dbg*.\n================================================================ */"
if OLD in s:
    s = s.replace(OLD, NEW, 1)
    p.write_text(s, encoding='utf-8')
    print("✅ debug.js header обновлён")
else:
    print("⚠️ header уже другой — пропускаю (не критично)")
PY
import pathlib
p = pathlib.Path('scripts/lib/debug.js')
s = p.read_text(encoding='utf-8')
OLD = "/* ================================================================\n   debug.js — overlay с FPS-метриками + фасад над window.dbg*.\n   Включается через ?debug в URL или window.__dbgOn = true.\n================================================================ */"
NEW = "/* ================================================================\n   debug.js — DEV-ONLY. В production build не попадает.\n   Загружается динамически из main.js только при import.meta.env.DEV.\n\n   Overlay с FPS-метриками (?debug в URL) + фасад над window.dbg*.\n================================================================ */"
if OLD in s:
    s = s.replace(OLD, NEW, 1)
    p.write_text(s, encoding='utf-8')
    print("✅ debug.js header обновлён")
else:
    print("⚠️ header уже другой — пропускаю")
PY2

# ============================================================
# 3. Быстрая проверка — что получилось в main.js
# ============================================================
echo ""
echo "=== main.js: фрагмент вокруг Debug ==="
grep -n "Debug\|import.meta.env.DEV" scripts/main.js | head -20