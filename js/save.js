// save.js … localStorage セーブ/ロード(バージョン管理)
// キー rhythm-dungeon-save に {version, calibrationMs, ...} を保存する。
// 破損・未存在・旧バージョン時はデフォルト値へフォールバックする。

const SAVE = (() => {
  const KEY = "rhythm-dungeon-save";
  const VERSION = 2;

  function defaults() {
    return {
      version: VERSION,
      calibrationMs: 0,           // レイテンシ較正値(ms)
      coins: 0,                   // 所持コイン(メタ通貨)
      unlockedChars: ["rat"],     // 解放済みキャラid
      ownedEquip: [],             // 所持装備id配列
      equipment: { head: null, body: null, feet: null, weapon: null }, // 現在の装備
      volumes: { bgm: 0.8, se: 0.8 }, // 音量(0..1)
      records: {},                // 曲別ハイスコア等(将来用)
    };
  }

  let data = defaults();

  // 旧バージョンからの移行。v1(calibrationMsのみ)からv2(コイン・装備等)へ引き継ぐ。
  function migrate(obj) {
    if (!obj || typeof obj !== "object") return defaults();
    if (obj.version !== VERSION) {
      // バージョン差異時はデフォルトに既知フィールドをマージして作り直す
      const d = defaults();
      if (typeof obj.calibrationMs === "number") d.calibrationMs = obj.calibrationMs;
      return d;
    }
    // 欠損フィールドをデフォルトで補完(浅いマージ + equipment/volumesはネストも補完)
    const d = Object.assign(defaults(), obj);
    d.equipment = Object.assign(defaults().equipment, obj.equipment || {});
    d.volumes = Object.assign(defaults().volumes, obj.volumes || {});
    d.records = obj.records || {};
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
