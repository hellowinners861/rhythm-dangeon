// game.js … シーン管理・ゲームループ・カメラ・HUD(Step1はリズムテスト)
// シーン: title(タップして開始) / test(リズムテスト) / calibration(較正)
// 描画はrAF、拍・判定は全てConductor経由。

const Game = (() => {
  const VW = CONFIG.VIEW.W;
  const VH = CONFIG.VIEW.H;
  const DEBUG = /[?&]debug=1\b/.test(location.search);

  let canvas, g;
  let scene = "title";

  // 統計
  let combo = 0;
  let taps = 0;

  // プレースホルダキャラの仮リアクション {type, born}(bornは描画補間用のperformance.now)
  let react = null;

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
      gotoTest();
    });
    el.btnRetry.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      resetCalibCollection();
    });
    el.btnSave.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      saveCalibration();
    });
    // スライダー:変更は即Conductorへ反映(保存はSaveボタン or 確定時)
    el.slider.addEventListener("input", () => {
      const ms = parseInt(el.slider.value, 10) || 0;
      el.sliderVal.textContent = ms + "ms";
      Conductor.setCalibration(ms); // 手動調整は即保存
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
      gotoTest();
    });
  }

  function gotoTest() {
    scene = "test";
    // メトロノーム開始(未起動なら)。offset=0, startDelay=1.0
    if (!Conductor.running) {
      Conductor.start({ bpm: CONFIG.METRONOME.BPM, offset: 0, startDelay: 1.0 });
    }
    applySceneUI();
  }

  function gotoCalibration() {
    if (scene === "title") return;
    scene = "calibration";
    resetCalibCollection();
    applySceneUI();
  }

  function applySceneUI() {
    const showControls = scene === "test" || scene === "calibration";
    el.controls.style.display = showControls ? "flex" : "none";
    el.btnCalib.style.display = scene === "test" ? "block" : "none";
    el.calibPanel.classList.toggle("hidden", scene !== "calibration");
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
    if (scene === "test") {
      handleTestInput(type, ctxTime);
    } else if (scene === "calibration") {
      handleCalibInput(type, ctxTime);
    }
  }

  function handleTestInput(type, ctxTime) {
    taps++;
    const res = Conductor.judge(ctxTime);
    pushRecentDiff(res.diffMs);

    if (res.verdict === "MISS") {
      combo = 0;
    } else {
      combo++;
      // 判定成立時のみ仮リアクション
      react = { type, born: performance.now() };
    }
    NotesUI.popJudge(res.verdict, res.diffMs);
    SFX.judge(res.verdict);
  }

  function handleCalibInput(type, ctxTime) {
    // 較正は判定窓を無視し、最寄り拍との生のdiffMsだけ集める
    // (Conductor.judgeは較正適用+二重判定があるため直接算出する)
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
    // 最寄り拍を探索
    let best = 0;
    let bestAbs = Infinity;
    const approx = Math.round(
      (ctxTime - Conductor.beatTime(0)) * bpm / 60
    );
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

  // ---- メインループ(描画のみ) ----
  function loop(ts) {
    // fps(描画補間目的なのでrAFタイムスタンプ可)
    if (lastFrameT) {
      const dt = ts - lastFrameT;
      if (dt > 0) fps = fps * 0.9 + (1000 / dt) * 0.1;
    }
    lastFrameT = ts;

    render();
    requestAnimationFrame(loop);
  }

  function render() {
    // 論理1600×900へ変換
    g.setTransform(canvas.width / VW, 0, 0, canvas.height / VH, 0, 0);
    g.clearRect(0, 0, VW, VH);

    // 背景
    g.fillStyle = "#05060a";
    g.fillRect(0, 0, VW, VH);

    if (scene === "title") {
      renderTitle();
    } else {
      renderPlayfield();
      NotesUI.draw(g, VW, VH);
      renderHUD();
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
    // 点滅
    const blink = 0.5 + 0.5 * Math.sin(performance.now() / 350);
    g.globalAlpha = 0.4 + 0.6 * blink;
    g.fillText("タップして開始", VW / 2, VH / 2 + 60);
    g.globalAlpha = 1;
  }

  function renderPlayfield() {
    // 拍に同期した軽い床パルス(見た目のみ)
    let beatPulse = 0;
    if (Conductor.running) {
      const b = Conductor.currentBeat();
      const frac = b - Math.floor(b);
      beatPulse = Math.max(0, 1 - frac * 2); // 拍頭で1→0
    }

    // プレースホルダキャラ(丸+目)
    const baseX = VW / 2;
    const baseY = VH / 2 + 30;
    let dx = 0;
    let dy = 0;
    let scale = 1;
    if (react) {
      const age = performance.now() - react.born;
      const dur = 260;
      if (age > dur) {
        react = null;
      } else {
        const t = age / dur;
        const bump = Math.sin(t * Math.PI); // 0→1→0
        if (react.type === "jump") dy = -120 * bump;
        else if (react.type === "left") dx = -70 * bump;
        else if (react.type === "right") dx = 70 * bump;
        else if (react.type === "attack") scale = 1 + 0.25 * bump;
      }
    }

    const cx = baseX + dx;
    const cy = baseY + dy;
    const r = 70 * scale;

    // 影
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.ellipse(baseX, baseY + 78, 60, 16, 0, 0, Math.PI * 2);
    g.fill();

    // 体
    g.fillStyle = `hsl(${210 + beatPulse * 30}, 70%, ${58 + beatPulse * 12}%)`;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();

    // 目
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(cx - 24, cy - 12, 15, 0, Math.PI * 2);
    g.arc(cx + 24, cy - 12, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#12141c";
    g.beginPath();
    g.arc(cx - 22, cy - 10, 7, 0, Math.PI * 2);
    g.arc(cx + 26, cy - 10, 7, 0, Math.PI * 2);
    g.fill();
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
    const avg =
      recentDiffs.length > 0
        ? recentDiffs.reduce((a, b) => a + b, 0) / recentDiffs.length
        : 0;
    lines.push("avg diff: " + avg.toFixed(1) + "ms");
    lines.push("diffs(直近10):");

    // 較正ボタン(DOM)と重ならないよう少し下げる
    const oy = 96;
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillRect(8, oy, 360, 30 + (lines.length + recentDiffs.length) * 22);
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
    _gotoTest: gotoTest,
    _gotoCalibration: gotoCalibration,
  };
})();
