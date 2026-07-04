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
  },

  // --- 以降のステップで追記予定 ---
  // STAGE: {...},        // ADVANCE_RATE・チャンク幅
  // CHARACTERS: {...},   // 3キャラのHP/威力/射程/CD/解放価格
  // ENEMIES: {...},      // ザコ12種
  // BOSSES: {...},       // ボス3種
  // ITEMS: {...},        // 拾得アイテム
  // EQUIPMENT: {...},    // 装備40種
  // ECONOMY: {...},      // コイン・章難易度
};
