// game.js … シーン管理・ゲームループ・カメラ・HUD・リザルト(Step3: 自動生成レベル)
// シーン: title(タップして開始) / stage(自動生成レベル) / result(リザルト) / calibration(較正)
// 描画・トゥイーンはrAF、拍・判定は全てConductor経由。

const Game = (() => {
  const VW = CONFIG.VIEW.W;
  const VH = CONFIG.VIEW.H;
  const TILE = CONFIG.TILE;
  const DEBUG = /[?&]debug=1\b/.test(location.search);
  // 使用キャラ(Step4はUIなしでURLパラメータ切替)。DESIGN §5
  const CHAR = (location.search.match(/[?&]char=(rat|sword|gun)/) || [])[1] || "rat";

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

  // 楽曲ロード状態(タイトルの「読み込み中…」→「タップして開始」切替に使う)
  let songReady = (typeof SONGS === "undefined" || SONGS.length === 0);

  // 戦闘統計・演出
  let enemiesKilled = 0;  // 倒した敵数(リザルト表示)
  let score = 0;          // 内部スコア(撃破加算)
  let prevKills = 0;      // Enemies.kills の前フレーム値
  let prevHurt = 0;       // Player.hurtCount の前フレーム値
  let shakeMag = 0;       // 画面揺れ量(px・減衰)
  let hitstopUntil = 0;   // この時刻(performance.now)まで更新を止める(撃破演出)

  // 較正シーンの状態
  const calib = {
    diffs: [],       // 収集したdiffMs
    avg: null,       // 平均(算出後)
  };

  // デバッグHUD用
  const recentDiffs = []; // 直近の判定diffMs
  let fps = 0;
  let lastFrameT = 0;

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

    SAVE.load();
    // 保存済み較正値をConductorへ反映
    Conductor.previewCalibration(SAVE.data.calibrationMs);

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

    // タイトルでのタップ(AudioContext解禁)
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        if (scene === "title") startFromTitle();
        else if (scene === "result") restartFromResult();
        else if (scene === "gameover") retrySameSeed();
      },
      { passive: false }
    );

    // シーンUIボタン
    el.btnCalib.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      gotoCalibration();
    });
    el.btnBack.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      gotoStage();
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
  function startFromTitle() {
    if (!songReady) return; // 楽曲の読み込み完了前はタップを無視
    SFX.resume().then(() => {
      gotoStage();
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
    // 曲の総拍数からゴール距離を逆算(未ロード時は較正用の仮値)。DESIGN §4
    const tb = Conductor.totalBeats || CONFIG.STAGE.TEST_BEATS;
    level = LevelGen.generate({ totalBeats: tb, seed: curSeed });
    Player.init(level, CHAR);
    // 敵の実体化:抽選・位相は seed 由来の乱数(リトライ再現性)
    Enemies.init(level, LevelGen.rng((curSeed ^ 0x9e3779b9) >>> 0));
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
  }

  function gotoStage() {
    const fresh = scene !== "calibration"; // 較正から戻る時はレベルを維持
    scene = "stage";
    if (fresh || !level) startLevel();
    // 楽曲(またはフォールバックのメトロノーム)を頭から開始。
    // 較正から戻る場合もメトロノームを止めて曲に切り替える。
    startStageConductor();
    applySceneUI();
  }

  // ゴール到達 → リザルトシーン。メトロノームを止めて成績を提示する。
  function gotoResult() {
    scene = "result";
    Conductor.stop();
    applySceneUI();
  }

  // リザルトからタップで再出撃。新しいseedで再生成し曲も頭から。
  function restartFromResult() {
    scene = "stage";
    startLevel();
    startStageConductor();
    applySceneUI();
  }

  // HP0 → ゲームオーバー。メトロノームを止めて成績を提示。
  function gotoGameover() {
    scene = "gameover";
    Conductor.stop();
    applySceneUI();
  }

  // ゲームオーバーからタップで「同じseed」を最初からリトライ。曲も頭から。
  function retrySameSeed() {
    scene = "stage";
    startLevel(curSeed);
    startStageConductor();
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
    el.btnCalib.style.display = scene === "stage" ? "block" : "none";
    el.calibPanel.classList.toggle("hidden", scene !== "calibration");
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

  function handleStageInput(type, ctxTime) {
    if (goalReached) return; // GOAL演出中は入力を受けない
    const res = Conductor.judge(ctxTime);
    // 休符区間(div=0):無反応。コンボ・タップ・判定内訳に含めない。
    if (res.verdict === "REST") return;

    taps++;
    pushRecentDiff(res.diffMs);

    if (res.verdict === "MISS") {
      combo = 0;
      judgeStats.miss++;
      missFlash = 0.22; // ミス演出(軽い暗転)
    } else {
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      if (res.verdict === "PERFECT") judgeStats.perfect++;
      else judgeStats.good++;
      const fever = combo >= CONFIG.COMBO.FEVER_COMBO;
      Player.act(type, res.verdict, { fever });
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
    // 現在が休符区間(div=0)か。休符中は敵の拍処理を止める(プレイヤーは judge が REST)。
    restNow = Conductor.running && Conductor.sectionAt(Conductor.currentBeat()).div === 0;

    Player.update(dt);
    // 敵の拍駆動AI(拍跨ぎ処理は内部でConductor基準)。ダメージ解決順:
    // プレイヤー行動(攻撃/移動=入力時に即時)→ 敵行動 → 接触、の順で1拍内を処理。
    // 休符中(restNow)は敵・弾・爆弾の行動を止める。
    Enemies.update(dt, restNow);

    // 被弾演出:Player.hurtCount の増加を検出(接触・弾・爆発・攻撃拍いずれも共通)
    if (Player.hurtCount > prevHurt) {
      prevHurt = Player.hurtCount;
      combo = 0;                 // コンボ切れ
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
    } else if (scene === "result") {
      renderBackground();
      renderResult();
    } else if (scene === "gameover") {
      renderBackground();
      renderWorld();
      Enemies.draw(g, cam);
      Player.draw(g, cam);
      renderGameover();
    } else {
      renderBackground();
      // 画面揺れ(ワールド・敵・プレイヤーのみ。背景/HUDは揺らさない)
      g.save();
      if (shakeMag > 0) {
        g.translate((Math.random() * 2 - 1) * shakeMag, (Math.random() * 2 - 1) * shakeMag);
      }
      renderWorld();
      Enemies.draw(g, cam);
      Player.draw(g, cam);
      g.restore();
      // 休符区間:画面を少し暗く+「♪休符♪」小表示
      if (restNow) renderRestOverlay();
      NotesUI.draw(g, VW, VH);
      // コンボフィーバー(16以上):画面縁が拍に同期して脈動発光
      if (combo >= CONFIG.COMBO.FEVER_COMBO) renderComboFeverEdge();
      renderHUD();
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

  // 背景:拍パルスの簡素なグラデーション。fever区間は明るく・暖色に。
  function renderBackground() {
    let beatPulse = 0;
    let fever = false;
    if (Conductor.running) {
      const b = Conductor.currentBeat();
      const frac = b - Math.floor(b);
      beatPulse = Math.max(0, 1 - frac * 2); // 拍頭で1→0
      fever = !!Conductor.sectionAt(b).fever;
    }
    const grad = g.createLinearGradient(0, 0, 0, VH);
    if (fever) {
      // fever区間:暖色・明るめのグラデーション
      const top = 26 + beatPulse * 24;
      grad.addColorStop(0, `hsl(300, 55%, ${16 + beatPulse * 8}%)`);
      grad.addColorStop(1, `hsl(28, 70%, ${top}%)`);
    } else {
      const top = 12 + beatPulse * 22;
      grad.addColorStop(0, `hsl(230, 45%, ${8 + beatPulse * 6}%)`);
      grad.addColorStop(1, `hsl(250, 40%, ${top}%)`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, VW, VH);
  }

  // タイルワールド描画(可視範囲のみ)
  function renderWorld() {
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
        g.fillStyle = "#2b3252";
        g.fillRect(sx, sy, TILE, TILE);
        // 上面が空なら明るいハイライト(地表の縁)
        if (!LevelGen.solidAt(level, col, row - 1)) {
          g.fillStyle = "#4a5688";
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

  // スポーン候補の可視化(仮): C=黄小円 / I=緑四角枠
  // (E=敵は Enemies が実体化して描画するのでここでは描かない)
  function renderSpawns(cLo, cHi) {
    if (!level.spawns) return;
    for (const s of level.spawns) {
      if (s.tx < cLo || s.tx > cHi) continue;
      const cx = tileScreenX(s.tx) + TILE / 2;
      const cy = tileScreenY(s.ty) + TILE / 2;
      if (s.type === "C") {
        g.fillStyle = "rgba(255,213,74,0.85)";
        g.beginPath();
        g.arc(cx, cy, TILE * 0.16, 0, Math.PI * 2);
        g.fill();
      } else if (s.type === "I") {
        g.strokeStyle = "rgba(90,223,122,0.8)";
        g.lineWidth = 3;
        g.strokeRect(cx - TILE * 0.26, cy - TILE * 0.26, TILE * 0.52, TILE * 0.52);
      }
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
    g.fillText("CLEAR!", VW / 2, 210);

    // 曲内クリアボーナス(曲が終わる前にゴール)。DESIGN §4
    if (songClear) {
      g.fillStyle = "#5adf7a";
      g.font = "bold 34px sans-serif";
      g.fillText("♪ 曲内クリア! ♪", VW / 2, 262);
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

    // 再出撃の案内(点滅)
    g.textAlign = "center";
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 350);
    g.globalAlpha = 0.4 + 0.6 * blink;
    g.fillStyle = "#9fb4ff";
    g.font = "36px sans-serif";
    g.fillText("タップで再出撃", VW / 2, VH - 60);
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
    g.fillText("タップで同じステージをリトライ", VW / 2, VH - 60);
    g.globalAlpha = 1;
  }

  // HPハート(左上)。maxHpぶんの枠を出し、残りHPを塗る。
  function drawHearts(ox, oy) {
    const n = Player.maxHp;
    const hp = Player.hp;
    const s = 26;      // ハート半径めやす
    const gap = 8;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = "30px sans-serif";
    for (let i = 0; i < n; i++) {
      const x = ox + i * (s + gap);
      g.globalAlpha = i < hp ? 1 : 0.28;
      g.fillStyle = i < hp ? "#ff5a6a" : "#6b7290";
      g.fillText("♥", x, oy);
    }
    g.globalAlpha = 1;
    g.textBaseline = "alphabetic";
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

  function renderHUD() {
    // 左上:HPハート
    drawHearts(24, 34);

    // 右上:コンボ / タップ(小さく常時表示)
    g.textAlign = "right";
    g.font = "bold 30px sans-serif";
    const feverOn = combo >= CONFIG.COMBO.FEVER_COMBO;
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
    lines.push(`char: ${CHAR}  hp: ${Player.hp}/${Player.maxHp}  kills: ${enemiesKilled}`);
    lines.push(`enemies: ${Enemies.count}  bullets: ${Enemies.bulletCount}  bombs: ${Enemies.bombCount}`);
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

  // テスト・デバッグ用に一部内部を公開
  return {
    get scene() { return scene; },
    get combo() { return combo; },
    get taps() { return taps; },
    get cam() { return cam; },
    get level() { return level; },
    get seed() { return curSeed; },
    _gotoStage: gotoStage,
    _gotoCalibration: gotoCalibration,
    // 検証用:任意seedでレベル再生成 / ゴール直前へテレポート
    _startLevel: startLevel,
    _teleportToGoal() {
      if (!level) return;
      Player._debugSetTile(level.goalX, level.goalY);
    },
  };
})();
