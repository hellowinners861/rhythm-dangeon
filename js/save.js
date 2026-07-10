// save.js … localStorage セーブ/ロード(バージョン管理)
// キー rhythm-dungeon-save に3スロット分のセーブを保存する。
// v4以前の単一セーブは、これまでのテストプレイ進捗としてセーブデータ2へ移行する。

const SAVE = (() => {
  const KEY = "rhythm-dungeon-save";
  const VERSION = 6;
  const SLOT_COUNT = 3;

  // 章進行の初期値(DESIGN §10・Step8)。
  function defaultProgress() {
    return {
      unlockedChapter: 1,
      unlockedStage: 1,
      clearedBoss: [false, false, false],
      seenOpening: false,
      seenChapterIntro: [false, false, false],
      endlessUnlocked: false,
      seenEndlessUnlock: false,
    };
  }

  function defaults() {
    return {
      version: VERSION,
      calibrationMs: 0,
      coins: 0,
      unlockedChars: ["rat"],
      ownedEquip: [],
      equipment: { head: [], body: [], feet: [], weapon: [] },
      equipSlots: { head: 1, body: 1, feet: 1, weapon: 1 },
      volumes: { bgm: 0.8, se: 0.8 },
      records: {},
      progress: defaultProgress(),
      selectedSong: "song01",
    };
  }

  let activeSlot = 2;
  let slots = [null, null, null];
  let data = defaults();

  function cloneSave(src) { return JSON.parse(JSON.stringify(src || defaults())); }
  function isEnvelope(obj) { return obj && typeof obj === "object" && Array.isArray(obj.slots); }
  function makeEnvelope() {
    return {
      version: VERSION,
      activeSlot,
      slots: Array.from({ length: SLOT_COUNT }, (_, i) => slots[i] ? cloneSave(slots[i]) : null),
    };
  }

  // 進行データを既定値で補完(欠損・不正な配列長を安全化する)。
  function fixProgress(p) {
    const d = defaultProgress();
    if (!p || typeof p !== "object") return d;
    if (typeof p.unlockedChapter === "number") d.unlockedChapter = Math.max(1, Math.min(3, p.unlockedChapter));
    if (typeof p.unlockedStage === "number") d.unlockedStage = Math.max(1, Math.min(5, p.unlockedStage));
    if (Array.isArray(p.clearedBoss)) for (let i = 0; i < 3; i++) d.clearedBoss[i] = !!p.clearedBoss[i];
    d.seenOpening = !!p.seenOpening;
    if (Array.isArray(p.seenChapterIntro)) for (let i = 0; i < 3; i++) d.seenChapterIntro[i] = !!p.seenChapterIntro[i];
    d.endlessUnlocked = !!p.endlessUnlocked || !!d.clearedBoss[2];
    d.seenEndlessUnlock = !!p.seenEndlessUnlock;
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

  function normalizeEquipment(src, equipSlots) {
    const d = { head: [], body: [], feet: [], weapon: [] };
    const max = (typeof CONFIG !== "undefined" && CONFIG.EQUIP_SLOTS) ? CONFIG.EQUIP_SLOTS.MAX : 3;
    for (const slot of Object.keys(d)) {
      const raw = src && src[slot];
      const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      const seen = new Set();
      const limit = Math.max(1, Math.min(max, equipSlots && equipSlots[slot] ? equipSlots[slot] : max));
      for (const id of arr) {
        if (typeof id !== "string" || seen.has(id)) continue;
        seen.add(id);
        d[slot].push(id);
        if (d[slot].length >= limit) break;
      }
    }
    return d;
  }

  // 旧バージョンからの移行。v1(calibrationMsのみ)/v2(コイン・装備等)/v3-v4(章進行)から引き継ぐ。
  function migrate(obj) {
    if (!obj || typeof obj !== "object") return defaults();
    const d = Object.assign(defaults(), obj.version === VERSION ? obj : {});
    if (obj.version !== VERSION) {
      if (typeof obj.calibrationMs === "number") d.calibrationMs = obj.calibrationMs;
      if (obj.version === 2 || obj.version === 3 || obj.version === 4) {
        if (typeof obj.coins === "number") d.coins = obj.coins;
        if (Array.isArray(obj.unlockedChars)) d.unlockedChars = obj.unlockedChars.slice();
        if (Array.isArray(obj.ownedEquip)) d.ownedEquip = obj.ownedEquip.slice();
        d.volumes = Object.assign(defaults().volumes, obj.volumes || {});
        d.records = obj.records || {};
        d.progress = fixProgress(obj.progress);
        if (typeof obj.selectedSong === "string") d.selectedSong = obj.selectedSong;
      }
    }
    d.version = VERSION;
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
        slots = [null, null, null];
        activeSlot = 2;
        data = defaults();
      } else {
        const obj = JSON.parse(raw);
        if (isEnvelope(obj)) {
          activeSlot = Math.max(1, Math.min(SLOT_COUNT, obj.activeSlot | 0 || 1));
          slots = Array.from({ length: SLOT_COUNT }, (_, i) => obj.slots[i] ? migrate(obj.slots[i]) : null);
          data = slots[activeSlot - 1] ? cloneSave(slots[activeSlot - 1]) : defaults();
        } else {
          const old = migrate(obj);
          slots = [null, old, null];
          activeSlot = 2;
          data = cloneSave(old);
          save();
        }
      }
    } catch (e) {
      slots = [null, null, null];
      activeSlot = 2;
      data = defaults();
    }
    return data;
  }

  function save() {
    try {
      slots[activeSlot - 1] = cloneSave(data);
      localStorage.setItem(KEY, JSON.stringify(makeEnvelope()));
    } catch (e) {
      // localStorage不可(プライベートモード等)は黙って無視
    }
    return data;
  }

  // セーブ初期化(オプション画面から呼ばれる)。現在のスロットだけ既定値に戻して即保存する。
  function reset() {
    data = defaults();
    save();
    return data;
  }

  function slotData(slotNo) {
    const i = Math.max(1, Math.min(SLOT_COUNT, slotNo | 0)) - 1;
    return slots[i] ? cloneSave(slots[i]) : null;
  }

  function isSlotEmpty(slotNo) { return !slotData(slotNo); }

  function selectSlot(slotNo) {
    activeSlot = Math.max(1, Math.min(SLOT_COUNT, slotNo | 0));
    data = slots[activeSlot - 1] ? cloneSave(slots[activeSlot - 1]) : defaults();
    save();
    return data;
  }

  function newGameInSlot(slotNo) {
    activeSlot = Math.max(1, Math.min(SLOT_COUNT, slotNo | 0));
    data = defaults();
    save();
    return data;
  }

  return {
    load,
    save,
    reset,
    slotData,
    isSlotEmpty,
    selectSlot,
    newGameInSlot,
    get activeSlot() { return activeSlot; },
    get slotCount() { return SLOT_COUNT; },
    get data() { return data; },
  };
})();
