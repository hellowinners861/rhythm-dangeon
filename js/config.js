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

  // --- 以降のステップで追記予定 ---
  // PHYSICS: {...},      // 重力・トゥイーン・ジャンプ高さ
  // STAGE: {...},        // ADVANCE_RATE・チャンク幅
  // CHARACTERS: {...},   // 3キャラのHP/威力/射程/CD/解放価格
  // ENEMIES: {...},      // ザコ12種
  // BOSSES: {...},       // ボス3種
  // ITEMS: {...},        // 拾得アイテム
  // EQUIPMENT: {...},    // 装備40種
  // ECONOMY: {...},      // コイン・章難易度
};
