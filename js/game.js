// game.js … シーン管理・ゲームループ・カメラ・HUD・リザルト(Step3: 自動生成レベル)
// シーン: title(タップして開始) / stage(自動生成レベル) / result(リザルト) / calibration(較正)
// 描画・トゥイーンはrAF、拍・判定は全てConductor経由。

const Game = (() => {
  const VW = CONFIG.VIEW.W;
  const VH = CONFIG.VIEW.H;
  const TILE = CONFIG.TILE;
  const DEBUG = /[?&]debug=1\b/.test(location.search);

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
  let missFlash = 0;      // ミス演出の残り秒

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
    SFX.resume().then(() => {
      gotoStage();
    });
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
    level = LevelGen.generate({ totalBeats: CONFIG.STAGE.TEST_BEATS, seed: curSeed });
    Player.init(level);
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
  }

  function gotoStage() {
    const fresh = scene !== "calibration"; // 較正から戻る時はレベルを維持
    scene = "stage";
    if (fresh || !level) startLevel();
    // メトロノーム開始(未起動なら)。offset=0, startDelay=1.0
    if (!Conductor.running) {
      Conductor.start({ bpm: CONFIG.METRONOME.BPM, offset: 0, startDelay: 1.0 });
    }
    applySceneUI();
  }

  // ゴール到達 → リザルトシーン。メトロノームを止めて成績を提示する。
  function gotoResult() {
    scene = "result";
    Conductor.stop();
    applySceneUI();
  }

  // リザルトからタップで再出撃。新しいseedで再生成しメトロノームも再開。
  function restartFromResult() {
    scene = "stage";
    startLevel();
    Conductor.start({ bpm: CONFIG.METRONOME.BPM, offset: 0, startDelay: 1.0 });
    applySceneUI();
  }

  function gotoCalibration() {
    if (scene === "title") return;
    scene = "calibration";
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
    taps++;
    const res = Conductor.judge(ctxTime);
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
      Player.act(type, res.verdict);
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

    if (scene === "stage") updateStage(dt);

    render();
    requestAnimationFrame(loop);
  }

  function updateStage(dt) {
    Player.update(dt);
    if (missFlash > 0) missFlash = Math.max(0, missFlash - dt);

    const p = Player.pos();
    // カメラ:プレイヤー描画X+向き先読みへLERP追従、レベル端でクランプ
    const target = clampCamX(p.x + p.dir * CONFIG.CAMERA.FORWARD_TILES);
    cam.x += (target - cam.x) * CONFIG.CAMERA.LERP;

    // ゴール判定(同タイル)→ リザルトへ
    if (!goalReached && p.tx === level.goalX && p.ty === level.goalY) {
      goalReached = true;
      goalBeat = currentBeatOrZero();
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
    } else {
      renderBackground();
      renderWorld();
      Player.draw(g, cam);
      NotesUI.draw(g, VW, VH);
      renderHUD();
      if (missFlash > 0) {
        g.fillStyle = `rgba(255,60,80,${0.35 * (missFlash / 0.22)})`;
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
    g.fillStyle = "#9fb4ff";
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 350);
    g.globalAlpha = 0.4 + 0.6 * blink;
    g.fillText("タップして開始", VW / 2, VH / 2 + 60);
    g.globalAlpha = 1;
  }

  // 背景:拍パルスの簡素なグラデーション
  function renderBackground() {
    let beatPulse = 0;
    if (Conductor.running) {
      const b = Conductor.currentBeat();
      const frac = b - Math.floor(b);
      beatPulse = Math.max(0, 1 - frac * 2); // 拍頭で1→0
    }
    const grad = g.createLinearGradient(0, 0, 0, VH);
    const top = 12 + beatPulse * 22;
    grad.addColorStop(0, `hsl(230, 45%, ${8 + beatPulse * 6}%)`);
    grad.addColorStop(1, `hsl(250, 40%, ${top}%)`);
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

  // スポーン候補の可視化(仮): E=赤丸枠 / C=黄小円 / I=緑四角枠
  function renderSpawns(cLo, cHi) {
    if (!level.spawns) return;
    for (const s of level.spawns) {
      if (s.tx < cLo || s.tx > cHi) continue;
      const cx = tileScreenX(s.tx) + TILE / 2;
      const cy = tileScreenY(s.ty) + TILE / 2;
      if (s.type === "E") {
        g.strokeStyle = "rgba(255,90,110,0.7)";
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, cy, TILE * 0.32, 0, Math.PI * 2);
        g.stroke();
      } else if (s.type === "C") {
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
    g.fillText("CLEAR!", VW / 2, 220);

    // 判定内訳
    const rows = [
      ["PERFECT", judgeStats.perfect, "#ffd54a"],
      ["GOOD", judgeStats.good, "#5adf7a"],
      ["MISS", judgeStats.miss, "#ff5a6a"],
      ["最大コンボ", maxCombo, "#e8ecff"],
      ["総タップ", taps, "#e8ecff"],
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

  function renderHUD() {
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
    lines.push("calibration: " + Conductor.getCalibration() + "ms");
    if (level) {
      lines.push(`seed: ${curSeed}`);
      lines.push(`chunkCount: ${level.chunkCount}  goalDist: ${level.goalDist.toFixed(1)}`);
    }
    if (scene === "stage" && level) {
      const p = Player.pos();
      lines.push(`player tx,ty: ${p.tx},${p.ty}  state: ${p.state}`);
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
