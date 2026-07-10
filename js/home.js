// home.js … モード選択・出撃準備(キャラ/装備/ショップ)・オプション・曲視聴
// DESIGN §1/§11。DOMオーバーレイ+CSSで作る(Canvasには描かない)。
// シーンの表示切替は game.js の applySceneUI() から Home.applyScene(scene) を呼ぶことで行う。
// game.js からシーン遷移を起こす際は Game._gotoXxx() を呼ぶ(HomeからGameの内部状態は直接触らない)。

const Home = (() => {
  const SLOTS = ["head", "body", "feet", "weapon"];
  const SLOT_LABEL = { head: "頭", body: "体", feet: "足", weapon: "武器" };
  const CHAR_ORDER = ["rat", "sword", "gun"];

  let el = {};
  let shopSlot = "head";          // ショップの現在タブ
  let pendingCharUnlock = null;   // 解放確認中のキャラid
  let equipPickerSlot = "head";
  let equipPickerIndex = 0;
  let readyMsgTimer = null;

  // 曲視聴用に独自デコードしたAudioBuffer(Conductor内部のバッファとは別に持つ)
  let jukeboxBuffers = {};
  let jukeboxSource = null;
  let jukeboxPlayingId = null;

  // ホームBGM(仮組み)。専用曲が無いので選択中の曲を小さめの音量でループ再生する(DESIGN仮組み・改修バッチ)。
  // モード選択/出撃準備/オプションでのみ再生。曲はConductor.loadSongのキャッシュ(songBuffer)を使う。
  let homeBgmSource = null;
  let homeBgmSongId = null;   // 現在再生中の曲id(切替検出用)
  let homeBgmToken = 0;       // シーン遷移・曲切替でロード待ちのplay()を無効化するためのガード

  // 出撃準備の曲選択:読み込み中は「いざ!」を無効化する(改修バッチ・Step9)。
  // songLoadTokenは選択が連続で切り替わった時に古いloadSongの完了を無視するためのガード。
  let songLoadToken = 0;

  function $(id) { return document.getElementById(id); }

  function init() {
    el.screens = document.querySelectorAll(".home-screen");

    el.btnModeGame = $("btn-mode-game");
    el.btnModeOptions = $("btn-mode-options");
    el.btnModeJukebox = $("btn-mode-jukebox");

    el.btnReadyBack = $("btn-ready-back");
    el.readyCoinCount = $("ready-coin-count");
    el.readyMessage = $("ready-message");
    el.chapterTabs = $("chapter-tabs");
    el.stageButtons = $("stage-buttons");
    el.charSlots = $("char-slots");
    el.equipSlots = $("equip-slots");
    el.btnOpenShop = $("btn-open-shop");
    el.btnLaunch = $("btn-launch");

    el.equipPickerTitle = $("equip-picker-title");
    el.equipPickerList = $("equip-picker-list");
    el.btnEquipPickerClose = $("btn-equip-picker-close");

    el.btnShopClose = $("btn-shop-close");
    el.shopCoinCount = $("shop-coin-count");
    el.shopTabs = document.querySelectorAll(".shop-tab");
    el.shopList = $("shop-list");

    el.charConfirmText = $("char-confirm-text");
    el.btnCharConfirmYes = $("btn-char-confirm-yes");
    el.btnCharConfirmNo = $("btn-char-confirm-no");

    el.btnOptionsBack = $("btn-options-back");
    el.volBgm = $("vol-bgm");
    el.volSe = $("vol-se");
    el.btnSaveReset = $("btn-save-reset");
    el.btnResetYes = $("btn-reset-yes");
    el.btnResetNo = $("btn-reset-no");

    el.btnJukeboxBack = $("btn-jukebox-back");
    el.jukeboxList = $("jukebox-list");

    el.songSlots = $("song-slots");

    wire();
  }

  // タップの共通ハンドリング。kindでボタンの種類ごとにSFXを鳴らし分ける(改修バッチ・Step9)。
  // kind省略時は"select"扱い(後方互換)。kindを関数で渡すと、タップ時点の状態で音を出し分けられる。
  //
  // 【重要】pointerdown即時実行ではなく「ほぼ動かさずにpointerupしたときだけ実行」する。
  // リスト(ショップ・装備ピッカー)がスクロール可能になったため、行の上でスクロールの
  // ドラッグを始めた瞬間に購入・装備が誤発動するのを防ぐ。TAP_SLOP_PXを超える移動や
  // ブラウザのスクロール開始(pointercancel)でタップはキャンセルされる。
  const TAP_SLOP_PX = 12;
  function tap(elm, fn, kind) {
    if (!elm) return;
    let pid = null, px = 0, py = 0;
    elm.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pid = e.pointerId; px = e.clientX; py = e.clientY;
    }, { passive: false });
    elm.addEventListener("pointermove", (e) => {
      if (pid !== e.pointerId) return;
      if (Math.abs(e.clientX - px) > TAP_SLOP_PX || Math.abs(e.clientY - py) > TAP_SLOP_PX) {
        pid = null; // ドラッグ(スクロール操作)とみなしてキャンセル
      }
    });
    elm.addEventListener("pointerup", (e) => {
      if (pid !== e.pointerId) return;
      pid = null;
      if (typeof SFX !== "undefined" && SFX.ui) {
        SFX.ui(typeof kind === "function" ? kind() : kind);
      }
      fn(e);
    });
    elm.addEventListener("pointercancel", () => { pid = null; });
  }

  function wire() {
    tap(el.btnModeGame, () => Game._gotoReady(), "confirm");
    tap(el.btnModeOptions, () => Game._gotoOptions(), "confirm");
    tap(el.btnModeJukebox, () => Game._gotoJukebox(), "confirm");

    tap(el.btnReadyBack, () => Game._gotoModeSelect(), "back");
    tap(el.btnOpenShop, () => openShop());
    tap(el.btnLaunch, () => { if (!el.btnLaunch.disabled) Game._gotoStage(); }, "launch");

    tap(el.btnEquipPickerClose, () => closeModal("screen-equip-picker"), "back");
    tap(el.btnShopClose, () => closeModal("screen-shop"), "back");

    tap(el.btnCharConfirmYes, () => confirmCharUnlock(), "confirm");
    tap(el.btnCharConfirmNo, () => closeModal("screen-char-confirm"), "back");

    tap(el.btnOptionsBack, () => Game._gotoModeSelect(), "back");
    tap(el.btnSaveReset, () => showModal("screen-reset-confirm"));
    tap(el.btnResetYes, () => doResetSave(), "confirm");
    tap(el.btnResetNo, () => closeModal("screen-reset-confirm"), "back");

    tap(el.btnJukeboxBack, () => { stopJukebox(); Game._gotoModeSelect(); }, "back");

    if (el.volBgm) {
      el.volBgm.addEventListener("input", () => {
        const v = (parseInt(el.volBgm.value, 10) || 0) / 100;
        SAVE.data.volumes.bgm = v;
        SAVE.save();
        SFX.setVolume(v, undefined);
      });
    }
    if (el.volSe) {
      el.volSe.addEventListener("input", () => {
        const v = (parseInt(el.volSe.value, 10) || 0) / 100;
        SAVE.data.volumes.se = v;
        SAVE.save();
        SFX.setVolume(undefined, v);
      });
    }

    el.shopTabs.forEach((btn) => {
      tap(btn, () => { shopSlot = btn.getAttribute("data-slot"); renderShop(); });
    });
  }

  // --- シーン表示切替(game.js の applySceneUI() から呼ばれる) ---
  function hideAll() {
    el.screens.forEach((s) => s.classList.add("hidden"));
    // 曲視聴シーンから離れる時は再生を止める
    if (typeof Game !== "undefined" && Game.scene !== "jukebox") stopJukebox();
  }

  function applyScene(scene) {
    hideAll();
    if (scene === "modeselect") showModeSelect();
    else if (scene === "ready") showReady();
    else if (scene === "options") showOptions();
    else if (scene === "jukebox") showJukebox();
    // ホームBGM(仮組み):モード選択/出撃準備/オプションでのみ再生。
    // それ以外(ステージ・較正・曲視聴・リザルト等)へ抜けたら止める。
    if (scene === "modeselect" || scene === "ready" || scene === "options") startHomeBgm();
    else stopHomeBgm();
  }

  function show(id) { const e = $(id); if (e) e.classList.remove("hidden"); }
  function showModal(id) { show(id); }
  function closeModal(id) { const e = $(id); if (e) e.classList.add("hidden"); }

  function showModeSelect() { show("screen-modeselect"); }

  function showReady() {
    show("screen-ready");
    renderReady();
    ensureSelectedSongLoaded();
  }

  function showOptions() {
    show("screen-options");
    if (el.volBgm) el.volBgm.value = String(Math.round(SAVE.data.volumes.bgm * 100));
    if (el.volSe) el.volSe.value = String(Math.round(SAVE.data.volumes.se * 100));
  }

  function showJukebox() {
    show("screen-jukebox");
    renderJukebox();
  }

  // --- 出撃準備 ---
  function renderReady() {
    if (el.readyCoinCount) el.readyCoinCount.textContent = String(SAVE.data.coins);
    renderStageSelect();
    renderCharSlots();
    renderEquipSlots();
    renderSongSlots();
  }

  // --- 曲選択(出撃準備。DESIGN §1・改修バッチ) ---
  // 選択中の曲id(不正・未設定ならsong01にフォールバック)
  function selectedSongId() {
    const songs = (typeof SONGS !== "undefined") ? SONGS : [];
    const sid = SAVE.data.selectedSong || "song01";
    if (songs.some((s) => s.id === sid)) return sid;
    return songs.length ? songs[0].id : sid;
  }

  function renderSongSlots() {
    if (!el.songSlots) return;
    el.songSlots.innerHTML = "";
    const songs = (typeof SONGS !== "undefined") ? SONGS : [];
    const curId = selectedSongId();
    for (const song of songs) {
      const div = document.createElement("div");
      const selected = song.id === curId;
      div.className = "song-slot" + (selected ? " selected" : "");
      div.innerHTML =
        `<div class="song-name">${song.title}</div>` +
        `<div class="song-bpm">BPM ${song.bpm}</div>`;
      tap(div, () => onTapSong(song));
      el.songSlots.appendChild(div);
    }
  }

  function onTapSong(song) {
    if (SAVE.data.selectedSong === song.id) return;
    SAVE.data.selectedSong = song.id;
    SAVE.save();
    renderSongSlots();
    ensureSelectedSongLoaded();
    // 選択曲を切り替えたら、ホームBGMも新しい曲で流し直す(仮組み)。
    startHomeBgm();
  }

  // --- ホームBGM(仮組み。DESIGN仮組み・改修バッチ) ---
  // 選択中の曲(未選択ならSONGS[0])を CONFIG.HOME_BGM.GAIN の音量でループ再生する。
  function homeBgmSongOrDefault() {
    const songs = (typeof SONGS !== "undefined") ? SONGS : [];
    if (!songs.length) return null;
    const sid = SAVE.data.selectedSong || "song01";
    return songs.find((s) => s.id === sid) || songs[0];
  }

  function startHomeBgm() {
    const song = homeBgmSongOrDefault();
    if (!song || typeof Conductor === "undefined" || !Conductor.loadSong) return;
    if (homeBgmSource && homeBgmSongId === song.id) return; // 既に同じ曲を再生中
    stopHomeBgm();
    const myToken = ++homeBgmToken;
    const play = () => {
      if (myToken !== homeBgmToken) return; // 曲切替・シーン遷移で無効化された古い再生要求
      const buf = Conductor.songBuffer;
      if (!buf) return;
      homeBgmSource = SFX.playBuffer(buf, SFX.ctx.currentTime, { loop: true, gain: CONFIG.HOME_BGM.GAIN });
      homeBgmSongId = song.id;
    };
    // Conductor.loadSongは曲idごとにキャッシュされるため、ロード済みなら即resolveする(改修バッチ)。
    if (Conductor.currentSong && Conductor.currentSong.id === song.id && Conductor.songLoaded) play();
    else Conductor.loadSong(song).then(play);
  }

  // ホームBGMを停止(ステージ開始/曲視聴/較正シーンへ移る際に呼ぶ)。ロード待ち中の再生予約も無効化する。
  function stopHomeBgm() {
    homeBgmToken++;
    if (homeBgmSource) {
      try { homeBgmSource.stop(); } catch (e) { /* 既に停止済み */ }
      homeBgmSource = null;
    }
    homeBgmSongId = null;
  }

  // 選択中の曲をConductorへ先行ロードする。ロード完了まで「いざ!」を無効化する。
  // Conductor側で曲バッファはid単位にキャッシュされるため、選択済みの曲へ戻ってきた場合は即時完了する。
  function ensureSelectedSongLoaded() {
    const songs = (typeof SONGS !== "undefined") ? SONGS : [];
    if (!songs.length) { setLaunchLoading(false); return; }
    const sid = selectedSongId();
    const song = songs.find((s) => s.id === sid) || songs[0];
    if (typeof Conductor === "undefined" || !Conductor.loadSong) { setLaunchLoading(false); return; }
    if (Conductor.currentSong && Conductor.currentSong.id === song.id && Conductor.songLoaded) {
      setLaunchLoading(false);
      return;
    }
    const myToken = ++songLoadToken;
    setLaunchLoading(true);
    Conductor.loadSong(song).then(() => {
      if (myToken !== songLoadToken) return; // 選択が変わった後の古い結果は無視
      setLaunchLoading(false);
    });
  }

  // 「いざ!」の読み込み中表示の切り替え
  function setLaunchLoading(loading) {
    if (!el.btnLaunch) return;
    el.btnLaunch.disabled = loading;
    el.btnLaunch.textContent = loading ? "読み込み中…" : "いざ!";
  }

  // --- 章・ステージ選択(DESIGN §10・Step8) ---
  // unlockedChapter … 解放済みの最新章。これ未満の章は全ステージクリア済み(全解放)。
  // unlockedStage   … unlockedChapter 内で解放済みの最新ステージ(=次に挑めるステージ)。
  function progress() { return SAVE.data.progress; }
  function sel() {
    return (typeof Game !== "undefined" && Game._getStageSel) ? Game._getStageSel() : { chapter: 1, stage: 1 };
  }
  // 章 c(1始まり)内で選択可能な最大ステージ。
  function selectableMax(c) {
    const pr = progress();
    if (c < pr.unlockedChapter) return 5;         // クリア済みの章は全解放
    if (c === pr.unlockedChapter) return pr.unlockedStage;
    return 0;                                     // 未解放の章
  }
  // 章 c・ステージ s がクリア済みか。
  function isCleared(c, s) {
    const pr = progress();
    if (c < pr.unlockedChapter) return true;      // 過去章は全クリア
    if (c === pr.unlockedChapter) {
      if (s < pr.unlockedStage) return true;
      if (s === 5) return !!pr.clearedBoss[c - 1];
    }
    return false;
  }

  function renderStageSelect() {
    renderChapterTabs();
    renderStageButtons();
  }

  function renderChapterTabs() {
    if (!el.chapterTabs) return;
    el.chapterTabs.innerHTML = "";
    const pr = progress();
    const cur = sel().chapter;
    for (let c = 1; c <= 3; c++) {
      const unlocked = c <= pr.unlockedChapter;
      const div = document.createElement("div");
      div.className = "chapter-tab" + (c === cur ? " active" : "") + (unlocked ? "" : " locked");
      const name = CONFIG.CHAPTERS[c - 1] ? CONFIG.CHAPTERS[c - 1].name : ("第" + c + "章");
      div.textContent = unlocked ? (c + "章 " + name) : ("🔒 " + c + "章");
      if (unlocked) tap(div, () => onTapChapter(c));
      else tap(div, () => {}, "error"); // ロック中の章タップ:ブブー音のみ
      el.chapterTabs.appendChild(div);
    }
  }

  function onTapChapter(c) {
    const s = sel();
    if (s.chapter === c) return;
    // 章切替時はステージ1を選択(解放済みなら)
    if (typeof Game !== "undefined" && Game._setStageSel) Game._setStageSel(c, 1);
    renderStageSelect();
  }

  function renderStageButtons() {
    if (!el.stageButtons) return;
    el.stageButtons.innerHTML = "";
    const s = sel();
    const c = s.chapter;
    const maxSel = selectableMax(c);
    for (let st = 1; st <= 5; st++) {
      const selectable = st <= maxSel;
      const cleared = isCleared(c, st);
      const isBoss = st === 5;
      const div = document.createElement("div");
      div.className = "stage-btn"
        + (st === s.stage ? " selected" : "")
        + (selectable ? "" : " locked")
        + (isBoss ? " boss" : "");
      let label;
      if (!selectable) label = "🔒";
      else if (isBoss) label = cleared ? "BOSS ✓" : "BOSS";
      else label = cleared ? (st + " ✓") : String(st);
      div.textContent = label;
      if (selectable) tap(div, () => onTapStage(c, st));
      else tap(div, () => {}, "error"); // ロック中のステージタップ:ブブー音のみ
      el.stageButtons.appendChild(div);
    }
  }

  function onTapStage(c, st) {
    if (typeof Game !== "undefined" && Game._setStageSel) Game._setStageSel(c, st);
    renderStageButtons();
  }

  function renderCharSlots() {
    if (!el.charSlots) return;
    el.charSlots.innerHTML = "";
    const curChar = (typeof Game !== "undefined" && Game._getChar) ? Game._getChar() : "rat";
    for (const id of CHAR_ORDER) {
      const def = CONFIG.CHARACTERS[id];
      const unlocked = SAVE.data.unlockedChars.includes(id);
      const div = document.createElement("div");
      div.className = "char-slot" + (unlocked ? "" : " locked") + (unlocked && curChar === id ? " selected" : "");
      if (unlocked) {
        div.innerHTML =
          `<div class="char-swatch" style="background:${def.color}"></div>` +
          `<div class="char-name">${def.name}</div>`;
      } else {
        div.innerHTML =
          `<div class="char-swatch silhouette"></div>` +
          `<div class="char-name">???</div>` +
          `<div class="char-price">💰${def.price}</div>`;
      }
      tap(div, () => onTapChar(id, unlocked, def), () => (!unlocked && SAVE.data.coins < def.price) ? "error" : "select");
      el.charSlots.appendChild(div);
    }
  }

  function onTapChar(id, unlocked, def) {
    if (unlocked) {
      if (typeof Game !== "undefined" && Game._setChar) Game._setChar(id);
      renderCharSlots();
      return;
    }
    if (SAVE.data.coins < def.price) {
      flashReadyMessage(`コインが足りません(必要 💰${def.price})`);
      return;
    }
    pendingCharUnlock = id;
    if (el.charConfirmText) el.charConfirmText.textContent = `${def.name}を💰${def.price}で解放しますか?`;
    showModal("screen-char-confirm");
  }

  function confirmCharUnlock() {
    const id = pendingCharUnlock;
    closeModal("screen-char-confirm");
    if (!id) return;
    const def = CONFIG.CHARACTERS[id];
    if (SAVE.data.coins < def.price) return; // 念のための二重チェック
    SAVE.data.coins -= def.price;
    SAVE.data.unlockedChars.push(id);
    SAVE.save();
    if (typeof Game !== "undefined" && Game._setChar) Game._setChar(id);
    pendingCharUnlock = null;
    renderReady();
  }

  function flashReadyMessage(text) {
    if (!el.readyMessage) return;
    el.readyMessage.textContent = text;
    el.readyMessage.classList.remove("hidden");
    if (readyMsgTimer) clearTimeout(readyMsgTimer);
    readyMsgTimer = setTimeout(() => el.readyMessage.classList.add("hidden"), 2200);
  }

  function ensureEquipArrays() {
    if (!SAVE.data.equipment) SAVE.data.equipment = {};
    if (!SAVE.data.equipSlots) SAVE.data.equipSlots = {};
    const initial = (CONFIG.EQUIP_SLOTS && CONFIG.EQUIP_SLOTS.INITIAL) || 1;
    const max = (CONFIG.EQUIP_SLOTS && CONFIG.EQUIP_SLOTS.MAX) || 3;
    for (const slot of SLOTS) {
      const raw = SAVE.data.equipment[slot];
      const arr = Array.isArray(raw) ? raw.slice() : (raw ? [raw] : []);
      const limit = Math.max(initial, Math.min(max, Math.floor(SAVE.data.equipSlots[slot] || initial)));
      SAVE.data.equipSlots[slot] = limit;
      SAVE.data.equipment[slot] = arr.filter((id, i, a) => typeof id === "string" && a.indexOf(id) === i).slice(0, limit);
    }
  }

  function renderEquipSlots() {
    if (!el.equipSlots) return;
    ensureEquipArrays();
    el.equipSlots.innerHTML = "";
    for (const slot of SLOTS) {
      const limit = Equip.slotLimit(slot);
      const ids = Equip.equippedIds(slot, SAVE.data.equipment);
      const div = document.createElement("div");
      div.className = "equip-slot";
      const chips = [];
      for (let i = 0; i < limit; i++) {
        const item = ids[i] ? Equip.findItem(ids[i]) : null;
        chips.push(`<button class="equip-mini" data-idx="${i}">${item ? item.icon : "➕"}<span>${i + 1}</span></button>`);
      }
      const locked = [];
      const max = (CONFIG.EQUIP_SLOTS && CONFIG.EQUIP_SLOTS.MAX) || 3;
      for (let i = limit; i < max; i++) locked.push(`<button class="equip-mini locked" data-idx="${i}">🔒<span>${i + 1}</span></button>`);
      div.innerHTML =
        `<div class="equip-label">${SLOT_LABEL[slot]} <small>${ids.length}/${limit}</small></div>` +
        `<div class="equip-mini-row">${chips.join("")}${locked.join("")}</div>`;
      div.querySelectorAll(".equip-mini").forEach((btn) => {
        const idx = parseInt(btn.getAttribute("data-idx"), 10) || 0;
        if (idx < limit) tap(btn, () => openEquipPicker(slot, idx));
        else tap(btn, () => { shopSlot = slot; openShop(); flashReadyMessage(`${SLOT_LABEL[slot]}の装備枠はショップで解放できます`); }, "error");
      });
      el.equipSlots.appendChild(div);
    }
  }

  function openEquipPicker(slot, index) {
    ensureEquipArrays();
    equipPickerSlot = slot;
    equipPickerIndex = index || 0;
    if (el.equipPickerTitle) el.equipPickerTitle.textContent = `${SLOT_LABEL[slot]}装備 ${equipPickerIndex + 1}枠目`;
    renderEquipPicker(slot, equipPickerIndex);
    showModal("screen-equip-picker");
  }

  function setEquipmentAt(slot, index, id) {
    ensureEquipArrays();
    const limit = Equip.slotLimit(slot);
    const arr = SAVE.data.equipment[slot].slice(0, limit);
    if (id) {
      for (let i = 0; i < arr.length; i++) if (arr[i] === id) arr[i] = null; // 同一装備の重複装着は禁止
      arr[index] = id;
    } else {
      arr[index] = null;
    }
    SAVE.data.equipment[slot] = arr.filter(Boolean).slice(0, limit);
    SAVE.save();
    Equip.refresh();
  }

  function renderEquipPicker(slot, index) {
    if (!el.equipPickerList) return;
    ensureEquipArrays();
    el.equipPickerList.innerHTML = "";
    const ids = Equip.equippedIds(slot, SAVE.data.equipment);
    const currentId = ids[index] || null;

    // 「なし」(この枠だけ外す)
    const noneRow = document.createElement("div");
    noneRow.className = "item-row" + (!currentId ? " equipped" : "");
    noneRow.innerHTML =
      `<div class="item-icon">➖</div>` +
      `<div class="item-info"><div class="item-name">この枠は空き${!currentId ? "(選択中)" : ""}</div></div>`;
    tap(noneRow, () => {
      setEquipmentAt(slot, index, null);
      closeModal("screen-equip-picker");
      renderReady();
    }, "confirm");
    el.equipPickerList.appendChild(noneRow);

    // 所持している当該部位の装備
    const owned = (CONFIG.EQUIPMENT[slot] || []).filter((it) => SAVE.data.ownedEquip.includes(it.id));
    for (const item of owned) {
      const equippedIndex = ids.indexOf(item.id);
      const equipped = equippedIndex >= 0;
      const row = document.createElement("div");
      row.className = "item-row" + (currentId === item.id ? " equipped" : "");
      const tag = currentId === item.id ? "(この枠に装備中)" : (equipped ? `(${equippedIndex + 1}枠目から移動)` : "");
      row.innerHTML =
        `<div class="item-icon">${item.icon}</div>` +
        `<div class="item-info"><div class="item-name">${item.name}${tag}</div>` +
        `<div class="item-desc">${item.desc}</div></div>`;
      tap(row, () => {
        setEquipmentAt(slot, index, item.id);
        closeModal("screen-equip-picker");
        renderReady();
      }, "confirm");
      el.equipPickerList.appendChild(row);
    }

    // 未所持はショップへ誘導
    const hint = document.createElement("div");
    hint.className = "item-hint";
    hint.textContent = "未所持の装備と追加枠はショップで購入できます";
    el.equipPickerList.appendChild(hint);
    const toShop = document.createElement("button");
    toShop.className = "home-btn small";
    toShop.textContent = "ショップへ";
    tap(toShop, () => { closeModal("screen-equip-picker"); shopSlot = slot; openShop(); });
    el.equipPickerList.appendChild(toShop);
  }

  // --- ショップ ---
  function openShop() {
    showModal("screen-shop");
    renderShop();
  }

  function renderShop() {
    if (el.shopCoinCount) el.shopCoinCount.textContent = String(SAVE.data.coins);
    el.shopTabs.forEach((btn) => {
      const slot = btn.getAttribute("data-slot");
      // タブに所持数を表記(例: 頭(3/10)。Step9)
      const items = CONFIG.EQUIPMENT[slot] || [];
      const ownedCount = items.filter((it) => SAVE.data.ownedEquip.includes(it.id)).length;
      btn.textContent = `${SLOT_LABEL[slot]}(${ownedCount}/${items.length})`;
      btn.classList.toggle("active", slot === shopSlot);
    });
    if (!el.shopList) return;
    el.shopList.innerHTML = "";
    renderSlotUnlockRow();
    const items = CONFIG.EQUIPMENT[shopSlot] || [];
    for (const item of items) {
      const owned = SAVE.data.ownedEquip.includes(item.id);
      const row = document.createElement("div");
      row.className = "item-row";
      const rightHtml = owned
        ? `<div class="item-owned">所持</div>`
        : `<button class="buy-btn"${SAVE.data.coins < item.price ? " disabled" : ""}>💰${item.price}</button>`;
      row.innerHTML =
        `<div class="item-icon">${item.icon}</div>` +
        `<div class="item-info"><div class="item-name">${item.name}</div><div class="item-desc">${item.desc}</div></div>` +
        rightHtml;
      if (!owned) {
        const buyBtn = row.querySelector(".buy-btn");
        tap(buyBtn, () => { if (!buyBtn.disabled) buyItem(item); }, () => buyBtn.disabled ? "error" : "buy");
      }
      el.shopList.appendChild(row);
    }
  }

  function renderSlotUnlockRow() {
    ensureEquipArrays();
    const limit = Equip.slotLimit(shopSlot);
    const max = (CONFIG.EQUIP_SLOTS && CONFIG.EQUIP_SLOTS.MAX) || 3;
    const row = document.createElement("div");
    row.className = "item-row slot-unlock-row";
    if (limit >= max) {
      row.innerHTML =
        `<div class="item-icon">✅</div>` +
        `<div class="item-info"><div class="item-name">${SLOT_LABEL[shopSlot]}の装備枠</div>` +
        `<div class="item-desc">最大${max}枠まで解放済み</div></div>` +
        `<div class="item-owned">解放済</div>`;
    } else {
      const next = limit + 1;
      const prices = (CONFIG.EQUIP_SLOTS && CONFIG.EQUIP_SLOTS.UNLOCK_PRICES) || [0, 800, 1800];
      const price = prices[next - 1] || 0;
      row.innerHTML =
        `<div class="item-icon">🔓</div>` +
        `<div class="item-info"><div class="item-name">${SLOT_LABEL[shopSlot]}の${next}枠目を解放</div>` +
        `<div class="item-desc">この部位に同時装備できる数が${next}個になります</div></div>` +
        `<button class="buy-btn"${SAVE.data.coins < price ? " disabled" : ""}>💰${price}</button>`;
      const buyBtn = row.querySelector(".buy-btn");
      tap(buyBtn, () => { if (!buyBtn.disabled) unlockEquipSlot(shopSlot, price); }, () => buyBtn.disabled ? "error" : "buy");
    }
    el.shopList.appendChild(row);
  }

  function unlockEquipSlot(slot, price) {
    ensureEquipArrays();
    const max = (CONFIG.EQUIP_SLOTS && CONFIG.EQUIP_SLOTS.MAX) || 3;
    const cur = Equip.slotLimit(slot);
    if (cur >= max || SAVE.data.coins < price) return;
    SAVE.data.coins -= price;
    SAVE.data.equipSlots[slot] = cur + 1;
    SAVE.save();
    Equip.refresh();
    renderShop();
    renderReady();
  }

  function buyItem(item) {
    if (SAVE.data.ownedEquip.includes(item.id)) return;
    if (SAVE.data.coins < item.price) return;
    SAVE.data.coins -= item.price;
    SAVE.data.ownedEquip.push(item.id);
    SAVE.save();
    Equip.refresh();
    renderShop();
    renderReady(); // 出撃準備側のコイン表示も同期
  }

  // --- オプション ---
  function doResetSave() {
    closeModal("screen-reset-confirm");
    SAVE.reset();
    if (typeof Equip !== "undefined") Equip.refresh();
    Conductor.previewCalibration(SAVE.data.calibrationMs);
    SFX.setVolume(SAVE.data.volumes.bgm, SAVE.data.volumes.se);
    // 較正パネルのスライダー表示(game.js管轄のDOM)も初期値に同期
    const cs = $("calib-slider"), cv = $("calib-value");
    if (cs) cs.value = "0";
    if (cv) cv.textContent = "0ms";
    showOptions();
  }

  // --- 曲視聴(ジュークボックス) ---
  function renderJukebox() {
    if (!el.jukeboxList) return;
    el.jukeboxList.innerHTML = "";
    const songs = (typeof SONGS !== "undefined") ? SONGS : [];
    for (const song of songs) {
      const row = document.createElement("div");
      const playing = jukeboxPlayingId === song.id;
      row.className = "item-row" + (playing ? " equipped" : "");
      row.innerHTML =
        `<div class="item-icon">${playing ? "⏸" : "▶"}</div>` +
        `<div class="item-info"><div class="item-name">${song.title}</div></div>`;
      tap(row, () => toggleJukebox(song));
      el.jukeboxList.appendChild(row);
    }
  }

  function toggleJukebox(song) {
    if (jukeboxPlayingId === song.id) {
      stopJukebox();
      return;
    }
    stopJukebox();
    stopHomeBgm(); // 曲視聴とホームBGMが被らないよう止める
    jukeboxPlayingId = song.id;
    renderJukebox();
    loadJukeboxBuffer(song).then((buffer) => {
      if (!buffer || jukeboxPlayingId !== song.id) return;
      jukeboxSource = SFX.playBuffer(buffer, SFX.ctx.currentTime, { loop: false });
      jukeboxSource.onended = () => {
        if (jukeboxPlayingId === song.id) { jukeboxPlayingId = null; renderJukebox(); }
      };
    });
  }

  function stopJukebox() {
    if (jukeboxSource) {
      try { jukeboxSource.onended = null; jukeboxSource.stop(); } catch (e) { /* 既に停止済み */ }
      jukeboxSource = null;
    }
    if (jukeboxPlayingId !== null) {
      jukeboxPlayingId = null;
      renderJukebox();
    }
  }

  // 曲視聴専用にAudioBufferをデコード(Conductor内部のバッファとは独立にキャッシュ)
  function loadJukeboxBuffer(song) {
    if (jukeboxBuffers[song.id]) return Promise.resolve(jukeboxBuffers[song.id]);
    return fetch(song.audio)
      .then((res) => res.arrayBuffer())
      .then((arr) => SFX.ctx.decodeAudioData(arr))
      // trimSec指定曲は先頭を切り落とす(ステージ側と同じ聴こえ方にする)
      .then((buf) => { const t = song.trimSec ? SFX.trimBuffer(buf, song.trimSec) : buf; jukeboxBuffers[song.id] = t; return t; })
      .catch((e) => { console.warn("曲視聴の読み込み失敗:", e); return null; });
  }

  return { init, applyScene, stopHomeBgm, stopJukebox };
})();
