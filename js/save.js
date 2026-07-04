// save.js … localStorage セーブ/ロード(バージョン管理)
// キー rhythm-dungeon-save に {version, calibrationMs, ...} を保存する。
// 破損・未存在・旧バージョン時はデフォルト値へフォールバックする。

const SAVE = (() => {
  const KEY = "rhythm-dungeon-save";
  const VERSION = 1;

  function defaults() {
    return {
      version: VERSION,
      calibrationMs: 0, // レイテンシ較正値(ms)
      // 今後: coins, unlocked, equipment, progress, volume など
    };
  }

  let data = defaults();

  // 旧バージョンからの移行(雛形)。今はv1のみ。
  function migrate(obj) {
    if (!obj || typeof obj !== "object") return defaults();
    if (obj.version !== VERSION) {
      // バージョン差異時はデフォルトに既知フィールドをマージして作り直す
      const d = defaults();
      if (typeof obj.calibrationMs === "number") d.calibrationMs = obj.calibrationMs;
      return d;
    }
    // 欠損フィールドをデフォルトで補完
    return Object.assign(defaults(), obj);
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

  return {
    load,
    save,
    // 現在のセーブデータ(直接参照可)
    get data() { return data; },
  };
})();
