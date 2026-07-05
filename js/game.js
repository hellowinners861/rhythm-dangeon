// game.js … シーン管理・ゲームループ・カメラ・HUD・リザルト(Step6: 画面フロー・メタ進行)
// シーン: title(タップして開始) → modeselect(モード選択) → ready(出撃準備)/options/jukebox(いずれもDOM表示)
//        → stage(自動生成レベル) → result/gameover(リザルト) → ready へ戻る / calibration(較正・options経由)
// 描画・トゥイーンはrAF、拍・判定は全てConductor経由。
// modeselect/ready/options/jukebox はDOMオーバーレイ(home.js)が主体。Canvasは背景のみ描画する。

const Game = (() => {
  const VW = CONFIG.VIEW.W;
  const VH = CONFIG.VIEW.H;
  const TILE = CONFIG.TILE;
  const DEBUG = /[?&]debug=1\b/.test(location.search);
  // 使用キャラ。?char= はデバッグ用URLパラメータで、出撃準備でのキャラ選択より優先度が高い。
  // 通常は home.js の出撃準備画面での選択(selectedChar)を使う。DESIGN §5/Step6
  const urlChar = (location.search.match(/[?&]char=(rat|sword|gun)/) || [])[1] || null;
  let selectedChar = urlChar || "rat";
  function effectiveChar() { return urlChar || selectedChar; }

  // 章テーマ(DESIGN §10・Step7)。?chapter=1|2|3 でデバッグ切替(0始まりindexへ変換)。
  // 進行システム(章クリアで解放等)はStep8で実装するため、現状はURLでの固定切替のみ。
  const urlChapter = (location.search.match(/[?&]chapter=([123])\b/) || [])[1];
  let currentChapter = urlChapter ? (parseInt(urlChapter, 10) - 1) : 0;
  function chapterTheme() { return CONFIG.CHAPTERS[currentChapter] || CONFIG.CHAPTERS[0]; }

  // 出撃準備での章・ステージ選択(1始まり)。init で進行データから初期化する。DESIGN §10・Step8
  let selChapter = 1;
  let selStage = 1;

  let canvas, g;
  let scene = "title";

  // 統計(現在ステージ)
  let combo = 0;
  let taps = 0;
  let maxCombo = 0;
  let judgeStats = { perfect: 0, good: 0, miss: 0 }; // 判定内訳
  let goalBeat = 0;      // ゴール到達時の経過拍数(所要拍数)

  // ステージ状態
  let level = null;
  let curSeed = 0;       // 現在レベルのseed
  const cam = { x: 0, y: 0 };
  let goalReached = false;
  let missFlash = 0;      // ミス/被弾演出の残り秒
  let songClear = false;  // 曲が終わる前にゴールしたか(リザルトのボーナス表示)
  let restNow = false;    // 現在が休符区間(div=0)か(描画・敵停止に使う)

  // ボスステージ状態(Step8)
  let bossStage = false;         // このステージがボスステージ(章の5面)か
  let bossTriggered = false;     // アリーナ進入でボス戦を開始したか
  let bossDefeatedHandled = false; // 撃破後のクリア処理を済ませたか
  let bossClear = false;         // 直近のリザルトがボスクリアか(表示・ボーナス用)
  let bossClearChapter = 0;      // 撃破したボスの章(1始まり。撃破後ストーリー用)
  let bossRestActive = false;    // ミュートスの強制休符が有効か(入力遮断・レーン暗転)

  // 楽曲ロード状態(タイトルの「読み込み中…」→「タップして開始」切替に使う)
  let songReady = (typeof SONGS === "undefined" || SONGS.length === 0);

  // 戦闘統計・演出
  let enemiesKilled = 0;  // 倒した敵数(リザルト表示)
  let score = 0;          // 内部スコア(撃破加算)
  let prevKills = 0;      // Enemies.kills の前フレーム値
  let prevHurt = 0;       // Player.hurtCount の前フレーム値
  let shakeMag = 0;       // 画面揺れ量(px・減衰)
  let hitstopUntil = 0;   // この時刻(performance.now)まで更新を止める(撃破演出)
  let feverWasActive = false; // フィーバー突入の瞬間検出(雷の笛用)
  let resultCoins = 0;    // リザルト/ゲームオーバーで持ち帰ったコイン(表示用)

  // 較正シーンの状態
  const calib = {
    diffs: [],       // 収集したdiffMs
    avg: null,       // 平均(算出後)
  };

  // デバッグHUD用
  const recentDiffs = []; // 直近の判定diffMs
  let fps = 0;
  let lastFrameT = 0;

  // ストーリー(章間テキスト演出。DOMパネル。DESIGN §10・Step8)
  const story = { pages: [], idx: 0, onDone: null, active: false };

  // DOM参照
  let el = {};

  // ---- 初期化 ----
  function init() {
    canvas = document.getElementById("game");
    g = canvas.getContext("2d");

    el.btnCalib = document.getElementById("btn-calib");
    el.calibPanel = document.getElementById("calib-panel");
    el.calibInfo = document.getElementById("calib-info");
    el.slider = document.getElementById("calib-slider");
    el.sliderVal = document.getElementById("calib-value");
    el.btnSave = document.getElementById("btn-save");
    el.btnRetry = document.getElementById("btn-retry");
    el.btnBack = document.getElementById("btn-back");
    el.controls = document.getElementById("controls");
    el.storyPanel = document.getElementById("story-panel");
    el.storyText = document.getElementById("story-text");

    SAVE.load();
    // 章・ステージ選択の初期値を進行データから復元(最新の解放位置)
    selChapter = SAVE.data.progress.unlockedChapter;
    selStage = SAVE.data.progress.unlockedStage;
    // 保存済み較正値をConductorへ反映
    Conductor.previewCalibration(SAVE.data.calibrationMs);
    // 保存済み音量をSFXへ反映
    SFX.setVolume(SAVE.data.volumes.bgm, SAVE.data.volumes.se);
    // 装備効果を集計(Equip.stats()キャッシュの初期化)
    if (typeof Equip !== "undefined") Equip.refresh();

    // 楽曲を先読みロード(タイトルは「読み込み中…」表示)。失敗時もメトロノームで続行。
    if (typeof SONGS !== "undefined" && SONGS.length > 0) {
      Conductor.loadSong(SONGS[0]).then(() => { songReady = true; });
    }
    el.slider.min = String(-CONFIG.CALIBRATION.MANUAL_RANGE_MS);
    el.slider.max = String(CONFIG.CALIBRATION.MANUAL_RANGE_MS);
    el.slider.value = String(SAVE.data.calibrationMs);
    el.sliderVal.textContent = SAVE.data.calibrationMs + "ms";

    Input.init();
    Input.onAction(onAction);

    // タイトルでのタップ(AudioContext解禁)。result/gameoverのタップは出撃準備へ戻る。
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        if (story.active) return; // ストーリー表示中はゲーム側のタップを無視
        if (scene === "title") startFromTitle();
        else if (scene === "result" || scene === "gameover") onResultTap();
      },
      { passive: false }
    );

    // ストーリーパネル(タップで次ページ、最後で閉じる)
    if (el.storyPanel) {
      el.storyPanel.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        advanceStory();
      }, { passive: false });
    }

    // シーンUIボタン(較正はオプション画面から入る)
    el.btnCalib.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      gotoCalibration();
    });
    el.btnBack.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      gotoOptions();
    });
    el.btnRetry.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      resetCalibCollection();
    });
    el.btnSave.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      saveCalibration();
    });
    // スライダー:変更は即Conductorへ反映(手動調整は即保存)
    el.slider.addEventListener("input", () => {
      const ms = parseInt(el.slider.value, 10) || 0;
      el.sliderVal.textContent = ms + "ms";
      Conductor.setCalibration(ms);
    });

    // モード選択/出撃準備/オプション/曲視聴のDOMオーバーレイ(home.js)
    if (typeof Home !== "undefined") Home.init();

    applySceneUI();
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    requestAnimationFrame(loop);
  }

  // ---- キャンバスサイズ(1600×900論理 + dpr) ----
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 16:9をレターボックスで内接
    let w = vw;
    let h = (vw * VH) / VW;
    if (h > vh) {
      h = vh;
      w = (vh * VW) / VH;
    }
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  // ---- シーン遷移 ----
  // タイトルタップ後はモード選択へ(従来の即ステージ開始をやめる。DESIGN §1)
  function startFromTitle() {
    if (!songReady) return; // 楽曲の読み込み完了前はタップを無視
    SFX.resume().then(() => {
      gotoModeSelect();
    });
  }

  // ステージ用の時計を開始する。楽曲がロード済みなら曲を、失敗時はメトロノームを頭から。
  function startStageConductor() {
    if (Conductor.songLoaded) {
      Conductor.startSong({ startDelay: 1.0 });
    } else {
      Conductor.start({ bpm: CONFIG.METRONOME.BPM, offset: 0, startDelay: 1.0 });
    }
  }

  // カメラのX方向クランプ範囲(レベル端で見切れないように)
  function camMinX() { return VW / (2 * TILE) - 0.5; }
  function camMaxX() { return level.w - VW / (2 * TILE) - 0.5; }
  function clampCamX(cx) {
    const lo = camMinX(), hi = camMaxX();
    if (hi < lo) return (level.w - 1) / 2; // レベルが視界より狭い場合は中央
    return Math.max(lo, Math.min(hi, cx));
  }

  // 新しいレベルを自動生成して状態を初期化。seed省略時は時刻から新規seed。
  function startLevel(seed) {
    curSeed = (seed === undefined) ? (Date.now() >>> 0) : (seed >>> 0);
    // 章を選択から確定(?chapter= はデバッグ用に優先残置)。テーマ・densityMul の参照元。
    currentChapter = urlChapter ? (parseInt(urlChapter, 10) - 1) : (selChapter - 1);
    // 装備効果を最新化(出撃準備での変更を確実に反映)
    if (typeof Equip !== "undefined") Equip.refresh();
    const theme = chapterTheme();
    // このステージがボスステージ(章の5面)か
    bossStage = (selStage === 5);
    bossTriggered = false;
    bossDefeatedHandled = false;
    bossRestActive = false;
    if (typeof Boss !== "undefined") Boss.reset();
    // 曲の総拍数からゴール距離を逆算(未ロード時は較正用の仮値)。DESIGN §4/§10
    const tb = Conductor.totalBeats || CONFIG.STAGE.TEST_BEATS;
    level = LevelGen.generate({ totalBeats: tb, seed: curSeed, boss: bossStage, densityMul: theme.densityMul });
    Player.init(level, effectiveChar());
    // 敵の実体化:抽選・位相は seed 由来の乱数(リトライ再現性)。variantRateは章テーマ由来(色違い抽選)
    Enemies.init(level, LevelGen.rng((curSeed ^ 0x9e3779b9) >>> 0), theme.variantRate);
    // 拾得アイテム(ハート/シールド/ブースト)の種別抽選もseed由来の別系統の乱数を使う
    if (typeof Items !== "undefined") Items.init(level, LevelGen.rng((curSeed ^ 0x517cc1b7) >>> 0));
    const p = Player.pos();
    cam.y = level.h / 2;
    cam.x = clampCamX(p.x);
    goalReached = false;
    combo = 0;
    taps = 0;
    maxCombo = 0;
    judgeStats = { perfect: 0, good: 0, miss: 0 };
    goalBeat = 0;
    missFlash = 0;
    enemiesKilled = 0;
    score = 0;
    prevKills = 0;
    prevHurt = 0;
    shakeMag = 0;
    hitstopUntil = 0;
    songClear = false;
    restNow = false;
    feverWasActive = false;
    resultCoins = 0;
  }

  // 「いざ!」で出撃準備からステージへ。常に新しいレベル・曲を頭から開始する。
  // 章のステージ1を初めて選んだときは章開始ストーリーを挟んでから開始する(章ごと初回)。
  function gotoStage() {
    const ci = selChapter - 1;
    const intro = STORY.chapterIntro[ci];
    if (selStage === 1 && intro && !SAVE.data.progress.seenChapterIntro[ci]) {
      SAVE.data.progress.seenChapterIntro[ci] = true;
      SAVE.save();
      showStory(intro, beginStage);
      return;
    }
    beginStage();
  }

  // 実際のステージ開始(章開始ストーリー完了後に呼ばれることもある)。
  function beginStage() {
    scene = "stage";
    startLevel();
    startStageConductor();
    applySceneUI();
  }

  // 進行を更新(ステージクリア時)。DESIGN §10・Step8
  //   通常(1〜4面): その章が最新解放章なら次ステージを解放。
  //   ボス(5面): 該当章のボス撃破フラグを立て、最新解放章なら次章のステージ1を解放。
  function recordClear(chapter, stage, isBoss) {
    const pr = SAVE.data.progress;
    if (isBoss) {
      if (chapter >= 1 && chapter <= 3) pr.clearedBoss[chapter - 1] = true;
      if (chapter === pr.unlockedChapter && chapter < 3) {
        pr.unlockedChapter = chapter + 1;
        pr.unlockedStage = 1;
      }
    } else {
      if (chapter === pr.unlockedChapter) {
        pr.unlockedStage = Math.max(pr.unlockedStage, Math.min(5, stage + 1));
      }
    }
    SAVE.save();
  }

  // ゴール到達/ボス撃破 → リザルトシーン。成績を提示。コインは全額持ち帰り(ボスはボーナス加算)。
  function gotoResult() {
    scene = "result";
    Conductor.stop();
    resultCoins = (typeof Items !== "undefined") ? Items.settle(true) : 0;
    // ボスクリア:撃破ボーナスコインを加算(DESIGN §10)。
    if (bossClear) {
      const kind = ["silencer", "beatcrusher", "mutos"][selChapter - 1];
      const bonus = (CONFIG.BOSSES[kind] && CONFIG.BOSSES[kind].coinBonus) || 0;
      if (bonus > 0) {
        SAVE.data.coins = (SAVE.data.coins || 0) + bonus;
        SAVE.save();
        resultCoins += bonus;
      }
      bossClearChapter = selChapter;
    }
    // 進行更新(実際にクリアしたときのみ到達する経路)
    recordClear(selChapter, selStage, bossClear);
    applySceneUI();
  }

  // HP0 → ゲームオーバー。メトロノームを止めて成績を提示。コインは規定割合を持ち帰り。
  function gotoGameover() {
    scene = "gameover";
    Conductor.stop();
    resultCoins = (typeof Items !== "undefined") ? Items.settle(false) : 0;
    applySceneUI();
  }

  // タイトルタップ後のモード選択(ゲームへ/オプション/曲視聴)
  function gotoModeSelect() {
    scene = "modeselect";
    Conductor.stop();
    applySceneUI();
  }

  // 出撃準備(キャラ/装備/ショップ)。リザルト/ゲームオーバーのタップ後もここへ戻る。
  function gotoReady() {
    scene = "ready";
    Conductor.stop();
    applySceneUI();
    // オープニング演出(初回のみ。seenOpening で管理)
    if (!SAVE.data.progress.seenOpening) {
      SAVE.data.progress.seenOpening = true;
      SAVE.save();
      showStory(STORY.opening, null);
    }
  }

  // オプション(音量・較正・セーブ初期化)
  function gotoOptions() {
    scene = "options";
    applySceneUI();
  }

  // 曲視聴(ジュークボックス)
  function gotoJukebox() {
    scene = "jukebox";
    applySceneUI();
  }

  function gotoCalibration() {
    if (scene === "title") return;
    scene = "calibration";
    // 較正は従来どおりメトロノームを使う(曲が鳴っていれば止めて切り替える)
    Conductor.start({ bpm: CONFIG.METRONOME.BPM, offset: 0, startDelay: 1.0 });
    resetCalibCollection();
    applySceneUI();
  }

  function applySceneUI() {
    const showControls = scene === "stage" || scene === "calibration";
    el.controls.style.display = showControls ? "flex" : "none";
    el.btnCalib.style.display = scene === "options" ? "block" : "none";
    el.calibPanel.classList.toggle("hidden", scene !== "calibration");
    // modeselect/ready/options/jukebox のDOM表示切替はhome.jsへ委譲
    if (typeof Home !== "undefined") Home.applyScene(scene);
  }

  // ---- ストーリー(章間テキスト演出。DESIGN §10・Step8) ----
  // 各ページは1文字列。オープニング/エンディングは複数ページ、章開始/撃破は1〜複数ページ。
  const STORY = {
    opening: [
      "音楽が消えた朝、世界は灰色になった。",
      "音を喰らう魔王『ミュートス』のしわざだ。",
      "リズムの心臓を持つネズミ・ラットは、奪われた音のカケラを追って駆け出した——。",
    ],
    chapterIntro: [
      ["第1章 静寂の森 — 鳥の歌も、風の音もしない。森の奥で、何かが羽ばたいている……"],
      ["第2章 ノイズの機械都市 — 歯車はきしみ、街は不協和音に沈む。工場の奥から、重い足音が響く……"],
      ["最終章 音喰らいの城 — 世界中の音が、ここに呑まれている。玉座で魔王ミュートスが嗤う……"],
    ],
    bossDefeat: [
      ["サイレンサーは墜ちた。森に小鳥のさえずりが戻る。カケラは次の街を指している——"],
      ["ビートクラッシャーは沈黙した。機械たちは正しいリズムを取り戻し、街に音楽が流れ出す。残るカケラは、あの城に——"],
      [
        "最後の音のカケラが解き放たれ、世界に音楽が戻った。",
        "ラットの心臓は今日も、確かなリズムを刻んでいる。",
        "〜 THE END 〜",
      ],
    ],
  };

  // ストーリーパネルを表示。pages=文字列配列。全ページ送り終えたら onDone を呼ぶ。
  function showStory(pages, onDone) {
    if (!el.storyPanel || !pages || !pages.length) { if (onDone) onDone(); return; }
    story.pages = pages;
    story.idx = 0;
    story.onDone = onDone || null;
    story.active = true;
    el.storyText.textContent = pages[0];
    el.storyPanel.classList.remove("hidden");
  }

  // ストーリーを1ページ進める。最後まで来たら閉じて onDone を呼ぶ。
  function advanceStory() {
    if (!story.active) return;
    story.idx++;
    if (story.idx >= story.pages.length) {
      story.active = false;
      el.storyPanel.classList.add("hidden");
      const cb = story.onDone;
      story.onDone = null;
      if (cb) cb();
      return;
    }
    el.storyText.textContent = story.pages[story.idx];
  }

  // リザルト/ゲームオーバーのタップ処理。ボスクリア後は撃破ストーリーを挟んでから出撃準備へ。
  function onResultTap() {
    if (scene === "result" && bossClearChapter > 0) {
      const ci = bossClearChapter - 1;
      const pages = STORY.bossDefeat[ci];
      bossClearChapter = 0;
      bossClear = false;
      if (pages) { showStory(pages, gotoReady); return; }
    }
    bossClear = false;
    gotoReady();
  }

  // ゴール到達時にテレポート検証で使う所要拍(デバッグ用)
  function currentBeatOrZero() {
    return Conductor.running ? Conductor.currentBeat() : 0;
  }

  // ---- 較正 ----
  function resetCalibCollection() {
    calib.diffs = [];
    calib.avg = null;
    updateCalibInfo();
  }

  function updateCalibInfo() {
    const need = CONFIG.CALIBRATION.TAP_COUNT;
    if (calib.avg !== null) {
      el.calibInfo.textContent =
        `平均ズレ ${calib.avg.toFixed(1)}ms を較正値にできます(保存する/やり直す)`;
    } else {
      el.calibInfo.textContent =
        `メトロノームに合わせてタップ(${calib.diffs.length}/${need})`;
    }
  }

  function saveCalibration() {
    // 平均が出ていればそれを、なければ現在のスライダー値を保存
    let ms;
    if (calib.avg !== null) {
      ms = Math.round(calib.avg);
      el.slider.value = String(clampCalib(ms));
      el.sliderVal.textContent = clampCalib(ms) + "ms";
    } else {
      ms = parseInt(el.slider.value, 10) || 0;
    }
    Conductor.setCalibration(clampCalib(ms));
    el.calibInfo.textContent = `較正値 ${Conductor.getCalibration()}ms を保存しました`;
  }

  function clampCalib(ms) {
    const r = CONFIG.CALIBRATION.MANUAL_RANGE_MS;
    return Math.max(-r, Math.min(r, ms));
  }

  // ---- 入力ハンドラ ----
  function onAction(type, ctxTime) {
    if (scene === "stage") {
      handleStageInput(type, ctxTime);
    } else if (scene === "calibration") {
      handleCalibInput(type, ctxTime);
    }
  }

  // フィーバー突入しきい値。装備(feverReq)で増減するが下限4。DESIGN §9/Step6
  function feverThreshold() {
    const stats = (typeof Equip !== "undefined") ? Equip.stats() : null;
    const req = CONFIG.COMBO.FEVER_COMBO + (stats ? stats.feverReq : 0);
    return Math.max(4, req);
  }

  // 撃破結果(Player.act の戻り値)から装備の撃破時効果を処理する。
  //   blast(爆裂の宝玉): 撃破座標の周囲4近傍に追加ダメージ1
  //   vampire(吸血の牙): 確率でHP1回復(上限maxHp)
  function handleAttackResults(results) {
    if (!results || !results.length) return;
    const stats = (typeof Equip !== "undefined") ? Equip.stats() : null;
    if (!stats) return;
    for (const r of results) {
      if (!r.killed) continue;
      if (stats.blast) {
        const cells = [
          { tx: r.tx + 1, ty: r.ty }, { tx: r.tx - 1, ty: r.ty },
          { tx: r.tx, ty: r.ty + 1 }, { tx: r.tx, ty: r.ty - 1 },
        ];
        Enemies.damageAt(cells, 1);
      }
      if (stats.vampire > 0 && Math.random() < stats.vampire) {
        Player.heal(1);
      }
    }
  }

  // フィーバー突入の瞬間(雷の笛): 画面内の敵全てに1ダメージ
  function triggerFeverLightning() {
    if (typeof Enemies === "undefined" || typeof Enemies._list !== "function") return;
    const cLo = Math.floor(cam.x - VW / (2 * TILE) - 1);
    const cHi = Math.ceil(cam.x + VW / (2 * TILE) + 1);
    const cells = [];
    for (const e of Enemies._list()) {
      if (e.tx < cLo || e.tx > cHi) continue;
      cells.push({ tx: e.tx, ty: e.ty });
    }
    if (cells.length) Enemies.damageAt(cells, 1);
  }

  function handleStageInput(type, ctxTime) {
    if (goalReached) return; // GOAL演出中は入力を受けない
    if (bossRestActive) return; // ミュートスの強制休符中は入力を受けない(REST扱い)
    const res = Conductor.judge(ctxTime);
    // 休符区間(div=0):無反応。コンボ・タップ・判定内訳に含めない。
    if (res.verdict === "REST") return;

    taps++;
    pushRecentDiff(res.diffMs);

    const stats = (typeof Equip !== "undefined") ? Equip.stats() : null;

    if (res.verdict === "MISS") {
      // 時の靴(missComboHalf): コンボが0でなく半減で済む
      combo = (stats && stats.missComboHalf) ? Math.floor(combo / 2) : 0;
      judgeStats.miss++;
      missFlash = 0.22; // ミス演出(軽い暗転)
    } else {
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      if (res.verdict === "PERFECT") judgeStats.perfect++;
      else judgeStats.good++;
      const fever = combo >= feverThreshold();
      // PlayerからGameを参照しないための一方向の受け渡し(コンボ数・フィーバー中か)
      Player.setCombatContext({ combo, fever });
      const results = Player.act(type, res.verdict, {});
      handleAttackResults(results);
      // フィーバー突入の瞬間を検出(雷の笛)
      if (fever && !feverWasActive) {
        feverWasActive = true;
        if (stats && stats.feverLightning) triggerFeverLightning();
      } else if (!fever) {
        feverWasActive = false;
      }
    }
    NotesUI.popJudge(res.verdict, res.diffMs);
    SFX.judge(res.verdict);
  }

  function handleCalibInput(type, ctxTime) {
    // 較正は判定窓を無視し、最寄り拍との生のdiffMsだけ集める
    const n = nearestBeatDiff(ctxTime);
    calib.diffs.push(n);
    pushRecentDiff(n);
    SFX.judge(Math.abs(n) <= CONFIG.JUDGE.GOOD_MS ? "GOOD" : "MISS");

    if (calib.diffs.length >= CONFIG.CALIBRATION.TAP_COUNT) {
      const sum = calib.diffs.reduce((a, b) => a + b, 0);
      calib.avg = sum / calib.diffs.length;
    }
    updateCalibInfo();
  }

  // 生の入力ctx時刻から最寄り拍とのdiffMs(較正非適用)を返す
  function nearestBeatDiff(ctxTime) {
    const bpm = Conductor.bpm;
    let best = 0;
    let bestAbs = Infinity;
    const approx = Math.round((ctxTime - Conductor.beatTime(0)) * bpm / 60);
    for (let n = approx - 1; n <= approx + 1; n++) {
      const d = (ctxTime - Conductor.beatTime(n)) * 1000;
      if (Math.abs(d) < bestAbs) {
        bestAbs = Math.abs(d);
        best = d;
      }
    }
    return best;
  }

  function pushRecentDiff(d) {
    recentDiffs.push(d);
    if (recentDiffs.length > 10) recentDiffs.shift();
  }

  // ---- メインループ(描画・トゥイーン) ----
  function loop(ts) {
    let dt = 0;
    if (lastFrameT) {
      dt = (ts - lastFrameT) / 1000; // 秒
      if (dt > 0) fps = fps * 0.9 + (1 / dt) * 0.1;
    }
    lastFrameT = ts;
    if (dt > 0.1) dt = 0.1; // タブ復帰などの大ジャンプを抑制

    // 撃破ヒットストップ中は更新を止める(rAF側の演出。拍計算には影響しない)
    if (scene === "stage" && performance.now() >= hitstopUntil) updateStage(dt);

    render();
    requestAnimationFrame(loop);
  }

  function updateStage(dt) {
    // 現在が休符区間(div=0)か。休符中は敵・ボスの拍処理を止める(プレイヤーは judge が REST)。
    restNow = Conductor.running && Conductor.sectionAt(Conductor.currentBeat()).div === 0;
    // ミュートスの強制休符(音喰らい)が有効か。入力遮断・レーン暗転に流用する(敵・弾は動く)。
    bossRestActive = bossStage && bossTriggered && typeof Boss !== "undefined" && Boss.isForcedRest();

    // ボス戦の開始判定:アリーナ左端(triggerX)へ入ったらボス出現+左壁をせり上げる(見た目+トラップ)。
    if (bossStage && !bossTriggered && level.arena) {
      const p0 = Player.pos();
      if (p0.tx >= level.arena.triggerX) {
        bossTriggered = true;
        Boss.spawn(currentChapter, level);
        // 左壁を実体化して閉じ込める(row5,6,7 の3タイル。DESIGN §10「左壁がせり上がって閉じる」)。
        const wc = level.arena.leftWall;
        for (let ry = level.arena.standRow - 2; ry <= level.arena.standRow; ry++) {
          if (ry >= 0 && ry < level.h) level.tiles[ry][wc] = "#";
        }
      }
    }

    Player.update(dt);
    // フィーバー状態をEnemiesへ毎フレーム反映(撃破時のコインドロップ2倍判定用。DESIGN §3・Step7)
    if (typeof Enemies !== "undefined" && Enemies.setFever) Enemies.setFever(combo >= feverThreshold());
    // 敵の拍駆動AI(拍跨ぎ処理は内部でConductor基準)。ダメージ解決順:
    // プレイヤー行動(攻撃/移動=入力時に即時)→ 敵行動 → 接触、の順で1拍内を処理。
    // 休符中(restNow)は敵・弾・爆弾の行動を止める。
    Enemies.update(dt, restNow);
    // ボス(拍駆動)。曲の休符(restNow)中のみ停止。強制休符中はボス自身が「移動のみ・攻撃しない」を保証する。
    if (bossStage && bossTriggered && typeof Boss !== "undefined") {
      Boss.update(dt, restNow);
      // ボスのジャンププレス等の画面揺れ要求を回収
      if (Boss.takeShake) { const s = Boss.takeShake(); if (s > 0) shakeMag = Math.min(40, shakeMag + s); }
    }
    // コイン回収(拍と無関係・毎フレーム判定)
    if (typeof Items !== "undefined") Items.update(dt);

    // 被弾演出:Player.hurtCount の増加を検出(接触・弾・爆発・攻撃拍いずれも共通)
    if (Player.hurtCount > prevHurt) {
      prevHurt = Player.hurtCount;
      combo = 0;                 // コンボ切れ
      feverWasActive = false;    // フィーバー突入検出をリセット(雷の笛の再トリガー用)
      missFlash = 0.25;          // 赤フラッシュ
      shakeMag = Math.min(30, shakeMag + 16); // 画面揺れ
    }
    // 撃破演出:Enemies.kills の増加を検出(攻撃・爆発いずれも共通)
    if (Enemies.kills > prevKills) {
      const dk = Enemies.kills - prevKills;
      prevKills = Enemies.kills;
      enemiesKilled += dk;
      score += dk * 100;
      hitstopUntil = performance.now() + CONFIG.COMBAT.HITSTOP_MS; // 軽いヒットストップ
    }
    if (missFlash > 0) missFlash = Math.max(0, missFlash - dt);
    if (shakeMag > 0) shakeMag = Math.max(0, shakeMag - 120 * dt);

    // ゲームオーバー
    if (Player.isDead()) { gotoGameover(); return; }

    const p = Player.pos();
    // カメラ:プレイヤー描画X+向き先読みへLERP追従、レベル端でクランプ
    const target = clampCamX(p.x + p.dir * CONFIG.CAMERA.FORWARD_TILES);
    cam.x += (target - cam.x) * CONFIG.CAMERA.LERP;

    if (bossStage) {
      // ボスステージ:撃破演出(gone)まで見届けてからクリア。ゴール旗の判定はしない。
      if (bossTriggered && !bossDefeatedHandled && typeof Boss !== "undefined" && Boss.isDefeated()) {
        bossDefeatedHandled = true;
        goalReached = true;
        goalBeat = currentBeatOrZero();
        songClear = false;
        bossClear = true;
        gotoResult();
      }
      return;
    }

    // ゴール判定(同タイル)→ リザルトへ
    if (!goalReached && p.tx === level.goalX && p.ty === level.goalY) {
      goalReached = true;
      goalBeat = currentBeatOrZero();
      // 曲が終わる前にゴールしたか(曲内クリアボーナス)。DESIGN §4
      songClear = Conductor.totalBeats > 0 && goalBeat <= Conductor.totalBeats;
      gotoResult();
    }
  }

  // ワールド→スクリーン変換(タイルの左上px)
  function tileScreenX(col) { return (col - cam.x) * TILE + VW / 2 - TILE / 2; }
  function tileScreenY(row) { return (row - cam.y) * TILE + VH / 2 - TILE / 2; }

  // ---- 描画 ----
  function render() {
    g.setTransform(canvas.width / VW, 0, 0, canvas.height / VH, 0, 0);
    g.clearRect(0, 0, VW, VH);

    if (scene === "title") {
      g.fillStyle = "#05060a";
      g.fillRect(0, 0, VW, VH);
      renderTitle();
    } else if (scene === "modeselect" || scene === "ready" || scene === "options" || scene === "jukebox") {
      // DOMオーバーレイ(home.js)が全画面を覆うため、Canvasは薄い背景のみでよい(DESIGN §1/Step6)
      g.fillStyle = "#05060a";
      g.fillRect(0, 0, VW, VH);
    } else if (scene === "result") {
      renderBackground();
      renderResult();
    } else if (scene === "gameover") {
      renderBackground();
      if (level) renderWorld(); // 較正のみ経由でlevel未生成のまま来ることは無いが念のため
      if (typeof Items !== "undefined") Items.draw(g, cam);
      Enemies.draw(g, cam);
      if (bossStage && bossTriggered && typeof Boss !== "undefined") Boss.draw(g, cam);
      if (level) Player.draw(g, cam);
      renderGameover();
    } else {
      renderBackground();
      // 画面揺れ(ワールド・敵・プレイヤーのみ。背景/HUDは揺らさない)
      g.save();
      if (shakeMag > 0) {
        g.translate((Math.random() * 2 - 1) * shakeMag, (Math.random() * 2 - 1) * shakeMag);
      }
      // calibrationシーンはステージ開始前(level未生成・Player未初期化)にオプションから
      // 直接入れるため、level が無ければワールド/プレイヤー描画を省略する
      // (較正はメトロノームのみで完結する。Player.charがnullのままdrawするとエラーになるため)
      if (level) renderWorld();
      if (typeof Items !== "undefined") Items.draw(g, cam);
      Enemies.draw(g, cam);
      // ボス(敵より手前・プレイヤーより奥に描く)
      if (bossStage && bossTriggered && typeof Boss !== "undefined") Boss.draw(g, cam);
      if (level) Player.draw(g, cam);
      g.restore();
      // 休符区間/ボスの強制休符:画面を少し暗く+「♪休符♪」小表示
      if (restNow || bossRestActive) renderRestOverlay();
      NotesUI.draw(g, VW, VH);
      // コンボフィーバー:画面縁が拍に同期して脈動発光(しきい値は装備で変動)
      if (combo >= feverThreshold()) renderComboFeverEdge();
      renderHUD();
      // ボスHPバー(画面上部・フェーズ2で色変化)
      if (bossStage && bossTriggered && typeof Boss !== "undefined" && Boss.active) renderBossHP();
      if (missFlash > 0) {
        g.fillStyle = `rgba(255,60,80,${0.35 * (missFlash / 0.25)})`;
        g.fillRect(0, 0, VW, VH);
      }
    }

    if (DEBUG) renderDebug();
  }

  function renderTitle() {
    g.textAlign = "center";
    g.fillStyle = "#ffffff";
    g.font = "bold 72px sans-serif";
    g.fillText("リズムダンジョン", VW / 2, VH / 2 - 40);
    g.font = "36px sans-serif";
    if (!songReady) {
      // 楽曲デコード中は開始不可(タップ無効)
      g.fillStyle = "#8f9bbf";
      g.fillText("読み込み中…", VW / 2, VH / 2 + 60);
    } else {
      g.fillStyle = "#9fb4ff";
      const blink = 0.5 + 0.5 * Math.sin(performance.now() / 350);
      g.globalAlpha = 0.4 + 0.6 * blink;
      g.fillText("タップして開始", VW / 2, VH / 2 + 60);
      g.globalAlpha = 1;
    }
  }

  // 背景:章テーマの2色グラデーションをベースに、拍パルス/feverの発光オーバーレイを重ねる。
  // DESIGN §10・Step7(章ごとの見た目テーマ)。既存の拍パルス・fever演出は維持する。
  function renderBackground() {
    let beatPulse = 0;
    let fever = false;
    if (Conductor.running) {
      const b = Conductor.currentBeat();
      const frac = b - Math.floor(b);
      beatPulse = Math.max(0, 1 - frac * 2); // 拍頭で1→0
      fever = !!Conductor.sectionAt(b).fever;
    }
    const theme = chapterTheme();
    const grad = g.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, theme.bg[0]);
    grad.addColorStop(1, theme.bg[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, VW, VH);
    // 拍パルス:画面上部から明るいオーバーレイ(feverは暖色寄りに)
    if (beatPulse > 0.02) {
      g.fillStyle = fever
        ? `rgba(255,170,90,${0.10 + beatPulse * 0.22})`
        : `rgba(140,170,255,${0.05 + beatPulse * 0.14})`;
      g.fillRect(0, 0, VW, VH * 0.6);
    }
    // fever区間:全体を薄い暖色でオーバーレイ
    if (fever) {
      g.fillStyle = `rgba(255,120,40,${0.06 + beatPulse * 0.08})`;
      g.fillRect(0, 0, VW, VH);
    }
  }

  // タイルワールド描画(可視範囲のみ)。ブロック色は章テーマから参照(DESIGN §10・Step7)。
  function renderWorld() {
    const theme = chapterTheme();
    const cLo = Math.floor(cam.x - VW / (2 * TILE) - 1);
    const cHi = Math.ceil(cam.x + VW / (2 * TILE) + 1);
    for (let row = 0; row < level.h; row++) {
      for (let col = cLo; col <= cHi; col++) {
        if (!LevelGen.solidAt(level, col, row)) continue;
        // 範囲外(左右外の壁)は描かない(見た目は空扱いでよい)
        if (col < 0 || col >= level.w) continue;
        const sx = tileScreenX(col);
        const sy = tileScreenY(row);
        // ブロック本体
        g.fillStyle = theme.tile;
        g.fillRect(sx, sy, TILE, TILE);
        // 上面が空なら明るいハイライト(地表の縁)
        if (!LevelGen.solidAt(level, col, row - 1)) {
          g.fillStyle = theme.tileTop;
          g.fillRect(sx, sy, TILE, 8);
        }
        // 内側の陰影で立体感
        g.strokeStyle = "rgba(0,0,0,0.25)";
        g.lineWidth = 2;
        g.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
      }
    }
    // スポーン候補マーカー(Step4/6で実体に置換予定のプレースホルダ)
    renderSpawns(cLo, cHi);
    // ゴール旗
    drawGoal();
  }

  // スポーン候補の可視化(仮): I=緑四角枠(Step7まで保留のプレースホルダ)
  // C=コインは Items が実体化して描画するのでここでは描かない。
  // E=敵も Enemies が実体化して描画するのでここでは描かない。
  function renderSpawns(cLo, cHi) {
    if (!level.spawns) return;
    for (const s of level.spawns) {
      if (s.tx < cLo || s.tx > cHi) continue;
      if (s.type !== "I") continue;
      const cx = tileScreenX(s.tx) + TILE / 2;
      const cy = tileScreenY(s.ty) + TILE / 2;
      g.strokeStyle = "rgba(90,223,122,0.8)";
      g.lineWidth = 3;
      g.strokeRect(cx - TILE * 0.26, cy - TILE * 0.26, TILE * 0.52, TILE * 0.52);
    }
  }

  function drawGoal() {
    const sx = tileScreenX(level.goalX);
    const sy = tileScreenY(level.goalY);
    const poleX = sx + TILE * 0.3;
    const topY = sy + TILE * 0.05;
    const botY = sy + TILE;
    // ポール
    g.strokeStyle = "#e8ecff";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(poleX, topY);
    g.lineTo(poleX, botY);
    g.stroke();
    // 旗(拍でなびく簡素な演出)
    const wave = Conductor.running ? Math.sin(performance.now() / 200) * 6 : 0;
    g.fillStyle = "#ffd54a";
    g.beginPath();
    g.moveTo(poleX, topY);
    g.lineTo(poleX + TILE * 0.5, topY + TILE * 0.12 + wave);
    g.lineTo(poleX, topY + TILE * 0.28);
    g.closePath();
    g.fill();
  }

  // リザルト画面(Canvas描画)。判定内訳・最大コンボ・総タップ・所要拍数を提示。
  function renderResult() {
    // 半透明の暗幕でステージ背景を落ち着かせる
    g.fillStyle = "rgba(5,6,14,0.72)";
    g.fillRect(0, 0, VW, VH);

    g.textAlign = "center";
    g.fillStyle = "#ffd54a";
    g.font = "bold 110px sans-serif";
    g.fillText(bossClear ? "BOSS CLEAR!" : "CLEAR!", VW / 2, 210);

    // クリアしたステージ(章-面)表記
    g.fillStyle = "#9fb4ff";
    g.font = "bold 30px sans-serif";
    g.fillText(`ステージ ${selChapter}-${selStage} クリア`, VW / 2, 258);

    // 曲内クリアボーナス(曲が終わる前にゴール)。DESIGN §4
    if (songClear) {
      g.fillStyle = "#5adf7a";
      g.font = "bold 30px sans-serif";
      g.fillText("♪ 曲内クリア! ♪", VW / 2, 292);
    }

    // 判定内訳
    const rows = [
      ["PERFECT", judgeStats.perfect, "#ffd54a"],
      ["GOOD", judgeStats.good, "#5adf7a"],
      ["MISS", judgeStats.miss, "#ff5a6a"],
      ["最大コンボ", maxCombo, "#e8ecff"],
      ["総タップ", taps, "#e8ecff"],
      ["倒した敵", enemiesKilled, "#e8ecff"],
      ["所要拍数", Math.max(0, Math.round(goalBeat)), "#e8ecff"],
      ["獲得コイン", resultCoins, "#ffd54a"],
    ];
    g.font = "bold 40px sans-serif";
    let y = 320;
    for (const [label, val, col] of rows) {
      g.textAlign = "right";
      g.fillStyle = "#aeb6d6";
      g.fillText(label, VW / 2 - 30, y);
      g.textAlign = "left";
      g.fillStyle = col;
      g.fillText(String(val), VW / 2 + 30, y);
      y += 56;
    }

    // 出撃準備へ戻る案内(点滅)
    g.textAlign = "center";
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 350);
    g.globalAlpha = 0.4 + 0.6 * blink;
    g.fillStyle = "#9fb4ff";
    g.font = "36px sans-serif";
    g.fillText("タップで出撃準備へ", VW / 2, VH - 60);
    g.globalAlpha = 1;
  }

  // ゲームオーバー画面。成績を提示し、タップで同seedリトライ。
  function renderGameover() {
    g.fillStyle = "rgba(14,4,8,0.78)";
    g.fillRect(0, 0, VW, VH);

    g.textAlign = "center";
    g.fillStyle = "#ff5a6a";
    g.font = "bold 100px sans-serif";
    g.fillText("ゲームオーバー", VW / 2, 220);

    const rows = [
      ["倒した敵", enemiesKilled, "#ffd54a"],
      ["最大コンボ", maxCombo, "#e8ecff"],
      ["総タップ", taps, "#e8ecff"],
      ["スコア", score, "#e8ecff"],
      ["獲得コイン", resultCoins, "#ffd54a"],
    ];
    g.font = "bold 40px sans-serif";
    let y = 330;
    for (const [label, val, col] of rows) {
      g.textAlign = "right";
      g.fillStyle = "#c6aeb6";
      g.fillText(label, VW / 2 - 30, y);
      g.textAlign = "left";
      g.fillStyle = col;
      g.fillText(String(val), VW / 2 + 30, y);
      y += 56;
    }

    g.textAlign = "center";
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 350);
    g.globalAlpha = 0.4 + 0.6 * blink;
    g.fillStyle = "#ff9fb0";
    g.font = "36px sans-serif";
    g.fillText("タップで出撃準備へ", VW / 2, VH - 60);
    g.globalAlpha = 1;
  }

  // HPハート(左上)。maxHpぶんの枠を出し、残りHPを塗る。
  // HPは装備のdefMulで小数(0.5刻み)になり得るため、半端(0<remain<1)は左半分だけ塗る。
  function drawHearts(ox, oy) {
    const n = Math.round(Player.maxHp);
    const hp = Player.hp;
    const s = 26;      // ハート半径めやす
    const gap = 8;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = "30px sans-serif";
    for (let i = 0; i < n; i++) {
      const x = ox + i * (s + gap);
      const remain = hp - i;
      if (remain > 0 && remain < 1) {
        // 半ハート:まず空ハートを描き、左半分だけ赤で上塗り
        g.globalAlpha = 0.28;
        g.fillStyle = "#6b7290";
        g.fillText("♥", x, oy);
        g.save();
        g.beginPath();
        g.rect(x, oy - s, s, s * 2);
        g.clip();
        g.globalAlpha = 1;
        g.fillStyle = "#ff5a6a";
        g.fillText("♥", x, oy);
        g.restore();
      } else {
        g.globalAlpha = remain >= 1 ? 1 : 0.28;
        g.fillStyle = remain >= 1 ? "#ff5a6a" : "#6b7290";
        g.fillText("♥", x, oy);
      }
    }
    g.globalAlpha = 1;
    g.textBaseline = "alphabetic";
  }

  // 所持コイン(HUD左上・ハートの下)
  function drawCoinsHUD(ox, oy) {
    g.textAlign = "left";
    g.fillStyle = "#ffd54a";
    g.font = "bold 26px sans-serif";
    const n = (typeof Items !== "undefined") ? Items.stageCoins : 0;
    g.fillText("💰" + n, ox, oy);
  }

  // ブースト拾得アイテムの残り拍数(HUD左上・コインの下)。DESIGN §8・Step7
  function drawBoostHUD(ox, oy) {
    if (!Player.isBoosted || !Player.isBoosted()) return;
    g.textAlign = "left";
    g.fillStyle = "#9fe0ff";
    g.font = "bold 24px sans-serif";
    g.fillText("👟 残り" + Math.ceil(Player.boostRemaining()) + "拍", ox, oy);
  }

  // 休符区間の演出:画面を少し暗く+中央下に「♪休符♪」。
  function renderRestOverlay() {
    g.fillStyle = "rgba(4,6,16,0.42)";
    g.fillRect(0, 0, VW, VH);
    g.textAlign = "center";
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 260);
    g.globalAlpha = pulse;
    g.fillStyle = "#bcd0ff";
    g.font = "bold 40px sans-serif";
    g.fillText("♪ 休符 ♪", VW / 2, VH * 0.34);
    g.globalAlpha = 1;
  }

  // コンボフィーバー時の画面縁発光。拍頭で強くなるよう脈動させる。
  function renderComboFeverEdge() {
    let pulse = 0.5;
    if (Conductor.running) {
      const b = Conductor.currentBeat();
      const frac = b - Math.floor(b);
      pulse = Math.max(0, 1 - frac * 1.6); // 拍頭で1→0
    }
    const w = 46 + pulse * 40;             // 縁の太さ
    const a = 0.30 + pulse * 0.45;
    const grad = g.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, `rgba(255,213,74,${a})`);
    grad.addColorStop(1, `rgba(255,140,60,${a})`);
    g.save();
    g.fillStyle = grad;
    g.fillRect(0, 0, VW, w);                // 上
    g.fillRect(0, VH - w, VW, w);           // 下
    g.fillRect(0, 0, w, VH);                // 左
    g.fillRect(VW - w, 0, w, VH);           // 右
    g.restore();
  }

  // ボスHPバー(画面上部中央)。名前+バー。フェーズ2で色が変わる。DESIGN §10・Step8
  function renderBossHP() {
    const barW = VW * 0.6, barH = 26;
    const bx = (VW - barW) / 2, by = 24;
    const ratio = Boss.maxHp > 0 ? Math.max(0, Boss.hp / Boss.maxHp) : 0;
    // 名前
    g.textAlign = "center";
    g.fillStyle = "#e8ecff";
    g.font = "bold 26px sans-serif";
    g.fillText(Boss.name, VW / 2, by - 4);
    // 枠
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillRect(bx - 3, by - 3, barW + 6, barH + 6);
    // 残量
    const p2 = Boss.phase >= 2;
    g.fillStyle = p2 ? "#ff5a6a" : "#c85adf";
    g.fillRect(bx, by, barW * ratio, barH);
    // 枠線
    g.strokeStyle = "rgba(255,255,255,0.7)";
    g.lineWidth = 2;
    g.strokeRect(bx, by, barW, barH);
  }

  function renderHUD() {
    // 左上:HPハート、その下にコイン所持数、ブースト中はさらにその下に残り拍数
    drawHearts(24, 34);
    drawCoinsHUD(24, 70);
    drawBoostHUD(24, 100);

    // 右上:コンボ / タップ(小さく常時表示)
    g.textAlign = "right";
    g.font = "bold 30px sans-serif";
    const feverOn = combo >= feverThreshold();
    g.fillStyle = feverOn ? "#ffd54a" : "#e8ecff";
    g.fillText("コンボ: " + combo, VW - 30, 46);
    g.font = "22px sans-serif";
    g.fillStyle = "#aeb6d6";
    g.fillText("タップ: " + taps, VW - 30, 80);

    if (scene === "calibration") {
      g.textAlign = "center";
      g.fillStyle = "#cfe";
      g.font = "26px sans-serif";
      g.fillText("較正モード:メトロノームに合わせてタップ", VW / 2, 70);
    }
  }

  function renderDebug() {
    g.setTransform(canvas.width / VW, 0, 0, canvas.height / VH, 0, 0);
    g.textAlign = "left";
    g.font = "20px monospace";
    const lines = [];
    lines.push("scene: " + scene);
    lines.push("ctx.state: " + SFX.ctx.state);
    lines.push("fps: " + fps.toFixed(0));
    lines.push(
      "currentBeat: " +
        (Conductor.running ? Conductor.currentBeat().toFixed(3) : "-")
    );
    // 楽曲・譜面情報(Step5)
    lines.push(
      `songMode: ${Conductor.songMode ? 1 : 0}  loaded: ${Conductor.songLoaded ? 1 : 0}  totalBeats: ${Conductor.totalBeats}`
    );
    if (Conductor.running) {
      const cb = Conductor.chartBeat();
      const sec = Conductor.sectionAt(Conductor.currentBeat());
      lines.push(
        `chartBeat: ${cb.toFixed(2)}  mood: ${sec.mood || "-"}  div: ${sec.div}${sec.fever ? " (fever)" : ""}`
      );
    }
    lines.push("calibration: " + Conductor.getCalibration() + "ms");
    if (level) {
      lines.push(`seed: ${curSeed}`);
      lines.push(`chunkCount: ${level.chunkCount}  goalDist: ${level.goalDist.toFixed(1)}`);
    }
    lines.push(`chapter: ${currentChapter + 1} ${chapterTheme().name}  stage: ${selChapter}-${selStage}`);
    lines.push(`char: ${effectiveChar()}  hp: ${Player.hp}/${Player.maxHp}  kills: ${enemiesKilled}`);
    lines.push(`enemies: ${Enemies.count}  bullets: ${Enemies.bulletCount}  bombs: ${Enemies.bombCount}`);
    if (bossStage && typeof Boss !== "undefined") {
      lines.push(`BOSS: ${Boss.spawned ? Boss.name : "-"} trig:${bossTriggered ? 1 : 0} st:${Boss.state} hp:${Boss.hp}/${Boss.maxHp} ph:${Boss.phase} rest:${bossRestActive ? 1 : 0}`);
    }
    if (SAVE.data.progress) {
      const pr = SAVE.data.progress;
      lines.push(`prog: unlkCh:${pr.unlockedChapter} unlkStg:${pr.unlockedStage} boss:[${pr.clearedBoss.map((b) => b ? 1 : 0).join(",")}]`);
    }
    if (scene === "stage" && level) {
      const p = Player.pos();
      lines.push(`player tx,ty: ${p.tx},${p.ty}  state: ${p.state}  inv: ${Player.isInvulnerable() ? 1 : 0}`);
      lines.push(`cam.x: ${cam.x.toFixed(2)}`);
    }
    const avg =
      recentDiffs.length > 0
        ? recentDiffs.reduce((a, b) => a + b, 0) / recentDiffs.length
        : 0;
    lines.push("avg diff: " + avg.toFixed(1) + "ms");
    lines.push("diffs(直近10):");

    const oy = 96;
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillRect(8, oy, 380, 30 + (lines.length + recentDiffs.length) * 22);
    g.fillStyle = "#7CFC00";
    let y = oy + 24;
    for (const ln of lines) {
      g.fillText(ln, 18, y);
      y += 22;
    }
    for (let i = recentDiffs.length - 1; i >= 0; i--) {
      const d = recentDiffs[i];
      g.fillStyle = Math.abs(d) <= CONFIG.JUDGE.PERFECT_MS
        ? "#ffd54a"
        : Math.abs(d) <= CONFIG.JUDGE.GOOD_MS
        ? "#5adf7a"
        : "#ff5a6a";
      g.fillText("  " + d.toFixed(1) + "ms", 18, y);
      y += 22;
    }
  }

  // 起動
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // テスト・デバッグ用に一部内部を公開(home.jsからのシーン遷移呼び出しにも使う)
  return {
    get scene() { return scene; },
    get combo() { return combo; },
    get taps() { return taps; },
    get cam() { return cam; },
    get level() { return level; },
    get seed() { return curSeed; },
    get currentChapter() { return currentChapter; },
    _gotoStage: gotoStage,
    _gotoCalibration: gotoCalibration,
    _gotoModeSelect: gotoModeSelect,
    _gotoReady: gotoReady,
    _gotoOptions: gotoOptions,
    _gotoJukebox: gotoJukebox,
    // 出撃準備でのキャラ選択(home.jsから呼ばれる。?charのURL指定がある場合は無視される)
    _getChar: effectiveChar,
    _setChar(id) {
      if (urlChar) return; // URLデバッグ指定が優先
      if (CONFIG.CHARACTERS[id]) selectedChar = id;
    },
    // 出撃準備での章・ステージ選択(home.jsから呼ばれる)。
    _getStageSel() { return { chapter: selChapter, stage: selStage }; },
    _setStageSel(chapter, stage) {
      selChapter = Math.max(1, Math.min(3, chapter | 0));
      selStage = Math.max(1, Math.min(5, stage | 0));
    },
    // 検証用:任意seedでレベル再生成 / ゴール直前へテレポート
    _startLevel: startLevel,
    _teleportToGoal() {
      if (!level) return;
      Player._debugSetTile(level.goalX, level.goalY);
    },
    // 検証用:任意章のボスステージへ直行(章1始まり)。ステージ5・該当章に設定して開始する。
    _gotoBossStage(chapter) {
      selChapter = Math.max(1, Math.min(3, chapter | 0));
      selStage = 5;
      beginStage();
    },
    // 検証用:ボスアリーナのトリガー手前へテレポート(進入でボス戦開始)。
    _teleportToArena() {
      if (!level || !level.arena) return;
      Player._debugSetTile(level.arena.triggerX, level.arena.standRow);
    },
  };
})();
