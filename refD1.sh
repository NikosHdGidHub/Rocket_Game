#!/usr/bin/env bash
set -e

# ============================================================
# 1. Перенос
# ============================================================
mv scripts/abilities.js   scripts/services/abilities.js
mv scripts/achievements.js scripts/services/achievements.js

# ============================================================
# 2. Правка внутренних импортов (в самих переехавших файлах)
# ============================================================
sed -i "s|from './config.js'|from '../config.js'|g; s|from './state.js'|from '../state.js'|g" \
  scripts/services/abilities.js scripts/services/achievements.js

# ============================================================
# 3. Потребители abilities.js
# ============================================================
# core/* лежит на уровень глубже — ../abilities.js → ../services/abilities.js
sed -i "s|from '../abilities.js'|from '../services/abilities.js'|g" \
  scripts/core/game.js scripts/core/physics.js scripts/core/ghostRecorder.js
# ui/hud.js — та же глубина
sed -i "s|from '../abilities.js'|from '../services/abilities.js'|g" scripts/ui/hud.js
# main.js лежит в корне scripts/
sed -i "s|from './abilities.js'|from './services/abilities.js'|g" scripts/main.js

# ============================================================
# 4. Потребители achievements.js
# ============================================================
sed -i "s|from '../achievements.js'|from '../services/achievements.js'|g" scripts/core/game.js
# save.js — теперь оба в services/, ../ становится ./
sed -i "s|from '../achievements.js'|from './achievements.js'|g" scripts/services/save.js
# achievementsModal.js — ../ → ../services/
sed -i "s|from '../achievements.js'|from '../services/achievements.js'|g" scripts/ui/achievementsModal.js
# main.js
sed -i "s|from './achievements.js'|from './services/achievements.js'|g" scripts/main.js

# ============================================================
# 5. Проверка
# ============================================================
echo ""
echo "=== services/ ==="
ls -la scripts/services/

echo ""
echo "=== В scripts/ осталось только 5 файлов? ==="
ls scripts/*.js

echo ""
echo "=== Старые пути в коде (abilities.js / achievements.js)? ==="
if grep -rn "from '\.\./abilities\.js'\|from '\./abilities\.js'" scripts/ 2>/dev/null; then
  echo "❌ остались старые пути к abilities.js"
else
  echo "✅ abilities.js — все пути обновлены"
fi
if grep -rn "from '\.\./achievements\.js'\|from '\./achievements\.js'" scripts/ 2>/dev/null; then
  echo "❌ остались старые пути к achievements.js"
else
  echo "✅ achievements.js — все пути обновлены"
fi

echo ""
echo "=== targets существуют? ==="
for f in scripts/services/abilities.js scripts/services/achievements.js; do
  [ -f "$f" ] && echo "✅ $f" || echo "❌ $f ОТСУТСТВУЕТ"
done