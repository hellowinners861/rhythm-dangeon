// save.js … localStorage セーブ/ロード(バージョン管理)
// キー rhythm-dungeon-save に {version, calibrationMs, ...} を保存する。
// 破損・未存在・旧バージョン時はデフォルト値へフォールバックする。

const SAVE = (() => {
  const KEY = "rhythm-dungeon-save";
  const VERSION = 4;

  // 章進行の初期値(DESIGN §10・Step8)。
  //   unlockedChapter … 解放済みの最新章(1..3)。これ未満の章は全ステージ解放済み。
  //   unlockedStage   … unlockedChapter 内で解放済みの最新ステージ(1..5)。
  //   clearedBoss     … 各章ボス撃破フラグ(index0=1章)。
  //   seenOpening     … オープニング演出を見たか。
  //   seenChapterIntro… 各章の章開始演出を見たか(index0=1章)。
  function defaultProgress() {
    return {
      unlockedChapter: 1,
      unlockedStage: 1,
      clearedBoss: [false, false, false],
      seenOpening: false,
      seenChapterIntro: [false, false, false],
    };
  }

  function defaults() {
    return {
      version: VERSION,
      calibrationMs: 0,           // レイテンシ較正値(ms)
      coins: 0,                   // 所持コイン(メタ通貨)
      unlockedChars: ["rat"],     // 解放済みキャラid
      ownedEquip: [],             // 所持装備id配列
      equipment: { head: [], body: [], feet: [], weapon: [] }, // 現在の装備(各部位 最大3枠)
      equipSlots: { head: 1, body: 1, feet: 1, weapon: 1 }, // 解放済み装備枠数(部位ごと)
      volumes: { bgm: 0.8, se: 0.8 }, // 音量(0..1)
      records: {},                // 曲別ハイスコア等(将来用)
      progress: defaultProgress(),// 章・ステージ進行(Step8)
      selectedSong: "song01",     // 出撃準備で選択中の曲id(未設定・不正時はsong01にフォールバック)
    };
  }

  let data = defaults();

  // 進行データを既定値で補完(欠損・不正な配列長を安全化する)。
  function fixProgress(p) {
    const d = defaultProgress();
    if (!p || typeof p !== "object") return d;
    if (typeof p.unlockedChapter === "number") d.unlockedChapter = Math.max(1, Math.min(3, p.unlockedChapter));
    if (typeof p.unlockedStage === "number") d.unlockedStage = Math.max(1, Math.min(5, p.unlockedStage));
    if (Array.isArray(p.clearedBoss)) for (let i = 0; i < 3; i++) d.clearedBoss[i] = !!p.clearedBoss[i];
    d.seenOpening = !!p.seenOpening;
    if (Array.isArray(p.seenChapterIntro)) for (let i = 0; i < 3; i++) d.seenChapterIntro[i] = !!p.seenChapterIntro[i];
    return d;
  }

  function normalizeEquipment(src, slots) {
    const d = { head: [], body: [], feet: [], weapon: [] };
    const max = (typeof CONFIG !== "undefined" && CONFIG.EQUIP_SLOTS) ? CONFIG.EQUIP_SLOTS.MAX : 3;
    for (const slot of Object.keys(d)) {
      const raw = src && src[slot];
      const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      const seen = new Set();
      const limit = Math.max(1, Math.min(max, slots && slots[slot] ? slots[slot] : max));
      for (const id of arr) {
        if (typeof id !== "string" || seen.has(id)) continue;
        seen.add(id);
        d[slot].push(id);
        if (d[slot].length >= limit) break;
      }
    }
    return d;
  }

  function normalizeEquipSlots(src) {
    const max = (typeof CONFIG !== "undefined" && CONFIG.EQUIP_SLOTS) ? CONFIG.EQUIP_SLOTS.MAX : 3;
    const initial = (typeof CONFIG !== "undefined" && CONFIG.EQUIP_SLOTS) ? CONFIG.EQUIP_SLOTS.INITIAL : 1;
    const d = { head: initial, body: initial, feet: initial, weapon: initial };
    if (src && typeof src === "object") {
      for (const slot of Object.keys(d)) {
        if (typeof src[slot] === "number") d[slot] = Math.max(initial, Math.min(max, Math.floor(src[slot])));
      }
    }
    return d;
  }

  // 旧バージョンからの移行。v1(calibrationMsのみ)/v2(コイン・装備等)/v3(章進行)から引き継ぐ。
  function migrate(obj) {
    if (!obj || typeof obj !== "object") return defaults();
    if (obj.version !== VERSION) {
      // バージョン差異時はデフォルトに既知フィールドをマージして作り直す
      const d = defaults();
      if (typeof obj.calibrationMs === "number") d.calibrationMs = obj.calibrationMs;
      // v2/v3→v4: コイン・装備・キャラ解放を引き継ぎ、単一装備を配列装備へ変換する
      if (obj.version === 2 || obj.version === 3) {
        if (typeof obj.coins === "number") d.coins = obj.coins;
        if (Array.isArray(obj.unlockedChars)) d.unlockedChars = obj.unlockedChars.slice();
        if (Array.isArray(obj.ownedEquip)) d.ownedEquip = obj.ownedEquip.slice();
        d.equipSlots = normalizeEquipSlots(obj.equipSlots);
        d.equipment = normalizeEquipment(obj.equipment || {}, d.equipSlots);
        d.volumes = Object.assign(defaults().volumes, obj.volumes || {});
        d.records = obj.records || {};
        if (obj.version === 3) {
          d.progress = fixProgress(obj.progress);
          if (typeof obj.selectedSong === "string") d.selectedSong = obj.selectedSong;
        }
      }
      return d;
    }
    // 欠損フィールドをデフォルトで補完(浅いマージ + ネストも補完)
    const d = Object.assign(defaults(), obj);
    d.equipSlots = normalizeEquipSlots(obj.equipSlots);
    d.equipment = normalizeEquipment(obj.equipment || {}, d.equipSlots);
    d.volumes = Object.assign(defaults().volumes, obj.volumes || {});
    d.records = obj.records || {};
    d.progress = fixProgress(obj.progress);
    return d;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        data = defaults();
      } else {
        data = migrate(JSON.parse(raw));
      }
    } catch (e) {
      // JSON破損など
      data = defaults();
    }
    return data;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      // localStorage不可(プライベートモード等)は黙って無視
    }
    return data;
  }

  // セーブ初期化(オプション画面から呼ばれる)。既定値に戻して即保存する。
  function reset() {
    data = defaults();
    save();
    return data;
  }

  return {
    load,
    save,
    reset,
    // 現在のセーブデータ(直接参照可)
    get data() { return data; },
  };
})();
