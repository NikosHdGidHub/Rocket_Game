/* ================================================================
   _config_game.ts — игровые параметры, баланс, карточки, способности.
   Секции: GAME_GAME, BOSS, ROCKET, UPGRADES, RULES_PARAMS, CHESTS,
   GEMS, CARDS, ABILITIES, ACHIEVEMENTS.

   ФАЙЛ СОДЕРЖИТ ТОЛЬКО ДАННЫЕ — исполняемые RULES собираются в config.ts.
   ================================================================ */

/* ================================================================
   GAME_GAME — игровой баланс и параметры полёта.
   Объединяется в GAME в config.ts вместе с GAME_CORE.
================================================================ */
export const GAME_GAME = {
  /** Гравитация (м/с²). 9.8 — как в реальности. */
  gravity: 9.8,

  /** Высота ракеты над землёй в состоянии покоя (м). */
  restY: 0.95,

  /** Пауза (с) между «камера вернулась к стартовой позиции» */
  prekickDelay: 0.3,

  /** Порог «камера вернулась» (м). */
  prekickCamTolerance: 2.0,

  /** Начальный угол старта (радианы). 20° — оптимально для дальности. */
  launchAngle: (20 * Math.PI) / 180,

  /** Снос траектории в плоскости XZ (радианы). */
  flightYaw: Math.atan(1 / 100),

  /** Аэродинамическая стабилизация (рад/с). */
  aeroAlign: 0.2,

  /** Минимальная скорость (м/с), ниже которой стабилизация отключается. */
  aeroAlignMinSpeed: 5.0,

  /** Угловое ускорение от клавиши W/S (рад/с²). */
  angAcc: 5.0,

  /** Вязкое затухание угловой скорости (1/с). */
  angDamp: 0.8,

  /** Потолок угловой скорости (рад/с). */
  angMax: 18.0,

  /** Плотность воздуха по высоте (экспоненциальное падение). */
  airHeight: 6000,

  /** Высота отключения двигателей. */
  airEngineHeight: 10000,

  /** Общая сложность игры (0.75 - 2.0). */
  upgrade_cost_diff: 1.4,

  /** Сколько монет у игрока на старте. */
  initialCoins: 5,

  /** Рекорд дистанции на старте (м). */
  initialBest: 0,

  /** Начальные уровни апгрейдов. Каждый начинается с 1. */
  initialUpgrades: { power: 1, aero: 1, fuel: 1, thrust: 1 },
}

/* ================================================================
   БОСС — модель из коробок, стоит в стартовой зоне
================================================================ */

export const BOSS = {
  position: [-2.6, 0, 0],
  colors: {
    skin: 0xd94f6b, // розово-красная кожа
    dark: 0x2b2233, // тёмно-фиолетовый (штаны, глаза, брови)
    accent: 0xffd75e, // жёлтый (обувь, акцент на груди)
  },
  hideDistance: 500,
}

/* ================================================================
   РАКЕТА — модель, пламя, свет от двигателя
================================================================ */

export const ROCKET = {
  /** Цвета корпуса, носа, иллюминатора. */
  colors: {
    body: 0xf2f4f8, // почти белый корпус
    red: 0xe63946, // красный нос и плавники
    glass: 0x2b3a55, // тёмно-синий иллюминатор
  },
  /**
   * Углы отклонения носа от курса.
   * Управляют цветом пламени, интенсивностью огня и цветом подсказки в HUD.
   *
   * Между соседними "стопами" значения ЛИНЕЙНО интерполируются по углу,
   * а затем сглаживаются во времени (см. ROCKET.anglesSmooth) — поэтому
   * цвет плавно "перетекает", а не скачет по порогам.
   *
   * Поля стопа:
   *   angle          — верхняя граница диапазона, °
   *   flameColor     — цвет пламени во время буста (hex)
   *   flameIntensity — множитель амплитуды огня (1.0 = номинал)
   *   textColor      — цвет текста угла в HUD (hex)
   *   aligned        — (опц.) true → HUD показывает "🎯 0°" вместо реального угла
   */
  anglesCourse: {
    forward: {
      angle: 5,
      aligned: true,
      flameColor: 0x9fe8ff, // #9fe8ff
      flameIntensity: 1.25, // огонь крупнее
      textColor: 0x83ffa4, // #83ffa4
    },
    almostForward: {
      angle: 10,
      flameColor: 0xffeec5, // #ffeec5
      flameIntensity: 1.15,
      textColor: 0xc3f28e, // #c3f28e
    },
    adjustment: {
      angle: 22,
      flameColor: 0xffb710, // #ffb710
      flameIntensity: 1.05,
      textColor: 0xf6e420, // #f6e420
    },
    change: {
      angle: 35,
      flameColor: 0xffa510, // #ffa510
      flameIntensity: 1.0,
      textColor: 0xffc938, // #ffc938
    },
    deviation: {
      angle: 50,
      flameColor: 0xff8600, // #ff8600
      flameIntensity: 0.9,
      textColor: 0xffa938, // #ffa938
    },
    side: {
      angle: 90,
      flameColor: 0xff7000, // #ff7000
      flameIntensity: 0.8,
      textColor: 0xff6969, // #ff6969
    },
    back: {
      angle: 180,
      flameColor: 0xff4600, // #ff4600
      flameIntensity: 0.4, // огонь сильно меньше
      textColor: 0xe5d15d, // #e5d15d
    },
  },

  /** Цвета пламени. */
  flame: {
    outer: 0xffb703, // #ffb703 оранжевое внешнее (обычный буст)
    inner: 0xfff6d0, // #fff6d0 светлое ядро
    aligned: 0x9fe8ff, // #9fe8ff  голубое, когда нос соосно скорости +-
    misaligned: 0xff9603, // #ff9603  оранжевое, когда «боком» — буст неэффективен отклонение около 30°
    backMove: 0xff4603, // #ff4603  красное, когда задом — буст неэффективен отклонение более 90°
    forsage: 0x9b59b6, //фиолетовое пламя при форсаже
  },

  /** коэффициент размера форсажа */
  forsageScale: 1.15,

  /** Цвет точечного света от сопла. */
  exhaustLight: 0xffc04a, // #ffc04a

  /** Цвет света при активном форсаже — фиолетовый в тон пламени. */
  exhaustLightForsage: 0x9b59b6, // #9b59b6

  /* ---------- Источник света от сопла ----------
     Тот же приём: decay: 1 + явный range. Свет привязан к ракете,
     летит с ней; освещает землю под соплом и ближайшие деревья. */
  exhaustLightRange: 80,
  exhaustLightRangeForsage: 250,
  exhaustLightDecay: 1,
  exhaustLightIntensityBoost: 60, // при включённом бусте / форсаже
  exhaustLightIntensityForsage: 490, // форсаж — заметно ярче
  exhaustLightIntensityIdle: 15, // «тлеющий» — двигатель не работает

  // ─── ПРИЗРАК РАКЕТЫ ───

  /** Лимит записи призрака (секунды полётного времени). */
  recordingTimeLimit: 5 * 60,

  /** Целевая частота записи (кадров в секунду). 30 — с запасом для плавности. */
  recordingFPS: 30,

  /** минимальная длительность записи 30 * x * 6*/
  minSamplesLimit: 3 * 6 * 30,

  /** Настройки визуала призрака. */
  ghost: {
    /** Цвет корпуса. */
    color: 0x9fe8ff,
    /** Цвет пламени (внешнего). */
    flameColor: 0x9fe8ff,
    /** Цвет ядра пламени. */
    flameInnerColor: 0xffffff,
    /** Прозрачность корпуса (0..1). */
    opacity: 0.35,
    /** Прозрачность внешнего пламени. */
    flameOpacity: 0.7,
    /** Прозрачность ядра пламени. */
    flameInnerOpacity: 0.85,
    /** Ключ localStorage. */
    storageKey: 'rocket_game_ghost_v1',
  },
}

/* ================================================================
   АПГРЕЙДЫ — четыре ветки прокачки
   Каждый апгрейд: ключ, иконка, имя, описание, базовая цена, рост.
   Формула цены: base * growth^(level-1)  (см. RULES.upgradeCost).
================================================================ */
export const UPGRADES = [
  {
    key: 'power',
    icon: '🦵',
    name: 'Сила пинка',
    desc: 'Дальше и выше',
    base: 40,
    growth: 1.6,
    maxLevel: 12,
  },
  {
    key: 'aero',
    icon: '✈',
    name: 'Аэродинамика',
    desc: 'Меньше торможения',
    base: 45,
    growth: 1.55,
    maxLevel: 10,
  },
  {
    key: 'fuel',
    icon: '⛽',
    name: 'Бак топлива',
    desc: 'Дольше ускорение',
    base: 35,
    growth: 1.45,
    maxLevel: 13,
  },
  {
    key: 'thrust',
    icon: '🔥',
    name: 'Тяга двигателя',
    desc: 'Сильнее ускорение',
    base: 50,
    growth: 1.67,
    maxLevel: 12,
  },
]

/* ================================================================
   СУНДУКИ — статичные точки на земле, дают редкие карточки.
   ================================================================ */

/* ---------- Объединённый список ----------
   Дублирующиеся X раньше ломали: если X есть и в xPositions, и в
   specialChests — сундук создавался дважды (второй перекрывал первый).
   Теперь xPositions — только «обычные», specialChests — только спец.
   allPositions = объединение, вычисляется один раз при загрузке. */
const _chestX = [3000, 5000, 8000, 12000, 17000, 23000, 30000, 38000]
const _specialChests = {
  6000: 'forsage',
  15000: 'forsage',
}

export const CHESTS = {
  enabled: true,

  xPositions: _chestX,
  specialChests: _specialChests,

  /** Единый отсортированный список ВСЕХ X. Используется везде, где
      раньше был CHESTS.xPositions: initChests, ачивки, прогресс-бар. */
  allPositions: [..._chestX, ...Object.keys(_specialChests).map(Number)].sort((a, b) => a - b),

  /** Z-координата сундука — детерминированная. */
  zOffset: 30,

  /** Радиус сбора (м, по XZ). */
  pickupRadius: 100,

  /** м — сколько ещё показываем пройденный сундук. */
  overRadius: 500,

  /** Высота столба света (м). Общая для цилиндра и спирали. */
  beamHeight: 450,

  /** Радиус цилиндра (низ) — старый стиль (LOW). */
  beamRadius: 2.0,

  /** Цвет цилиндра. */
  beamColor: 0xffd75e, // #ffd75e

  /** Базовая непрозрачность луча (общая для обоих стилей). */
  beamOpacity: 0.4,

  /** Цвет для PointLight и glow-точки по умолчанию (fallback). */
  glowColor: 0xffb300, // #ffb300

  /**
   * Glow-точка над сундуком — THREE.Points, видна издалека.
   * Та же техника, что у гемов: шейдер с falloff + fog.
   * Цвета: CFG.CHESTS.glowColor (оранжевый) и types.forsage.glowColor (фиолетовый).
   */
  glow: {
    /**Размер точки в мире. Плавно растёт при приближении */
    size: 100,
    /**Базовая яркость */
    opacity: 1,
    /** >1 — компактное яркое ядро; <1 — размытый ореол */
    falloff: 2.3,
    /** Высота точки над сундуком (м)  */
    yOffset: 4.5,
    pulseSpeed: 2.5,
    pulseAmount: 0.2,
  },

  /**
   * Пул лучей: N ближайших сундуков светятся, остальные невидимы.
   * Гаснут по расстоянию (opacity *= fade) и в тумане (applySkyFog).
   * Стиль переопределяется пресетом качества (low — cylinder, rest — spiral).
   */
  beam: {
    poolSize: 4,
    maxDistance: 3000,
    fadeStart: 700,
    fadeEnd: 2200,
    style: 'spiral',
    quality: 'full',

    cylinder: {
      radialSegments: 12,
      radiusTopRatio: 1.8,
    },

    spiral: {
      radialSegments: 32,
      heightSegments: 48,
      radiusTop: 1.7,
      radiusBottom: 6,
      /**Количество спиральных «рукавов» */
      arms: 2.0,
      /**Насколько сильно закручивается по высоте (рад на всю высоту) */
      twist: 78.0,
      /**	Резкость рукавов. 1 — мягко/широко, 3+ — тонкие жилы */
      sharpness: 2,
      /** Сколько «огоньков»-шума на рукавах (только high/ultra) */
      noiseAmount: 1.35,
      /**Частота этих огоньков */
      noiseScale: 6.0,
      colorInner: 0xffc8c8, // #ffc8c8
      colorOuter: 0xffb300, // #ffb300
      animate: true,
      /**Скорость вращения (только high/ultra) */
      rotationSpeed: 2.2,
      pulseSpeed: 1.5,
      /**Пульсация яркости */
      pulseAmount: 0.2,

      simple: {
        radialSegments: 16,
        heightSegments: 20,
        noiseAmount: 0.0,
        animate: false,
      },

      forsage: {
        colorInner: 0xe0c0ff, // #e0c0ff
        colorOuter: 0x9100ff, // #9100ff
      },
    },
  },

  /* ---------- Пул источников света ----------*/
  lights: {
    count: 4, // сколько сундуков одновременно освещены
    intensity: 80, // яркость вблизи источника
    range: 120, // радиус действия (м)
    decay: 1, // 1 = линейное затухание 1/d
    height: 4.0, // высота света над землёй (м)
    fadeSpeed: 4, // 1/с — скорость плавного вкл/выкл
  },

  /**
   * Визуальные override-ы по типу. Всё, чего нет в types[type],
   * берётся из корневых полей (beamColor, glowColor, beamOpacity, ...).
   * Настройки применяются и к beam/glow-материалам, и к пулу PointLight.
   */
  types: {
    forsage: {
      beamColor: 0xb071f3, // #b071f3
      glowColor: 0xb9100ff, // #9100ff

      beamOpacity: 0.65, // плотнее обычного (root: 0.4)

      lightIntensity: 420, // ярче обычного (root: 30)
      lightRange: 280, // дальше обычного (root: 80)
      lightHeight: 5.0, // выше обычного (root: 4.0)
    },
  },

  /** На каком расстоянии (м) сундук «подсвечивается» ярче. */
  nearRadius: 500,

  /** Лимит одного семейства (family). Один и тот же вариант можно получить дважды. */
  cardTypeLimit: 2,
}

/* ================================================================
   ГЕМЫ — валюта карточек. Левитируют над землёй, собираются в полёте.
================================================================ */
export const GEMS = {
  enabled: true,

  xPositions: [2000, 4500, 7000, 10000, 14000, 19000, 26000, 34000, 42000],
  xPosDif: 30,

  /** Базовая высота над рельефом (м). */
  yOffset: 40,
  yPosDif: 15,

  /** Разброс по Z (м, ±). Та же механика, что у сундуков. */
  zOffset: 30,

  /** Радиус сбора — сфера по (x, y, z), не только XZ. */
  takeRange: 40,

  /** Радиус октаэдра (м). */
  size: 1.8,

  /** Glow — «звезда» на Points, не сфера. */
  glow: {
    size: 80, // размер точки в мире (масштабируется с расстоянием)
    opacity: 1,
    color: 0x7ed4ff,
    falloff: 1.5, // >1 = компактный яркий центр, <1 = размытый
  },

  /** Реальный свет — пул PointLight'ов на ближайших гемах. */
  lights: {
    count: 3,
    color: 0x4daeff,
    intensity: 150,
    range: 180, // радиус затухания света (м)
    fadeSpeed: 4, // 1/с — скорость плавного вкл/выкл
  },

  colors: {
    core: 0x7ed4ff, // базовый цвет кристалла
    emissive: 0x4daeff, // свечение изнутри
    glow: 0x3d8bff, // ореол вокруг
  },

  /** Анимация. */
  bobSpeed: 1.4, // скорость парения по Y
  bobHeight: 2.0, // амплитуда парения (м, доп. к позиции)
  rotateSpeed: 0.9, // скорость вращения вокруг Y
  pulseSpeed: 2.5, // скорость пульсации ореола
}

/**
 * Редкие карточки.
 *
 * Структура:
 *   id         — уникальный ключ (используется в сейве!)
 *   family     — семейство (лимит на семейство)
 *   variant    — название варианта (уточнение)
 *   desc_buff  — текст баффа для UI
 *   desc_debuff — текст дебаффа для UI
 *   effects    — массив { stat, mult, isBuff } — механические множители
 *   flags      — нецифровые эффекты (['engineAlwaysOn'])
 *   condition  — условие появления ('forsage' — только если открыт форсаж)
 *   special    — true → не выпадает в рандоме (только из фиолетовых сундуков)
 *   color      — hex для рамки карточки
 */
export const CARDS = [
  // ── FUEL ──
  {
    id: 'fuel_heavy',
    family: 'fuel',
    icon: '⛽',
    name: 'Двойной бак',
    variant: 'Тяжёлые баки',
    desc_buff: 'Топливо ×2',
    desc_debuff: 'Тяга ×0.8',
    effects: [
      { stat: 'maxFuel', mult: 2.0, isBuff: true },
      { stat: 'thrustAcc', mult: 0.8, isBuff: false },
    ],
    color: 0xff631a, // #ff631a
    buyPrice: 2,
    sellPrice: 1,
  },
  {
    id: 'fuel_oversized',
    family: 'fuel_2',
    icon: '⛽',
    name: 'Двойной бак',
    variant: 'Негабаритные баки',
    desc_buff: 'Топливо ×2',
    desc_debuff: 'Сопротивление воздуха ×1.6',
    effects: [
      { stat: 'maxFuel', mult: 2.0, isBuff: true },
      { stat: 'drag', mult: 1.6, isBuff: false },
    ],
    color: 0xff631a, // #ff631a
    buyPrice: 2,
    sellPrice: 1,
  },
  {
    id: 'fuel_solid',
    family: 'fuel_solid',
    icon: '⛽',
    name: 'Двойной бак',
    variant: 'Твёрдое топливо',
    desc_buff: 'Топливо ×2',
    desc_debuff: 'Двигатель всегда включён',
    effects: [{ stat: 'maxFuel', mult: 2.0, isBuff: true }],
    flags: ['engineAlwaysOn'],
    once: true,
    color: 0xff631a, // #ff631a
    buyPrice: 2,
    sellPrice: 1,
  },

  // ── ENGINE ──
  {
    id: 'engine_light',
    family: 'engine',
    icon: '🔥',
    name: 'Улучшенный двигатель',
    variant: 'Лёгкая конструкция',
    desc_buff: 'Тяга ×1.7',
    desc_debuff: 'Топливо ×0.8',
    effects: [
      { stat: 'thrustAcc', mult: 1.7, isBuff: true },
      { stat: 'maxFuel', mult: 0.8, isBuff: false },
    ],
    color: 0xf2e533,
    buyPrice: 2,
    sellPrice: 1,
  },
  {
    id: 'engine_updated',
    family: 'engine',
    icon: '🔥',
    name: 'Улучшенный двигатель',
    variant: 'Обновлённые двигатели',
    desc_buff: 'Тяга ×1.4',
    effects: [{ stat: 'thrustAcc', mult: 1.4, isBuff: true }],
    color: 0xf2e533,
    buyPrice: 2,
    sellPrice: 1,
  },
  {
    id: 'engine_external',
    family: 'engine_external',
    icon: '🔥',
    name: 'Новый двигатель',
    variant: 'Внешние двигатели',
    desc_buff: 'Тяга ×2',
    desc_debuff: 'Сопротивление воздуха ×1.6',
    effects: [
      { stat: 'thrustAcc', mult: 2.0, isBuff: true },
      { stat: 'drag', mult: 1.6, isBuff: false },
    ],
    color: 0xf2e533,
    buyPrice: 2,
    sellPrice: 1,
  },
  {
    id: 'engine_forsage',
    family: 'engine_forsage',
    icon: '🔥',
    name: 'Новый двигатель',
    variant: 'Форсажный двигатель',
    desc_buff: 'Тяга в форсаже ×2',
    desc_debuff: 'Тяга в полёте ×0.9',
    effects: [
      { stat: 'forsageThrust', mult: 2.0, isBuff: true },
      { stat: 'thrustAcc', mult: 0.9, isBuff: false },
    ],
    once: true,
    condition: 'forsage',
    color: 0xcf33f2,
    buyPrice: 2,
    sellPrice: 1,
  },

  // ── POWER ──
  {
    id: 'power_punch',
    family: 'power',
    icon: '🦵',
    name: 'Могучий пинок',
    desc_buff: 'Сила пинка ×4',
    effects: [{ stat: 'launchSpeed', mult: 4.0, isBuff: true }],
    color: 0x6df58d,
    buyPrice: 2,
    sellPrice: 1,
  },

  // ── STREAMLINING ──
  {
    id: 'stream_smooth',
    family: 'streamlining',
    icon: '✈',
    name: 'Обтекаемость',
    variant: 'Гладкий фюзеляж',
    desc_buff: 'Сопротивление ×0.7',
    effects: [{ stat: 'drag', mult: 0.7, isBuff: true }],
    color: 0xb3ecea,
    buyPrice: 2,
    sellPrice: 1,
  },
  {
    id: 'stream_body',
    family: 'streamlining',
    icon: '✈',
    name: 'Обтекаемость',
    variant: 'Дополнительный фюзеляж',
    desc_buff: 'Сопротивление ×0.5',
    desc_debuff: 'Тяга ×0.8',
    effects: [
      { stat: 'drag', mult: 0.5, isBuff: true },
      { stat: 'thrustAcc', mult: 0.8, isBuff: false },
    ],
    color: 0xb3ecea,
    buyPrice: 2,
    sellPrice: 1,
  },

  // ── FORSAGE (special) ──
  {
    id: 'forsage',
    family: 'forsage',
    special: true,
    icon: '🚀',
    name: 'Форсаж',
    desc_buff: 'Даёт новую способность «Форсаж»',
    desc_upgrade: 'Улучшает способность «Форсаж»',
    color: 0xb134ff,
    buyFlag: false,
    sellFlag: false,
  },
]

/* ================================================================
   СПОСОБНОСТИ — активные умения, получаемые через карточки.

   Структура:
     icon       — эмодзи для кнопки / попапа
     name       — название
     levels[]   — уровни (1-based). level = число карточек, но не
                  выше levels.length. Каждый уровень задаёт СВОИ
                  параметры (а не общий множитель):
                    multiplier — во сколько раз тяга во время действия
                    duration   — сколько секунд длится
                    cooldown   — сколько секунд перезарядка
   ================================================================ */
export const ABILITIES = {
  forsage: {
    icon: '🚀',
    name: 'Форсаж',
    levels: [
      { multiplier: 2.0, duration: 3.0, cooldown: 60 },
      { multiplier: 3.0, duration: 4.0, cooldown: 60 },
    ],
  },
}

/* ================================================================
   ДОСТИЖЕНИЯ — все определения в одном месте.

   Поля:
     key           — уникальный строковый ключ (используется в сейве!)
     icon          — эмодзи
     tier          — 'easy' | 'medium' | 'hard' (цвет рамки)
     name, desc    — тексты
     target        — одиночная цель (число-накопитель)
     steps         — многоэтапные: [{ target, label }]
     unit          — 'm' — форматировать как метры; иначе — просто число
     const_target  — порог для «мгновенной» проверки в коде
     timeLimit     — мс, лимит времени (time-limited ачивки)
================================================================ */
export const ACHIEVEMENTS = [
  /* ---------- Лёгкие (зелёные) ---------- */
  { key: 'first_launch', icon: '🎈', tier: 'easy', name: 'Первый пуск', desc: 'Запустить ракету' },

  {
    key: 'first_steps',
    icon: '🌱',
    tier: 'easy',
    name: 'Первые шаги',
    desc: 'Пролететь суммарно',
    unit: 'm',
    steps: [
      { target: 1000, label: '1 км' },
      { target: 3000, label: '3 км' },
      { target: 10000, label: '10 км' },
      { target: 35000, label: '35 км' },
      { target: 100000, label: '100 км' },
      { target: 300000, label: '300 км' },
      { target: 1000000, label: '1000 км' },
    ],
  },

  {
    key: 'traveler',
    icon: '🚶‍♂️',
    tier: 'easy',
    name: 'Путник',
    desc: 'Успешных приземлений',
    steps: [
      { target: 10, label: '10 раз' },
      { target: 30, label: '30 раз' },
      { target: 100, label: '100 раз' },
      { target: 300, label: '300 раз' },
    ],
  },

  {
    key: 'climber',
    icon: '🧊',
    tier: 'easy',
    name: 'Скалолаз',
    desc: 'Сесть на высоте выше 500 м',
    const_target: 500,
  },

  {
    key: 'citizen',
    icon: '🗿',
    tier: 'easy',
    name: 'Обыватель',
    desc: '5 запусков подряд без апгрейдов',
    target: 5,
  },

  /* ---------- Средние (фиолетовые) ---------- */
  {
    key: 'orbit',
    icon: '🚀',
    tier: 'medium',
    name: 'Орбита',
    desc: '25 км за один запуск',
    const_target: 25000,
  },

  {
    key: 'sniper',
    icon: '🎯',
    tier: 'medium',
    name: 'Снайпер',
    desc: 'Сесть в 40 м от сундука',
    const_target: 40,
  },

  {
    key: 'collector',
    icon: '💥',
    tier: 'medium',
    name: 'Коллекционер',
    desc: 'Открыть все сундуки',
    target: CHESTS.allPositions.length,
  },

  {
    key: 'soft_landing',
    icon: '🛬',
    tier: 'medium',
    name: 'Мягкая посадка',
    desc: 'Сесть со скоростью < 5 м/с',
    const_target: 5,
  },

  /* ---------- Сложные (оранжевые) ---------- */
  {
    key: 'maximalist',
    icon: '🛒',
    tier: 'hard',
    name: 'Максималист',
    desc: 'Прокачать все улучшения на максимум',
  },

  {
    key: 'intercontinental',
    icon: '🌌',
    tier: 'hard',
    name: 'Межконтинентальный',
    desc: '500 км за один запуск',
    const_target: 500000,
  },

  {
    key: 'hundred',
    icon: '💯',
    tier: 'hard',
    name: '100%',
    desc: 'Выполнить все остальные достижения',
  },

  /* ---------- Спринтер ---------- */
  {
    key: 'sprinter',
    icon: '⏱️',
    tier: 'hard',
    name: 'Спринтер',
    desc: 'Собрать все сундуки за 25 минут',
    target: CHESTS.allPositions.length,
    timeLimit: 25 * 60 * 1000,
  },
]

/* ================================================================
   RULES_PARAMS — параметры формул (чистые данные для config.html).
   Исполняемые функции RULES собираются в config.ts.
================================================================ */
export const RULES_PARAMS = {
  launchSpeed: { base: 20, mult: 6 },
  maxFuel: { base: 1.8, mult: 1.758 },
  thrustAcc: { base: 12, mult: 3.0 },

  /**
   * Коэффициент сопротивления воздуха в зависимости от угла атаки.
   * aligned, broadside, backward — Cd при α = 0°, 90°, 180°.
   * aeroScale — как апгрейд «Аэродинамика» снижает Cd.
   */
  drag: {
    aligned: 0.0025,
    broadside: 0.0155,
    backward: 0.0055,
    aeroScale: 0.45,
  },
}
