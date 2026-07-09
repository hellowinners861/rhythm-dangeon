// conductor.js … 音楽時計・拍スケジューラ・判定・較正(最重要)
// 【鉄則】拍・タイミングの計算に使う時計は SFX.ctx.currentTime のみ。
// setTimeout/performance.now/rAFタイムスタンプを拍計算に使わない(setIntervalは予約トリガーのみ)。
//
// 2つのモードを持つ:
//   ・メトロノームモード（start）… 較正用。クリック音を先読み予約で鳴らす。offset=0。
//   ・楽曲モード（startSong）    … 曲を AudioBufferSource で鳴らし、譜面区間で判定を変える。
//   どちらも拍の時計は SFX.ctx.currentTime のみで、ソースの再生位置は参照しない。

const Conductor = (() => {
  // 先読みスケジューラ(Chris Wilson方式)のパラメータ(メトロノーム用)
  const SCHEDULE_INTERVAL_MS = 25;   // setInterval周期
  const SCHEDULE_LOOKAHEAD_S = 0.1;  // この秒数だけ先の拍まで予約する

  let bpm = 120;
  let offset = 0;        // 1拍目までの秒数(メトロノームは0)
  let startTime = 0;     // 拍0が基準になる開始時刻(ctx時刻)
  let running = false;

  let calibrationMs = 0; // 較正値(ms)。入力側の遅れ補正に使う

  let schedulerId = null; // setIntervalハンドル(メトロノーム)
  let nextScheduleBeat = 0; // 次に予約すべき拍番号
  let judgedGrid = null;    // 判定済みグリッド点(Set)。二重判定防止用。キーは半拍単位の整数

  // --- 楽曲モードの状態 ---
  let song = null;        // 現在の曲データ(songs.js の1要素)
  let buffer = null;      // デコード済み AudioBuffer
  let sourceNode = null;  // 再生中の AudioBufferSourceNode
  let totalBeats = 0;     // 曲の総拍数(譜面ループの基準)
  let songLoaded = false; // buffer のデコードに成功したか
  let songMode = false;   // 現在楽曲モードで走っているか
  let pausedBeat = 0;     // pauseSongで保存した中断時の拍位置(resumeSongで続きから再開するため)

  // 曲バッファのキャッシュ(id→{buffer,totalBeats})。2回目以降のloadSongは再デコードしない(曲選択・Step9改修)。
  const songCache = new Map();

  // 拍nが「実際に音が鳴る」ctx絶対時刻(較正適用前)。nは小数可(グリッド点用)。
  function beatTime(n) {
    return startTime + offset + n * 60 / bpm;
  }

  // 現在の拍位置(小数)。較正値を差し引いて計算する。
  function currentBeat() {
    const t = SFX.ctx.currentTime - calibrationMs / 1000;
    return (t - startTime - offset) * bpm / 60;
  }

  // 譜面参照用の拍位置(曲ループを totalBeats で折り返した値)。
  function chartBeat() {
    const b = currentBeat();
    if (!totalBeats) return b;
    return ((b % totalBeats) + totalBeats) % totalBeats;
  }

  // 指定拍が属する譜面区間を返す。楽曲モードでない(メトロノーム/較正/フォールバック)時は
  // 譜面を参照せず div:1 扱いにする(較正の判定・ノーツを整数拍のみに保つ)。
  function sectionAt(beat) {
    if (!songMode || !song || !song.chart || !totalBeats) return { div: 1 };
    const cb = ((beat % totalBeats) + totalBeats) % totalBeats;
    for (const s of song.chart) {
      if (cb >= s.from && cb < s.to) return s;
    }
    return { div: 1 };
  }

  // 指定拍の行動グリッド刻み(拍)。div=2→0.5 / div=1→1 / div=0(休符)→null。
  function gridAt(beat) {
    const s = sectionAt(beat);
    if (s.div === 0) return null;
    return s.div === 2 ? 0.5 : 1;
  }

  // 先読み予約:今から SCHEDULE_LOOKAHEAD_S 以内に鳴る拍を SFX.click で予約(メトロノーム専用)
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

  // メトロノーム開始(較正用)。startDelayぶん未来を拍0の基準にする。
  function start({ bpm: b, offset: o, startDelay } = {}) {
    stop(); // 走行中のソース・スケジューラを止める
    bpm = b || CONFIG.METRONOME.BPM;
    offset = o || 0;
    startTime = SFX.ctx.currentTime + (startDelay || 0);
    running = true;
    songMode = false;
    nextScheduleBeat = 0;
    judgedGrid = new Set();
    scheduleAhead();
    schedulerId = setInterval(scheduleAhead, SCHEDULE_INTERVAL_MS);
  }

  // 楽曲(songs.js の要素)を読み込みデコードする。async。成功でtrue。
  // 一度デコードした曲は songCache(id→{buffer,totalBeats})に保持し、2回目以降は再デコードしない(曲選択・Step9改修)。
  // 失敗時はコンソール警告し、呼び出し側はメトロノームへフォールバックする。
  async function loadSong(s) {
    song = s;
    const cached = songCache.get(s.id);
    if (cached) {
      buffer = cached.buffer;
      totalBeats = cached.totalBeats;
      songLoaded = true;
      return true;
    }
    buffer = null;
    songLoaded = false;
    totalBeats = 0;
    try {
      const res = await fetch(s.audio);
      const arr = await res.arrayBuffer();
      buffer = await SFX.ctx.decodeAudioData(arr);
      const beatSec = 60 / s.bpm;
      totalBeats = Math.floor((buffer.duration - s.offset) / beatSec);
      songLoaded = true;
      songCache.set(s.id, { buffer, totalBeats });
      return true;
    } catch (e) {
      console.warn("楽曲ロード失敗(メトロノームにフォールバック):", e);
      buffer = null;
      songLoaded = false;
      // 譜面の末尾 to を総拍数の概算に使う(フォールバックの生成用)
      if (s && s.chart && s.chart.length) totalBeats = s.chart[s.chart.length - 1].to;
      return false;
    }
  }

  // 楽曲モード開始。buffer を loop 再生し、拍計算を曲の bpm/offset で始める。
  // buffer 未ロード時はメトロノームへフォールバック。
  function startSong({ startDelay } = {}) {
    if (!buffer || !song) {
      start({ bpm: song ? song.bpm : undefined, offset: 0, startDelay });
      return;
    }
    stop();
    bpm = song.bpm;
    offset = song.offset || 0;
    startTime = SFX.ctx.currentTime + (startDelay || 0);
    running = true;
    songMode = true;
    pausedBeat = 0;
    judgedGrid = new Set();
    // 楽曲モードではメトロノームスケジューラは使わない(クリック音を鳴らさない)
    // ループ区間を「offset〜offset+総拍数ぶん」に固定し、譜面ループ(beat % totalBeats)と
    // 音声の周期を完全に一致させる(2周目以降のズレ防止。ボス戦は曲を複数周する)
    const beatSec = 60 / bpm;
    sourceNode = SFX.playBuffer(buffer, startTime, {
      loop: true,
      loopStart: offset,
      loopEnd: offset + totalBeats * beatSec,
    });
  }

  // 楽曲モードを一時停止する(タブ離脱時のポーズ用)。
  // 現在の拍位置(pausedBeat)を保存してからソースを止める。戻り値は保存した pausedBeat。
  // 楽曲モードでない(メトロノーム/未再生)ときは何もせず null を返す。
  function pauseSong() {
    if (!songMode || !buffer || !song) return null;
    const pb = currentBeat();
    stop();          // ソース停止・running=false・songMode=false(この中で pausedBeat は0に戻る)
    pausedBeat = pb; // stop後に保存し直して上書きを防ぐ
    return pb;
  }

  // 一時停止した楽曲を pausedBeat から続きで再開する(startDelay ぶん未来を再開時刻にする)。
  // 拍の連続性: 再開完了時刻 when に currentBeat()===pausedBeat となるよう startTime を逆算する。
  // 音声側は譜面ループ内の対応位置(chartPos)から再生を始め、拍と音の周期を一致させる。
  function resumeSong({ startDelay } = {}) {
    if (!buffer || !song) return;
    const pb = pausedBeat; // stop() で pausedBeat が0に戻るため先に退避
    stop();
    bpm = song.bpm;
    offset = song.offset || 0;
    const beatSec = 60 / bpm;
    const when = SFX.ctx.currentTime + (startDelay || 0);
    // 拍0の基準時刻。when 時点で currentBeat()===pb になる。
    startTime = when - offset - pb * beatSec;
    running = true;
    songMode = true;
    // judgedGrid は維持する(過去拍は判定済みのまま。新規Setにしない)。
    if (!judgedGrid) judgedGrid = new Set();
    // 音声の再開位置:譜面ループ(totalBeats)で折り返した拍を秒に直し、offset を足したところから鳴らす。
    const chartPos = ((pb % totalBeats) + totalBeats) % totalBeats;
    sourceNode = SFX.playBuffer(buffer, when, {
      loop: true,
      loopStart: offset,
      loopEnd: offset + totalBeats * beatSec,
      startOffset: offset + chartPos * beatSec,
    });
  }

  // 停止(メトロノーム・楽曲の両方に対応)。
  function stop() {
    running = false;
    songMode = false;
    pausedBeat = 0;
    if (schedulerId !== null) {
      clearInterval(schedulerId);
      schedulerId = null;
    }
    if (sourceNode) {
      try { sourceNode.stop(); } catch (e) { /* 既に停止済み */ }
      sourceNode = null;
    }
  }
  // 明示的な楽曲停止のエイリアス(指示書の API 名)。
  const stopSong = stop;

  // 判定。inputCtxTime は入力ハンドラで捕まえた SFX.ctx.currentTime。
  // 最寄りの「グリッド点(整数拍または半拍)」に対して判定する。
  // 休符区間(div=0)への入力は REST を返す(ペナルティなし・コンボ維持・拍消費なし)。
  // 戻り値 {verdict, beat, diffMs[, double]}
  function judge(inputCtxTime) {
    if (!running) return { verdict: "MISS", beat: -1, diffMs: 0 };

    // 較正適用:入力を calibrationMs ぶん過去にずらして拍に合わせる
    const t = inputCtxTime - calibrationMs / 1000;

    // 生の拍位置(小数)
    let approx = (t - startTime - offset) * bpm / 60;
    if (approx < 0) approx = 0;

    // 最寄り整数拍の区間で行動グリッドを決める
    const sec = sectionAt(Math.round(approx));
    if (sec.div === 0) {
      // 休符区間:無反応(コンボ・タップ・判定内訳に含めない)
      return { verdict: "REST", beat: Math.round(approx), diffMs: 0 };
    }
    const step = sec.div === 2 ? 0.5 : 1;

    // 最寄りのグリッド点(整数拍 or 半拍)
    let n = Math.round(approx / step) * step;
    if (n < 0) n = 0;

    const diffMs = (t - beatTime(n)) * 1000; // 負=はやい / 正=おそい

    // 同一グリッド点への二重判定防止(半拍単位の整数キー)
    const key = Math.round(n * 2);
    if (judgedGrid.has(key)) {
      return { verdict: "MISS", beat: n, diffMs, double: true };
    }
    judgedGrid.add(key);

    // 装備効果で判定窓を拡張(音符のカチューシャ/ヘッドフォン)。DESIGN §9
    const eqStats = (typeof Equip !== "undefined") ? Equip.stats() : null;
    const perfectMs = CONFIG.JUDGE.PERFECT_MS + (eqStats ? eqStats.perfectWindow : 0);
    const goodMs = CONFIG.JUDGE.GOOD_MS + (eqStats ? eqStats.goodWindow : 0);

    const a = Math.abs(diffMs);
    let verdict;
    if (a <= perfectMs) verdict = "PERFECT";
    else if (a <= goodMs) verdict = "GOOD";
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
    loadSong,
    startSong,
    stopSong,
    pauseSong,
    resumeSong,
    currentBeat,
    chartBeat,
    sectionAt,
    gridAt,
    beatTime,
    judge,
    getCalibration,
    setCalibration,
    previewCalibration,
    get bpm() { return bpm; },
    get running() { return running; },
    get songMode() { return songMode; },
    get songLoaded() { return songLoaded; },
    get totalBeats() { return totalBeats; },
    get currentSong() { return song; },
    // 現在ロード済みの曲のAudioBuffer(ホームBGM用。songCacheの実体をそのまま返す)。未ロードならnull。
    get songBuffer() { return songLoaded ? buffer : null; },
  };
})();
