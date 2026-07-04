// conductor.js … 音楽時計・拍スケジューラ・判定・較正(最重要)
// 【鉄則】拍・タイミングの計算に使う時計は SFX.ctx.currentTime のみ。
// setTimeout/performance.now/rAFタイムスタンプを拍計算に使わない(setIntervalは予約トリガーのみ)。

const Conductor = (() => {
  // 先読みスケジューラ(Chris Wilson方式)のパラメータ
  const SCHEDULE_INTERVAL_MS = 25;   // setInterval周期
  const SCHEDULE_LOOKAHEAD_S = 0.1;  // この秒数だけ先の拍まで予約する

  let bpm = 120;
  let offset = 0;        // 1拍目までの秒数(メトロノームは0)
  let startTime = 0;     // 拍0が基準になる開始時刻(ctx時刻)
  let running = false;

  let calibrationMs = 0; // 較正値(ms)。入力側の遅れ補正に使う

  let schedulerId = null; // setIntervalハンドル
  let nextScheduleBeat = 0; // 次に予約すべき拍番号
  let judgedBeats = null;   // 判定済み拍番号(Set)。二重判定防止用

  // 拍nが「実際に音が鳴る」ctx絶対時刻(較正適用前)
  function beatTime(n) {
    return startTime + offset + n * 60 / bpm;
  }

  // 現在の拍位置(小数)。較正値を差し引いて計算する。
  function currentBeat() {
    const t = SFX.ctx.currentTime - calibrationMs / 1000;
    return (t - startTime - offset) * bpm / 60;
  }

  // 先読み予約:今から SCHEDULE_LOOKAHEAD_S 以内に鳴る拍を SFX.click で予約
  function scheduleAhead() {
    const now = SFX.ctx.currentTime;
    const beatsPerBar = CONFIG.METRONOME.BEATS_PER_BAR;
    while (beatTime(nextScheduleBeat) < now + SCHEDULE_LOOKAHEAD_S) {
      const t = beatTime(nextScheduleBeat);
      // 過ぎてしまった拍(開始直後の取りこぼし)は鳴らさずスキップ
      if (t >= now) {
        SFX.click(t, nextScheduleBeat % beatsPerBar === 0);
      }
      nextScheduleBeat++;
    }
  }

  // 開始。startDelayぶん未来を拍0の基準にする(較正・タイトルからの余裕)。
  function start({ bpm: b, offset: o, startDelay } = {}) {
    bpm = b || CONFIG.METRONOME.BPM;
    offset = o || 0;
    startTime = SFX.ctx.currentTime + (startDelay || 0);
    running = true;
    nextScheduleBeat = 0;
    judgedBeats = new Set();
    if (schedulerId !== null) clearInterval(schedulerId);
    scheduleAhead();
    schedulerId = setInterval(scheduleAhead, SCHEDULE_INTERVAL_MS);
  }

  function stop() {
    running = false;
    if (schedulerId !== null) {
      clearInterval(schedulerId);
      schedulerId = null;
    }
  }

  // 判定。inputCtxTime は入力ハンドラで捕まえた SFX.ctx.currentTime。
  // 戻り値 {verdict, beat, diffMs[, double]}
  function judge(inputCtxTime) {
    if (!running) return { verdict: "MISS", beat: -1, diffMs: 0 };

    // 較正適用:入力を calibrationMs ぶん過去にずらして拍に合わせる
    const t = inputCtxTime - calibrationMs / 1000;

    // 最寄りの拍番号
    let n = Math.round((t - startTime - offset) * bpm / 60);
    if (n < 0) n = 0;

    const diffMs = (t - beatTime(n)) * 1000; // 負=はやい / 正=おそい

    // 同一拍への二重判定防止
    if (judgedBeats.has(n)) {
      return { verdict: "MISS", beat: n, diffMs, double: true };
    }
    judgedBeats.add(n);

    const a = Math.abs(diffMs);
    let verdict;
    if (a <= CONFIG.JUDGE.PERFECT_MS) verdict = "PERFECT";
    else if (a <= CONFIG.JUDGE.GOOD_MS) verdict = "GOOD";
    else verdict = "MISS";

    return { verdict, beat: n, diffMs };
  }

  // 較正値の取得/設定。設定時はSAVEへ永続化。
  function getCalibration() {
    return calibrationMs;
  }
  function setCalibration(ms) {
    calibrationMs = ms;
    SAVE.data.calibrationMs = ms;
    SAVE.save();
  }
  // 保存はせず一時的に反映(スライダーのドラッグ中など)
  function previewCalibration(ms) {
    calibrationMs = ms;
  }

  return {
    start,
    stop,
    currentBeat,
    beatTime,
    judge,
    getCalibration,
    setCalibration,
    previewCalibration,
    get bpm() { return bpm; },
    get running() { return running; },
  };
})();
