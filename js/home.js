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
  let readyMsgTimer = null;

  // 曲視聴用に独自デコードしたAudioBuffer(Conductor内部のバッファとは別に持つ)
  let jukeboxBuffers = {};
  let jukeboxSource = null;
  let jukeboxPlayingId = null;

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

    wire();
  }

  // pointerdownを共通ハンドリング(較正パネル等の既存ボタンと同じ流儀)
  function tap(elm, fn) {
    if (!elm) return;
    elm.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      fn(e);
    }, { passive: false });
  }

  function wire() {
    tap(el.btnModeGame, () => Game._gotoReady());
    tap(el.btnModeOptions, () => Game._gotoOptions());
    tap(el.btnModeJukebox, () => Game._gotoJukebox());

    tap(el.btnReadyBack, () => Game._gotoModeSelect());
    tap(el.btnOpenShop, () => openShop());
    tap(el.btnLaunch, () => Game._gotoStage());

    tap(el.btnEquipPickerClose, () => closeModal("screen-equip-picker"));
    tap(el.btnShopClose, () => closeModal("screen-shop"));

    tap(el.btnCharConfirmYes, () => confirmCharUnlock());
    tap(el.btnCharConfirmNo, () => closeModal("screen-char-confirm"));

    tap(el.btnOptionsBack, () => Game._gotoModeSelect());
    tap(el.btnSaveReset, () => showModal("screen-reset-confirm"));
    tap(el.btnResetYes, () => doResetSave());
    tap(el.btnResetNo, () => closeModal("screen-reset-confirm"));

    tap(el.btnJukeboxBack, () => { stopJukebox(); Game._gotoModeSelect(); });

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
  }

  function show(id) { const e = $(id); if (e) e.classList.remove("hidden"); }
  function showModal(id) { show(id); }
  function closeModal(id) { const e = $(id); if (e) e.classList.add("hidden"); }

  function showModeSelect() { show("screen-modeselect"); }

  function showReady() {
    show("screen-ready");
    renderReady();
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
      tap(div, () => onTapChar(id, unlocked, def));
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

  function renderEquipSlots() {
    if (!el.equipSlots) return;
    el.equipSlots.innerHTML = "";
    for (const slot of SLOTS) {
      const id = SAVE.data.equipment[slot];
      const item = id ? Equip.findItem(id) : null;
      const div = document.createElement("div");
      div.className = "equip-slot";
      div.innerHTML = item
        ? `<div class="equip-icon">${item.icon}</div><div class="equip-label">${SLOT_LABEL[slot]}: ${item.name}</div>`
        : `<div class="equip-icon">➖</div><div class="equip-label">${SLOT_LABEL[slot]}: なし</div>`;
      tap(div, () => openEquipPicker(slot));
      el.equipSlots.appendChild(div);
    }
  }

  function openEquipPicker(slot) {
    if (el.equipPickerTitle) el.equipPickerTitle.textContent = `${SLOT_LABEL[slot]}装備`;
    renderEquipPicker(slot);
    showModal("screen-equip-picker");
  }

  function renderEquipPicker(slot) {
    if (!el.equipPickerList) return;
    el.equipPickerList.innerHTML = "";

    // 「なし」(外す)
    const noneRow = document.createElement("div");
    noneRow.className = "item-row" + (!SAVE.data.equipment[slot] ? " equipped" : "");
    noneRow.innerHTML =
      `<div class="item-icon">➖</div>` +
      `<div class="item-info"><div class="item-name">なし${!SAVE.data.equipment[slot] ? "(装備中)" : ""}</div></div>`;
    tap(noneRow, () => {
      SAVE.data.equipment[slot] = null;
      SAVE.save();
      Equip.refresh();
      closeModal("screen-equip-picker");
      renderReady();
    });
    el.equipPickerList.appendChild(noneRow);

    // 所持している当該部位の装備
    const owned = (CONFIG.EQUIPMENT[slot] || []).filter((it) => SAVE.data.ownedEquip.includes(it.id));
    for (const item of owned) {
      const equipped = SAVE.data.equipment[slot] === item.id;
      const row = document.createElement("div");
      row.className = "item-row" + (equipped ? " equipped" : "");
      row.innerHTML =
        `<div class="item-icon">${item.icon}</div>` +
        `<div class="item-info"><div class="item-name">${item.name}${equipped ? "(装備中)" : ""}</div>` +
        `<div class="item-desc">${item.desc}</div></div>`;
      tap(row, () => {
        SAVE.data.equipment[slot] = item.id;
        SAVE.save();
        Equip.refresh();
        closeModal("screen-equip-picker");
        renderReady();
      });
      el.equipPickerList.appendChild(row);
    }

    // 未所持はショップへ誘導
    const hint = document.createElement("div");
    hint.className = "item-hint";
    hint.textContent = "未所持の装備はショップで購入できます";
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
      btn.classList.toggle("active", btn.getAttribute("data-slot") === shopSlot);
    });
    if (!el.shopList) return;
    el.shopList.innerHTML = "";
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
        tap(buyBtn, () => { if (!buyBtn.disabled) buyItem(item); });
      }
      el.shopList.appendChild(row);
    }
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
      .then((buf) => { jukeboxBuffers[song.id] = buf; return buf; })
      .catch((e) => { console.warn("曲視聴の読み込み失敗:", e); return null; });
  }

  return { init, applyScene };
})();
