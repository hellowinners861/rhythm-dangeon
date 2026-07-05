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
];
