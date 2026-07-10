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
  // FEVER_FLASH_SEC: フィーバー突入時の画面フラッシュ演出の長さ(秒・Step9)
  COMBO: { FEVER_COMBO: 16, FEVER_FLASH_SEC: 0.35 },

  // ストーリーパネルの1文字送りの間隔(秒・Step9)
  STORY: { CHAR_INTERVAL_SEC: 0.04 },

  // タブ離脱時の一時停止(visibilitychange対応)。
  // RESUME_DELAY_SEC=「再開する」を押してから音楽と拍が続きで流れ出すまでの間(秒)。
  PAUSE: { RESUME_DELAY_SEC: 1.0 },

  // 1タイルの論理px(1600×900で横20タイルぶんの視界)
  TILE: 80,

  // スプライト描画(js/sprites.js の処理済み画像をプレイヤー等に使う。DRAW値は実プレイで微調整前提)
  SPRITE: {
    DRAW_TILES: 2.0,   // スプライトの描画高さ(タイル単位)。実プレイで微調整する前提
    FOOT_LIFT: 0.30,   // 足元をタイル中心からどれだけ下げるか(タイル単位。0でcy、正で下)
    // per-sprite アンカー表(画像比率)。攻撃画像は砂埃・スピード線で不透明boxが全面になり
    // 大きさ・位置が破綻するため、キャラ本体の 水平中心cx / 足元foot / 身長h を手動指定する。
    // scale = DRAW_TILES*TILE / (h*imgH) とし、画像点(cx,foot)を画面の足元へ合わせる。
    // アンカーが無いキー(敵/ボス等)は不透明box基準にフォールバックする。
    ANCHORS: {
      player_rat_idle:     { cx: 0.46,  foot: 0.883, h: 0.778 },
      player_rat_attack:   { cx: 0.52,  foot: 0.855, h: 0.72  },
      player_sword_idle:   { cx: 0.434, foot: 0.883, h: 0.791 },
      player_sword_attack: { cx: 0.50,  foot: 0.86,  h: 0.72  },
      player_gun_idle:     { cx: 0.51,  foot: 0.883, h: 0.771 },
      player_gun_attack:   { cx: 0.482, foot: 0.893, h: 0.782 },
      // 走りポーズ(砂埃が端まで達しboxが破綻するため手動指定)
      player_rat_run:      { cx: 0.55,  foot: 0.85,  h: 0.73 },
      player_gun_run:      { cx: 0.55,  foot: 0.85,  h: 0.72 },
      // 騎士2種(足元の砂埃対策。敵描画もANCHORSを参照する)
      enemy_knight:        { cx: 0.55,  foot: 0.87,  h: 0.77 },
      enemy_knight_black:  { cx: 0.55,  foot: 0.87,  h: 0.77 },
      // ソードマン走り(砂埃でboxが破綻するため手動指定)
      player_sword_run:    { cx: 0.55,  foot: 0.86,  h: 0.76 },
    },
    ENEMY_TILES: 1.15,    // ザコ敵スプライトの描画高さ(タイル単位)
    BOSS_TILES_PLUS: 0.4, // ボススプライトの描画高さ = (ボスの高さタイル数 + これ) × TILE
  },

  // プレイヤーの物理(拍ゲート式アクション基盤。DESIGN §3)
  PHYSICS: {
    MOVE_TWEEN_BEATS: 0.4,   // 移動トゥイーンの所要拍
    JUMP_RISE_TILES: 2,      // ジャンプ上昇タイル数
    JUMP_RISE_BEATS: 0.5,    // 上昇の所要拍
    GRAVITY_TILES: 22,       // 落下加速度(タイル/s^2)
    MAX_FALL_TILES: 14,      // 最大落下速度(タイル/s)
    AIR_JUMPS: 1,            // 空中ジャンプ(2段ジャンプ)の追加可能回数。着地でリセット(改修バッチ)
    AIR_CONTROL_TILES: 2,    // 空中制御の基本横移動距離(タイル)。地上移動の2倍。装備airControlPlusは加算
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
    GOAL_DELAY_SEC: 1.0,  // ゴール到達〜リザルト遷移までの紙吹雪演出の待機秒数(Step9)

    // 縦方向拡張(2Dグリッド生成。DESIGN §6)。ENABLED:false で従来の横一列生成に即時復帰できる
    // (ロールバック用の保険)。ボスステージは常に従来生成(縦拡張しない)。
    VERTICAL: {
      ENABLED: true,
      ROW_WEIGHTS: [3, 4, 3],   // グリッド行数1/2/3の重み(シード抽選)。1なら従来の横一列生成へ
      VERT_RATE: 0.35,          // 各ステップで縦移動を試みる確率(移動可能なときのみ)
      LEFT_RATE: 0.22,          // 横移動候補に左がある時、左へ折り返す確率(ゴールが右端固定にならない保険)
      MAX_REROLL: 8,            // BFS到達性チェック失敗時の再生成回数上限
    },
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
    // coinDrop=50(全種統一。仮組み経済調整)。フィーバー中は既存仕様どおり2倍(=100)になる。
    redslime:    { name: "レッドスライム", base: "slime",  hp: 2, dmg: 1, interval: 1, ai: "patrol",  color: "#e0473f", coinDrop: 50 },
    goldbat:     { name: "ゴールドバット", base: "bat",    hp: 1, dmg: 1, interval: 1, ai: "chase", flee: true, fly: true, color: "#ffd54a", vision: 8, coinDrop: 50 },
    blackknight: { name: "ブラックナイト", base: "knight", hp: 4, dmg: 1.5, interval: 2, ai: "knight",  color: "#1c1c22", coinDrop: 50 },
    sniper:      { name: "スナイパー",     base: "gunner", hp: 1, dmg: 1, interval: 2, ai: "shooter", color: "#3f6fe0", bulletSpeed: 2, coinDrop: 50 },
    wraith:      { name: "怨霊",           base: "ghost",  hp: 1, dmg: 1, interval: 2, ai: "ghost",   fly: true, color: "rgba(224,90,90,0.72)", vision: 12, coinDrop: 50 },
    deathbomber: { name: "デスボマー",     base: "bomber", hp: 2, dmg: 1, interval: 3, ai: "bomber",  color: "#16161a", bombFuse: 2, bombMax: 2, bombShape: "square", coinDrop: 50 },
  },

  // 拾得アイテム(DESIGN §8)。レベルの'I'マーカーをこの確率(合計1)で抽選し実体化する。
  ITEMS: {
    HEAL_AMOUNT: 1,      // ハート:HP回復量
    SHIELD_ADD: 1,        // シールド:付与量
    SHIELD_MAX: 2,        // シールドの上限
    BOOST_BEATS: 16,       // ブースト:効果持続(拍)
    DROP_RATES: { heart: 0.4, shield: 0.3, boost: 0.3 },

    // コイン額面4種(見た目・サイズ比は目安。r はタイルに対する半径比)
    COIN_TIERS: [
      { value: 50, r: 0.55, color: "#c86bff", ring: "#ffd54a", label: "50" }, // 特大・紫宝石風+金縁
      { value: 10, r: 0.42, color: "#ffd54a", ring: "#fff3c0", label: "10" }, // 大・金
      { value: 3,  r: 0.34, color: "#d8dce8", ring: "#ffffff", label: "3"  }, // 中・銀
      { value: 1,  r: 0.26, color: "#d09a52", ring: "#e8c188", label: ""   }, // 小・銅(ラベルなし)
    ],
    // レベル生成のCマーカーの額面抽選(シード乱数・重み)。10/50の出現率を引き上げ(経済調整)。
    COIN_SPAWN_WEIGHTS: [ { value: 1, w: 45 }, { value: 3, w: 25 }, { value: 10, w: 22 }, { value: 50, w: 8 } ],
  },

  // 章テーマ(DESIGN §10)。見た目(背景・タイル色)と難度係数。進行システム自体はStep8。
  // variantRate=敵スポーン時に色違いへ差し替える確率 / densityMul=スポーン候補の採用率係数(Step7時点では要確認§7参照)。
  // bgLayers=多層スクロール背景(奥→手前の順)。sprite=Spritesキー、parallax=カメラ連動率。
  //   0.03(月)はほぼ固定=常に遠くに見える / 0.25(森・都市)はゆっくり流れる。DESIGN §10
  CHAPTERS: [
    { id: 1, name: "静寂の森",        bg: ["#05060a", "#12331f"], tile: "#2a4d3a", tileTop: "#3f7050", variantRate: 0.15, densityMul: 1.0,  tileSprite: "tile_forest",
      bgLayers: [ { sprite: "bg_moon", parallax: 0.03 }, { sprite: "bg_forest", parallax: 0.25 } ] },
    { id: 2, name: "ノイズの機械都市", bg: ["#0a0a12", "#33251a"], tile: "#4d3a2a", tileTop: "#705a3f", variantRate: 0.30, densityMul: 1.15, tileSprite: "tile_city",
      bgLayers: [ { sprite: "bg_city", parallax: 0.25 } ] },
    { id: 3, name: "音喰らいの城",    bg: ["#0a0512", "#2a1233"], tile: "#3a2a4d", tileTop: "#5a3f70", variantRate: 0.50, densityMul: 1.3,  tileSprite: "tile_castle",
      bgLayers: [ { sprite: "bg_castle", parallax: 0.25 } ] },
  ],

  // 経済(DESIGN §9/§11)。ゲームオーバー時に持ち帰るコインの割合(端数切り捨て)。
  // SONG_CLEAR_COIN_MUL=曲が終わる前にゴールした「曲内クリア」時の持ち帰りコイン倍率。
  ECONOMY: { GAMEOVER_COIN_RATE: 0.5, SONG_CLEAR_COIN_MUL: 2 },

  // ホーム画面BGM(仮組み)。専用曲が無いため選択中の曲を小さめの音量でループ再生する。
  // GAINはbgmGain(BGM音量スライダー)の手前に挟む個別音量(0..1)。
  HOME_BGM: { GAIN: 0.35 },


  // 装備枠解放。各部位は初期1枠、コインで最大3枠まで解放できる。
  EQUIP_SLOTS: {
    INITIAL: 1,
    MAX: 3,
    UNLOCK_PRICES: [0, 800, 1800], // 2枠目/3枠目の解放価格
  },

  // 装備120種(頭・体・足・武器 × 各30種)。DESIGN §9。
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

      { id: "moonvisor",   icon: "🌙", name: "月影バイザー",     desc: "GOOD判定窓+10ms、コイン+10%",       price: 550,  fx: { goodWindow: 10, coinMul: 1.1 } },
      { id: "suncrest",    icon: "☀️", name: "太陽の紋章兜",     desc: "最大HP+1、フィーバー必要コンボ-2",   price: 650,  fx: { maxHp: 1, feverReq: -2 } },
      { id: "glasscrown",  icon: "💎", name: "硝子の王冠",       desc: "PERFECT判定窓+25ms、被ダメージ+10%", price: 900,  fx: { perfectWindow: 25, defMul: 1.1 } },
      { id: "drumcap",     icon: "🥁", name: "鼓笛隊の帽子",     desc: "コンボ攻撃の上限+1、GOOD判定窓+5ms", price: 700,  fx: { comboAtkMax: 1, goodWindow: 5 } },
      { id: "mirrorhelm",  icon: "🪞", name: "鏡面ヘルム",       desc: "敵弾ダメージ25%減、コイン+15%",     price: 850,  fx: { projDefMul: 0.75, coinMul: 1.15 } },
      { id: "stormhood",   icon: "🌩️", name: "嵐呼びのフード",   desc: "攻撃力+1、PERFECT判定窓+5ms",       price: 750,  fx: { atk: 1, perfectWindow: 5 } },
      { id: "leafmask",    icon: "🍃", name: "木の葉の面",       desc: "ナイト系に気づかれにくく、被ダメージ5%減", price: 720, fx: { stealth: true, defMul: 0.95 } },
      { id: "anchorhelm",  icon: "⚓", name: "碇の兜",           desc: "ノックバック無効、ジャンプ高さ-1",   price: 700,  fx: { knockbackMul: 0, jumpPlus: -1 } },
      { id: "metronomehat",icon: "📐", name: "メトロノーム帽",   desc: "GOOD判定窓+15ms、PERFECT判定窓+8ms", price: 800,  fx: { goodWindow: 15, perfectWindow: 8 } },
      { id: "coinberet",   icon: "🪙", name: "集金ベレー",       desc: "コイン+30%、攻撃力-1",             price: 900,  fx: { coinMul: 1.3, atk: -1 } },
      { id: "bulwarkhelm", icon: "🏰", name: "城壁ヘルム",       desc: "被ダメージ40%減、空中制御-1",       price: 950,  fx: { defMul: 0.6, airControlPlus: -1 } },
      { id: "focusband",   icon: "🎯", name: "集中の鉢巻",       desc: "PERFECT時の攻撃力+1、MISS時コンボ半減", price: 1000, fx: { atkPerfect: 1, missComboHalf: true } },
      { id: "echoear",     icon: "👂", name: "反響イヤーカフ",   desc: "GOOD判定窓+25ms、敵弾ダメージ10%減", price: 950,  fx: { goodWindow: 25, projDefMul: 0.9 } },
      { id: "cathood",     icon: "🐱", name: "猫耳フード",       desc: "空中制御+1、コイン磁力+1",          price: 850,  fx: { airControlPlus: 1, magnet: 1 } },
      { id: "skullmask",   icon: "💀", name: "しゃれこうべ面",   desc: "攻撃力+2、最大HP-1",               price: 950,  fx: { atk: 2, maxHp: -1 } },
      { id: "prismtiara",  icon: "🔮", name: "プリズムティアラ", desc: "フィーバー必要コンボ-6、被ダメージ+15%", price: 1100, fx: { feverReq: -6, defMul: 1.15 } },
      { id: "safetyhelmet",icon: "🚧", name: "安全第一ヘルメット", desc: "開始時シールド1回、ノックバック半減", price: 1000, fx: { shieldStart: 1, knockbackMul: 0.5 } },
      { id: "bardhat",     icon: "🎻", name: "吟遊詩人の帽子",   desc: "フィーバー中攻撃力+1、コイン+10%",   price: 1050, fx: { feverAtk: 1, coinMul: 1.1 } },
      { id: "voidcrown",   icon: "🕳️", name: "虚無の冠",         desc: "被ダメージ70%減、GOOD判定窓-20ms",  price: 1600, fx: { defMul: 0.3, goodWindow: -20 } },
      { id: "beatantenna", icon: "📡", name: "ビートアンテナ",   desc: "PERFECT判定窓+10ms、周囲3タイルのコイン回収", price: 1300, fx: { perfectWindow: 10, magnet: 3 } },
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

      { id: "chainmail",   icon: "⛓️", name: "鎖かたびら",       desc: "最大HP+1、敵弾ダメージ20%減",       price: 650,  fx: { maxHp: 1, projDefMul: 0.8 } },
      { id: "windcloak",   icon: "🧣", name: "風切りマント",     desc: "空中制御+1、被ダメージ10%増",       price: 600,  fx: { airControlPlus: 1, defMul: 1.1 } },
      { id: "coinvest",    icon: "💰", name: "金庫ベスト",       desc: "コイン+25%、ノックバック半減",      price: 900,  fx: { coinMul: 1.25, knockbackMul: 0.5 } },
      { id: "medicrobe",   icon: "⚕️", name: "衛生ローブ",       desc: "最大HP+1、撃破時8%でHP回復",        price: 850,  fx: { maxHp: 1, vampire: 0.08 } },
      { id: "sparkjacket", icon: "✨", name: "火花ジャケット",   desc: "フィーバー突入時に全体1ダメージ、被ダメージ5%減", price: 950, fx: { feverLightning: true, defMul: 0.95 } },
      { id: "paperarmor",  icon: "📜", name: "紙の鎧",           desc: "GOOD判定窓+30ms、被ダメージ+20%",   price: 700,  fx: { goodWindow: 30, defMul: 1.2 } },
      { id: "heavyplate",  icon: "🪨", name: "重装プレート",     desc: "最大HP+4、空中制御-1",             price: 1000, fx: { maxHp: 4, airControlPlus: -1 } },
      { id: "dancersuit",  icon: "💃", name: "舞踏服",           desc: "フィーバー必要コンボ-2、ジャンプ+1", price: 850,  fx: { feverReq: -2, jumpPlus: 1 } },
      { id: "mirrorcoat",  icon: "🪩", name: "ミラーコート",     desc: "敵弾ダメージ35%減、PERFECT窓+5ms", price: 950,  fx: { projDefMul: 0.65, perfectWindow: 5 } },
      { id: "berserkfur",  icon: "🐺", name: "狂獣の毛皮",       desc: "攻撃力+2、被ダメージ+20%",         price: 1000, fx: { atk: 2, defMul: 1.2 } },
      { id: "floatrobe",   icon: "🫧", name: "浮遊ローブ",       desc: "ジャンプ+1、ノックバック距離25%減", price: 900, fx: { jumpPlus: 1, knockbackMul: 0.75 } },
      { id: "luckkimono",  icon: "👘", name: "福招きの着物",     desc: "コイン+40%、最大HP-1",             price: 1100, fx: { coinMul: 1.4, maxHp: -1 } },
      { id: "aegisvest",   icon: "🔰", name: "守護紋ベスト",     desc: "開始時シールド2回",               price: 1200, fx: { shieldStart: 2 } },
      { id: "thornmail",   icon: "🦔", name: "返し針の鎧",       desc: "接触反撃2ダメージ、被ダメージ10%増", price: 1150, fx: { thorns: 2, defMul: 1.1 } },
      { id: "silentcape",  icon: "🌫️", name: "無音のケープ",     desc: "ナイト系に気づかれず、GOOD窓+10ms", price: 1000, fx: { stealth: true, goodWindow: 10 } },
      { id: "phoenixcoat", icon: "🦅", name: "再燃の外套",       desc: "復活1回、コイン+10%",             price: 1600, fx: { revive: true, coinMul: 1.1 } },
      { id: "magnetapron", icon: "🧲", name: "磁力エプロン",     desc: "周囲4タイルのコイン回収、最大HP+1", price: 1300, fx: { magnet: 4, maxHp: 1 } },
      { id: "tempojersey", icon: "🏃", name: "テンポジャージ",   desc: "移動距離2倍、被ダメージ+15%",      price: 1400, fx: { moveDist: 2, defMul: 1.15 } },
      { id: "royalarmor",  icon: "🦁", name: "王獣の鎧",         desc: "最大HP+3、攻撃力+1、コイン+15%",   price: 1800, fx: { maxHp: 3, atk: 1, coinMul: 1.15 } },
      { id: "nullmantle",  icon: "🌌", name: "無響マント",       desc: "被ダメージ45%減、フィーバー必要+2", price: 1500, fx: { defMul: 0.55, feverReq: 2 } },
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

      { id: "coinloafers", icon: "🪙", name: "集金ローファー",   desc: "コイン+20%、コイン磁力+1",         price: 650,  fx: { coinMul: 1.2, magnet: 1 } },
      { id: "cloudshoes",  icon: "☁️", name: "雲渡りの靴",       desc: "ジャンプ+2、被ダメージ+10%",       price: 900,  fx: { jumpPlus: 2, defMul: 1.1 } },
      { id: "brakeboots",  icon: "🛑", name: "制動ブーツ",       desc: "ノックバック無効、移動距離は伸びない", price: 650, fx: { knockbackMul: 0 } },
      { id: "wingheels",   icon: "🪽", name: "翼のかかと",       desc: "空中制御+2",                       price: 950,  fx: { airControlPlus: 2 } },
      { id: "goldgeta",    icon: "🟨", name: "黄金下駄",         desc: "コイン+35%、ジャンプ-1",           price: 1000, fx: { coinMul: 1.35, jumpPlus: -1 } },
      { id: "ninjatabi",   icon: "🥷", name: "忍び足袋",         desc: "ナイト系に気づかれず、空中制御+1", price: 900,  fx: { stealth: true, airControlPlus: 1 } },
      { id: "guardianboots",icon:"🛡️", name: "守護ブーツ",       desc: "最大HP+1、ノックバック半減",       price: 800,  fx: { maxHp: 1, knockbackMul: 0.5 } },
      { id: "sparkrollers",icon: "🛼", name: "火花ローラー",     desc: "移動距離2倍、GOOD判定窓-10ms",    price: 1100, fx: { moveDist: 2, goodWindow: -10 } },
      { id: "moonboots",   icon: "🌕", name: "月面ブーツ",       desc: "ジャンプ+1、落下後も空中制御+1",   price: 950,  fx: { jumpPlus: 1, airControlPlus: 1 } },
      { id: "vampclogs",   icon: "🩸", name: "吸血木靴",         desc: "撃破時5%でHP回復、攻撃力+1",      price: 1050, fx: { vampire: 0.05, atk: 1 } },
      { id: "shieldgreaves",icon:"🥾", name: "盾のすね当て",     desc: "開始時シールド1回、ノックバック25%減", price: 1000, fx: { shieldStart: 1, knockbackMul: 0.75 } },
      { id: "rhythmheels", icon: "👠", name: "リズムヒール",     desc: "PERFECT窓+10ms、GOOD窓+10ms",     price: 900,  fx: { perfectWindow: 10, goodWindow: 10 } },
      { id: "stormboots",  icon: "🌪️", name: "嵐走りの靴",       desc: "空中制御+1、フィーバー中攻撃+1",   price: 1100, fx: { airControlPlus: 1, feverAtk: 1 } },
      { id: "castleboots", icon: "🏰", name: "城塞ブーツ",       desc: "被ダメージ20%減、ジャンプ-1",      price: 950,  fx: { defMul: 0.8, jumpPlus: -1 } },
      { id: "maglevsoles", icon: "🚄", name: "磁気浮上ソール",   desc: "移動距離2倍、コイン磁力+2",        price: 1500, fx: { moveDist: 2, magnet: 2 } },
      { id: "glassslippers",icon:"👡", name: "硝子の靴",         desc: "PERFECT窓+20ms、最大HP-1",        price: 1200, fx: { perfectWindow: 20, maxHp: -1 } },
      { id: "reviveboots", icon: "🕯️", name: "灯火ブーツ",       desc: "復活1回、ノックバック半減",       price: 1600, fx: { revive: true, knockbackMul: 0.5 } },
      { id: "titanfeet",   icon: "🦶", name: "巨人の足具",       desc: "最大HP+2、空中制御-1",             price: 1100, fx: { maxHp: 2, airControlPlus: -1 } },
      { id: "luckysocks",  icon: "🍀", name: "幸運の靴下",       desc: "コイン+15%、撃破時5%でHP回復",    price: 1000, fx: { coinMul: 1.15, vampire: 0.05 } },
      { id: "beatboosters",icon: "🚀", name: "ビートブースター", desc: "ジャンプ+1、移動距離2倍、被ダメージ+10%", price: 1700, fx: { jumpPlus: 1, moveDist: 2, defMul: 1.1 } },
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

      { id: "coinblade",   icon: "🪙", name: "集金ブレード",     desc: "攻撃力+1、コイン+15%",             price: 650,  fx: { atk: 1, coinMul: 1.15 } },
      { id: "glassdagger", icon: "🔪", name: "硝子の短剣",       desc: "PERFECT時攻撃+3、最大HP-1",       price: 850,  fx: { atkPerfect: 3, maxHp: -1 } },
      { id: "shieldmace",  icon: "🔨", name: "盾砕きメイス",     desc: "攻撃力+1、ノックバック半減",       price: 700,  fx: { atk: 1, knockbackMul: 0.5 } },
      { id: "stormlute",   icon: "🎸", name: "嵐のリュート",     desc: "フィーバー突入時全体1ダメージ、攻撃+1", price: 950, fx: { feverLightning: true, atk: 1 } },
      { id: "needlewand",  icon: "🪡", name: "針の指揮棒",       desc: "接触反撃1、PERFECT窓+5ms",        price: 750,  fx: { thorns: 1, perfectWindow: 5 } },
      { id: "vampblade",   icon: "🗡️", name: "吸血剣",           desc: "攻撃力+1、撃破時12%でHP回復",      price: 1100, fx: { atk: 1, vampire: 0.12 } },
      { id: "magnetgun",   icon: "🔫", name: "磁力銃",           desc: "攻撃力+1、コイン磁力+3",          price: 1000, fx: { atk: 1, magnet: 3 } },
      { id: "reststaff",   icon: "🪄", name: "休符の杖",         desc: "GOOD窓+20ms、攻撃力-1",           price: 700,  fx: { goodWindow: 20, atk: -1 } },
      { id: "royalspear",  icon: "🔱", name: "王家の槍",         desc: "攻撃力+2、コイン+10%",             price: 1150, fx: { atk: 2, coinMul: 1.1 } },
      { id: "bomborb",     icon: "💣", name: "爆心オーブ",       desc: "撃破時爆発、被ダメージ10%増",     price: 950,  fx: { blast: true, defMul: 1.1 } },
      { id: "piercebow",   icon: "🏹", name: "貫き弓",           desc: "貫通、PERFECT時攻撃+1",           price: 1000, fx: { pierce: true, atkPerfect: 1 } },
      { id: "combocharm",  icon: "📿", name: "連撃のお守り",     desc: "コンボ8ごと攻撃+1、最大+4",       price: 1200, fx: { comboAtkStep: 8, comboAtkMax: 4 } },
      { id: "feveraxe",    icon: "🪓", name: "熱狂の斧",         desc: "フィーバー中攻撃+2、必要コンボ+2", price: 1150, fx: { feverAtk: 2, feverReq: 2 } },
      { id: "quietbell",   icon: "🔔", name: "静音ベル",         desc: "ナイト系に気づかれず、攻撃+1",     price: 1000, fx: { stealth: true, atk: 1 } },
      { id: "guardianrod", icon: "🦯", name: "守護のロッド",     desc: "開始時シールド1回、攻撃+1",        price: 1050, fx: { shieldStart: 1, atk: 1 } },
      { id: "prismcannon", icon: "🌈", name: "プリズム砲",       desc: "攻撃力+3、GOOD窓-15ms",           price: 1500, fx: { atk: 3, goodWindow: -15 } },
      { id: "phoenixclaw", icon: "🔥", name: "不死鳥の爪",       desc: "復活1回、攻撃力+1",               price: 1700, fx: { revive: true, atk: 1 } },
      { id: "tidalharp",   icon: "🌊", name: "潮騒のハープ",     desc: "GOOD窓+10ms、撃破時6%でHP回復",   price: 950,  fx: { goodWindow: 10, vampire: 0.06 } },
      { id: "voidscythe",  icon: "🌑", name: "虚無の大鎌",       desc: "攻撃力+4、最大HP-2",              price: 1800, fx: { atk: 4, maxHp: -2 } },
      { id: "beatscepter", icon: "👑", name: "拍王の王笏",       desc: "攻撃+2、PERFECT時+2、コイン+20%", price: 2200, fx: { atk: 2, atkPerfect: 2, coinMul: 1.2 } },
    ],
  },

  // ボス3種(章ごとに固定・DESIGN §7/§10・Step8)。
  // hp=「残り曲周回数×想定ヒットレート」の概算(バランスはStep9)。dmg=攻撃/接触ダメージ。
  // coinBonus=撃破ボーナスコイン。詳細な攻撃パターン(拍数・弾速・召喚数・サイズ)は js/boss.js の DATA に集約。
  // Step9時点では現状維持。実プレイでの強さ調整はユーザーのプレイテストのフィードバック待ち。
  BOSSES: {
    silencer:    { name: "オオコウモリ サイレンサー",     hp: 80,  dmg: 1, coinBonus: 100 },
    beatcrusher: { name: "鋼鉄ゴーレム ビートクラッシャー", hp: 200, dmg: 1, coinBonus: 300 },
    mutos:       { name: "音喰らい ミュートス",           hp: 400, dmg: 2, coinBonus: 1000 },
  },
};
