// songs/songs.js … 曲リスト+譜面(区間ベース)。譜面は設計者が曲解析に基づいて作成する。
// div: 1=4分(毎拍) / 2=8分(半拍も行動可) / 0=休符(行動不可・敵停止)
// fever: 演出強化区間(背景・レーンが派手になる。コンボフィーバーとは独立)
const SONGS = [
  {
    id: "song01",
    title: "アダチレイ・アダチレイ",
    audio: "songs/song01.mp3",
    bpm: 165,                     // ユーザー確認値(解析の110は3:2の下位候補だった)
    offset: 0.24,                 // 最初の1拍目までの秒数(実測)
    durationSec: 143.99,          // 参考値(実際はデコード結果を使う)
    bpmChanges: [],
    // 165BPMでは8分(div:2)が秒5.5打となり実用不可のため全区間4分。サビはfeverで演出強化
    chart: [
      { from: 0,   to: 24,  div: 1, mood: "intro"  },
      { from: 24,  to: 72,  div: 1, mood: "verse"  },
      { from: 72,  to: 144, div: 1, mood: "chorus", fever: true },
      { from: 144, to: 188, div: 1, mood: "verse"  },
      { from: 188, to: 216, div: 1, mood: "build"  },
      { from: 216, to: 288, div: 1, mood: "chorus", fever: true },
      { from: 288, to: 300, div: 0, mood: "break"  },
      { from: 300, to: 308, div: 1, mood: "build"  },
      { from: 308, to: 372, div: 1, mood: "chorus", fever: true },
      { from: 372, to: 395, div: 1, mood: "outro"  },
    ],
  },
  {
    id: "song02",
    title: "2代目閻魔",
    audio: "songs/song02.mp3",
    bpm: 135,
    offset: 0.06,
    durationSec: 194.93,
    bpmChanges: [],
    chart: [
      { from: 0,   to: 16,  div: 1, mood: "intro"  },
      { from: 16,  to: 124, div: 1, mood: "verse"  },
      { from: 124, to: 160, div: 2, mood: "chorus", fever: true },
      { from: 160, to: 200, div: 1, mood: "verse"  },
      { from: 200, to: 204, div: 0, mood: "break"  },
      { from: 204, to: 320, div: 1, mood: "verse"  },
      { from: 320, to: 360, div: 2, mood: "chorus", fever: true },
      { from: 360, to: 424, div: 1, mood: "verse"  },
      { from: 424, to: 438, div: 1, mood: "outro"  },
    ],
  },
  {
    id: "song03",
    title: "夜明けと蛍",
    audio: "songs/song03.mp3",
    bpm: 80,                      // ユーザー指定値(解析でも79〜81が上位で一致。160は2倍系)
    offset: 0.61,                 // 最初の1拍目までの秒数(トリム後基準。実測0.11+2拍-1.0秒)
    trimSec: 1.0,                 // 冒頭1秒をデコード時にカットする(ユーザー指定・差し替え版)
    durationSec: 309.08,          // 参考値(トリム後。実際はデコード結果を使う)
    bpmChanges: [],
    // 80BPMは4分が緩やかなので、サビ(RMSの山)は8分(div:2)で密度を上げる(160打/分は判定窓的に問題なし)
    chart: [
      { from: 0,   to: 16,  div: 1, mood: "intro"  },
      { from: 16,  to: 48,  div: 1, mood: "verse"  },
      { from: 48,  to: 76,  div: 1, mood: "build"  },
      { from: 76,  to: 96,  div: 1, mood: "verse"  },
      { from: 96,  to: 128, div: 1, mood: "chorus" },
      { from: 128, to: 160, div: 2, mood: "chorus", fever: true },
      { from: 160, to: 212, div: 1, mood: "verse"  },
      { from: 212, to: 216, div: 0, mood: "break"  },
      { from: 216, to: 252, div: 2, mood: "chorus", fever: true },
      { from: 252, to: 284, div: 1, mood: "verse"  },
      { from: 284, to: 308, div: 1, mood: "bridge" },
      { from: 308, to: 336, div: 1, mood: "build"  },
      { from: 336, to: 376, div: 2, mood: "chorus", fever: true },
      { from: 376, to: 392, div: 1, mood: "verse"  },
      { from: 392, to: 411, div: 1, mood: "outro"  },
    ],
  },
];
