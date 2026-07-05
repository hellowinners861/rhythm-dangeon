// config.js … 全調整値の集約(CONFIG)
// 判定窓・物理・キャラ・敵・装備・アイテム・章・経済などをここに全て置く。
// 今後のステップで各セクションを追記していく前提の器。

const CONFIG = {
  // 入力判定窓(ミリ秒)。PERFECT/GOOD以外はMISS。DESIGN §2.2
  JUDGE: { PERFECT_MS: 60, GOOD_MS: 120 },

  // メトロノーム(Step1のリズムテスト用。将来は曲データが持つ)
  METRONOME: { BPM: 120, BEATS_PER_BAR: 4 },

  // レイテンシ較正。TAP_COUNT回タップして平均ズレを算出。手動スライダーは±MANUAL_RANGE_MS
  CALIBRATION: { TAP_COUNT: 8, MANUAL_RANGE_MS: 200 },

  // 論理解像度(devicePixelRatioでスケーリング)
  VIEW: { W: 1600, H: 900 },

  // コンボ/フィーバー。FEVER_COMBO以上でフィーバー(Step5以降で演出)
  COMBO: { FEVER_COMBO: 16 },

  // 1タイルの論理px(1600×900で横20タイルぶんの視界)
  TILE: 80,

  // プレイヤーの物理(拍ゲート式アクション基盤。DESIGN §3)
  PHYSICS: {
    MOVE_TWEEN_BEATS: 0.4,   // 移動トゥイーンの所要拍
    JUMP_RISE_TILES: 2,      // ジャンプ上昇タイル数
    JUMP_RISE_BEATS: 0.5,    // 上昇の所要拍
    GRAVITY_TILES: 22,       // 落下加速度(タイル/s^2)
    MAX_FALL_TILES: 14,      // 最大落下速度(タイル/s)
  },

  // 追従カメラ(DESIGN §6)
  CAMERA: {
    FORWARD_TILES: 3,        // 進行方向の先読みオフセット(タイル)
    LERP: 0.12,              // 毎フレームの追従率
  },

  // ステージ生成(チャンク方式・DESIGN §4/§6)
  STAGE: {
    CHUNK_W: 16,          // チャンク幅(タイル)
    CHUNK_H: 11,          // チャンク高さ(タイル)
    ADVANCE_RATE: 0.45,   // フルコンボ時の1拍あたり平均前進タイル数(ゴール距離=総拍数×これ)
    TEST_BEATS: 120,      // Step5まで: メトロノーム時の仮想「曲の総拍数」
    BORDER_GROUND_Y: 8,   // チャンク境界の床の行(接続保証用)
    // E/C/I マーカーの基礎採用率。章の densityMul を乗じて(上限1)シード抽選する(DESIGN §6・Step8)。
    SPAWN_RATE: { E: 0.8, C: 0.9, I: 0.7 },
    BOSS_RATE: 0.5,       // ボスステージの通常区間の長さ倍率(曲の約0.5周分。DESIGN §10)
    ARENA_W: 24,          // ボスアリーナ幅(タイル)
  },

  // プレイアブルキャラ(DESIGN §5)。type=攻撃方式。色は描画プレースホルダ。
  // priceは解放価格(コイン)。ratは初期解放済みのためpriceなし。
  CHARACTERS: {
    rat:   { name: "ラット",     hp: 3, atk: 1, type: "tackle", tackleTiles: 2, color: "#7fb0ff" },
    sword: { name: "ソードマン", hp: 4, atk: 1, type: "sword",  range: 1,       color: "#7fd39b", price: 1000 },
    gun:   { name: "ガンナー",   hp: 2, atk: 2, type: "beam",   reloadBeats: 1, color: "#ffb066", price: 1500 },
  },

  // 戦闘の共通調整値(DESIGN §3)
  COMBAT: {
    INVULN_BEATS: 2,      // 被弾後の無敵拍数
    KNOCKBACK_TILES: 1,   // 被弾ノックバック(タイル)
    FEVER_ATK_MUL: 1.5,   // フィーバー中の攻撃倍率(切り上げ)
    HITSTOP_MS: 40,       // 敵撃破時のヒットストップ(rAF側演出・拍計算に不使用)
  },

  // ザコ敵・基本6種+色違い6種(DESIGN §7)。interval=行動周期(拍)、dmg=接触/攻撃ダメージ。
  // 色・形パラメータも各敵に持たせる(データ駆動)。coinDrop=撃破時のコイン枚数(フィーバー中は2倍)。
  // 色違いは base に元種のキーを持ち、行動エンジン(ai)は元種と共通のものを流用する(Step7)。
  ENEMIES: {
    slime:  { name: "スライム",   hp: 1, dmg: 1, interval: 2, ai: "patrol",  color: "#7fd36b", coinDrop: 1 },
    bat:    { name: "バット",     hp: 1, dmg: 1, interval: 1, ai: "chase",   fly: true, color: "#a98fe0", vision: 8, coinDrop: 1 },
    knight: { name: "ナイト",     hp: 2, dmg: 1, interval: 2, ai: "knight",  color: "#c3c9dc", coinDrop: 1 },
    gunner: { name: "ガンナー敵", hp: 1, dmg: 1, interval: 4, ai: "shooter", color: "#e0a56b", bulletSpeed: 1, coinDrop: 1 },
    ghost:  { name: "ゴースト",   hp: 1, dmg: 1, interval: 2, ai: "ghost",   fly: true, color: "#cfe3ff", vision: 12, coinDrop: 1 },
    bomber: { name: "ボマー",     hp: 2, dmg: 1, interval: 3, ai: "bomber",  color: "#e07f97", bombFuse: 2, bombMax: 1, coinDrop: 1 },

    // --- 色違い6種(DESIGN §7・強化版)。base=元種キー。enemies.js側のAI関数へ渡すフラグのみ最小追加。
    redslime:    { name: "レッドスライム", base: "slime",  hp: 2, dmg: 1, interval: 1, ai: "patrol",  color: "#e0473f", coinDrop: 2 },
    goldbat:     { name: "ゴールドバット", base: "bat",    hp: 1, dmg: 1, interval: 1, ai: "chase", flee: true, fly: true, color: "#ffd54a", vision: 8, coinDrop: 10 },
    blackknight: { name: "ブラックナイト", base: "knight", hp: 4, dmg: 2, interval: 2, ai: "knight",  color: "#1c1c22", coinDrop: 2 },
    sniper:      { name: "スナイパー",     base: "gunner", hp: 1, dmg: 1, interval: 2, ai: "shooter", color: "#3f6fe0", bulletSpeed: 2, coinDrop: 2 },
    wraith:      { name: "怨霊",           base: "ghost",  hp: 1, dmg: 1, interval: 2, ai: "ghost",   fly: true, color: "rgba(224,90,90,0.72)", vision: 12, coinDrop: 2 },
    deathbomber: { name: "デスボマー",     base: "bomber", hp: 2, dmg: 1, interval: 3, ai: "bomber",  color: "#16161a", bombFuse: 2, bombMax: 2, bombShape: "square", coinDrop: 2 },
  },

  // 拾得アイテム(DESIGN §8)。レベルの'I'マーカーをこの確率(合計1)で抽選し実体化する。
  ITEMS: {
    HEAL_AMOUNT: 1,      // ハート:HP回復量
    SHIELD_ADD: 1,        // シールド:付与量
    SHIELD_MAX: 2,        // シールドの上限
    BOOST_BEATS: 16,       // ブースト:効果持続(拍)
    DROP_RATES: { heart: 0.4, shield: 0.3, boost: 0.3 },
  },

  // 章テーマ(DESIGN §10)。見た目(背景・タイル色)と難度係数。進行システム自体はStep8。
  // variantRate=敵スポーン時に色違いへ差し替える確率 / densityMul=スポーン候補の採用率係数(Step7時点では要確認§7参照)。
  CHAPTERS: [
    { id: 1, name: "静寂の森",        bg: ["#05060a", "#12331f"], tile: "#2a4d3a", tileTop: "#3f7050", variantRate: 0.15, densityMul: 1.0 },
    { id: 2, name: "ノイズの機械都市", bg: ["#0a0a12", "#33251a"], tile: "#4d3a2a", tileTop: "#705a3f", variantRate: 0.30, densityMul: 1.15 },
    { id: 3, name: "音喰らいの城",    bg: ["#0a0512", "#2a1233"], tile: "#3a2a4d", tileTop: "#5a3f70", variantRate: 0.50, densityMul: 1.3 },
  ],

  // 経済(DESIGN §9/§11)。ゲームオーバー時に持ち帰るコインの割合(端数切り捨て)。
  ECONOMY: { GAMEOVER_COIN_RATE: 0.5 },

  // 装備40種(頭・体・足・武器 × 各10種)。DESIGN §9。
  // fxは Equip.stats() が集計する効果語彙(js/equip.js 参照)。
  EQUIPMENT: {
    head: [
      { id: "woodhat",     icon: "🎩",  name: "木の帽子",       desc: "被ダメージ10%減",                 price: 100,  fx: { defMul: 0.9 } },
      { id: "ironhelm",    icon: "🪖",  name: "鉄のヘルム",     desc: "被ダメージ半減",                   price: 400,  fx: { defMul: 0.5 } },
      { id: "featherhat",  icon: "🪶",  name: "羽飾りの帽子",   desc: "フィーバー必要コンボ-4",           price: 250,  fx: { feverReq: -4 } },
      { id: "notehead",    icon: "🎵",  name: "音符のカチューシャ", desc: "GOOD判定窓+20ms",             price: 300,  fx: { goodWindow: 20 } },
      { id: "headphones",  icon: "🎧",  name: "ヘッドフォン",   desc: "PERFECT判定窓+15ms",               price: 350,  fx: { perfectWindow: 15 } },
      { id: "crown",       icon: "👑",  name: "王冠",           desc: "コイン獲得+50%",                   price: 800,  fx: { coinMul: 1.5 } },
      { id: "oniface",     icon: "👹",  name: "鬼の面",         desc: "攻撃力+1、ただし被ダメージ+25%",   price: 450,  fx: { atk: 1, defMul: 1.25 } },
      { id: "shogunkabuto",icon: "⛑️", name: "将軍の兜",       desc: "被ダメージ30%減+ノックバック無効", price: 600,  fx: { defMul: 0.7, knockbackMul: 0 } },
      { id: "witchhat",    icon: "🧙",  name: "魔女の帽子",     desc: "攻撃力+1",                         price: 500,  fx: { atk: 1 } },
      { id: "dragonhelm",  icon: "🐲",  name: "龍の兜",         desc: "被ダメージ60%減",                   price: 1200, fx: { defMul: 0.4 } },
    ],
    body: [
      { id: "clothtop",     icon: "👕", name: "布の服",         desc: "最大HP+1",                         price: 100,  fx: { maxHp: 1 } },
      { id: "leatherarmor", icon: "🦺", name: "革の鎧",         desc: "最大HP+2",                         price: 300,  fx: { maxHp: 2 } },
      { id: "ironarmor",    icon: "🛡️", name: "鉄の鎧",        desc: "最大HP+3、ただしフィーバー必要コンボ+4", price: 550, fx: { maxHp: 3, feverReq: 4 } },
      { id: "shieldvest",   icon: "🧥", name: "シールドベスト", desc: "ステージ開始時シールド1回付与",     price: 500,  fx: { shieldStart: 1 } },
      { id: "thornarmor",   icon: "🌵", name: "とげの鎧",       desc: "接触してきた敵に1ダメージ反撃",     price: 450,  fx: { thorns: 1 } },
      { id: "ninjagi",      icon: "🥷", name: "忍び装束",       desc: "敵の弾のダメージ半減",               price: 400,  fx: { projDefMul: 0.5 } },
      { id: "tailcoat",     icon: "🎼", name: "楽団の燕尾服",   desc: "フィーバー中攻撃力+1",               price: 550,  fx: { feverAtk: 1 } },
      { id: "silverarmor",  icon: "❄️", name: "白銀の鎧",      desc: "最大HP+2+開始時シールド1回",         price: 850,  fx: { maxHp: 2, shieldStart: 1 } },
      { id: "slimesuit",    icon: "🟢", name: "スライムスーツ", desc: "ノックバック無効+最大HP+1",         price: 500,  fx: { knockbackMul: 0, maxHp: 1 } },
      { id: "phoenixrobe",  icon: "🔥", name: "不死鳥の羽衣",   desc: "HP0時に1回だけHP1で復活(1ステージ1回)", price: 1200, fx: { revive: true } },
    ],
    feet: [
      { id: "leatherboots",  icon: "🥾", name: "革のブーツ",     desc: "ノックバック距離半減",             price: 100,  fx: { knockbackMul: 0.5 } },
      { id: "rabbitshoes",   icon: "🐇", name: "うさぎの靴",     desc: "ジャンプ高さ+1タイル",             price: 300,  fx: { jumpPlus: 1 } },
      { id: "irongeta",      icon: "⚙️", name: "鉄下駄",        desc: "ノックバック無効",                 price: 300,  fx: { knockbackMul: 0 } },
      { id: "springboots",   icon: "🌀", name: "バネブーツ",     desc: "空中制御+1タイル",                 price: 400,  fx: { airControlPlus: 1 } },
      { id: "magnetsandals", icon: "🧲", name: "磁石のサンダル", desc: "周囲2タイルのコインを自動回収",     price: 350,  fx: { magnet: 2 } },
      { id: "silentslippers",icon: "🩰", name: "静寂のスリッパ", desc: "ナイト系が隣接しても反応しない",     price: 450,  fx: { stealth: true } },
      { id: "lavaboots",     icon: "🌋", name: "溶岩ブーツ",     desc: "トゲ・地形ダメージ無効",           price: 500,  fx: { lavaImmune: true } },
      { id: "featherboots",  icon: "🪽", name: "羽の靴",         desc: "1拍あたりの移動距離2倍",           price: 700,  fx: { moveDist: 2 } },
      { id: "idatensocks",   icon: "💨", name: "韋駄天足袋",     desc: "ジャンプ高さ+1+空中制御+1",         price: 650,  fx: { jumpPlus: 1, airControlPlus: 1 } },
      { id: "timeshoes",     icon: "⏳", name: "時の靴",         desc: "MISS時にコンボが0でなく半減で済む", price: 1000, fx: { missComboHalf: true } },
    ],
    weapon: [
      { id: "fistring",       icon: "💍", name: "拳のリング",     desc: "攻撃力+1",                                 price: 150,  fx: { atk: 1 } },
      { id: "powerglove",     icon: "🧤", name: "パワーグローブ", desc: "攻撃力+2",                                 price: 400,  fx: { atk: 2 } },
      { id: "tuningblade",    icon: "🔱", name: "音叉の刃",       desc: "PERFECT時の攻撃力+2",                       price: 450,  fx: { atkPerfect: 2 } },
      { id: "rhymedrum",      icon: "🥁", name: "韻踏みの太鼓",   desc: "コンボ8ごとに攻撃力+1(最大+3)",             price: 500,  fx: { comboAtkStep: 8, comboAtkMax: 3 } },
      { id: "piercelens",     icon: "🔍", name: "貫通レンズ",     desc: "攻撃が敵を1体貫通する",                     price: 550,  fx: { pierce: true } },
      { id: "greatswordsoul", icon: "⚔️", name: "大剣のソウル",  desc: "攻撃力+3、ただしフィーバー必要コンボ+4",     price: 650,  fx: { atk: 3, feverReq: 4 } },
      { id: "vampfang",       icon: "🧛", name: "吸血の牙",       desc: "敵撃破時10%でHP1回復",                       price: 700,  fx: { vampire: 0.1 } },
      { id: "blastgem",       icon: "💥", name: "爆裂の宝玉",     desc: "撃破した敵の周囲1タイルに巻き込みダメージ", price: 800,  fx: { blast: true } },
      { id: "thunderflute",   icon: "⚡",  name: "雷の笛",         desc: "フィーバー突入時、画面内の敵全体に1ダメージ", price: 600,  fx: { feverLightning: true } },
      { id: "legendsound",    icon: "🎶", name: "伝説の音塊",     desc: "攻撃力+2、PERFECT時さらに+1、コイン+25%",   price: 1500, fx: { atk: 2, atkPerfect: 1, coinMul: 1.25 } },
    ],
  },

  // ボス3種(章ごとに固定・DESIGN §7/§10・Step8)。
  // hp=「残り曲周回数×想定ヒットレート」の概算(バランスはStep9)。dmg=攻撃/接触ダメージ。
  // coinBonus=撃破ボーナスコイン。詳細な攻撃パターン(拍数・弾速・召喚数・サイズ)は js/boss.js の DATA に集約。
  BOSSES: {
    silencer:    { name: "オオコウモリ サイレンサー",     hp: 80,  dmg: 1, coinBonus: 100 },
    beatcrusher: { name: "鋼鉄ゴーレム ビートクラッシャー", hp: 200, dmg: 1, coinBonus: 300 },
    mutos:       { name: "音喰らい ミュートス",           hp: 400, dmg: 2, coinBonus: 1000 },
  },
};
