// ================================================================
// hand-tracker.js : カメラ映像から「手のひら」を見つけるファイル
//
// Google の MediaPipe というライブラリを使って、手の21個の
// 関節ポイント(ランドマーク)をリアルタイムで検出します。
//
//   関節ポイントの番号(よく使うもの):
//     0 = 手首 / 5・9・13・17 = 指の付け根 / 8・12・16・20 = 指先
// ================================================================

import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

export class HandTracker {
  constructor() {
    this.landmarker = null;   // MediaPipe の手検出器(init() で作る)
    this.lastVideoTime = -1;  // 同じフレームを2回処理しないための記録
    this.lastResult = { found: false };
  }

  /**
   * 手検出器を準備する(少し時間がかかるので読み込み中表示を出すこと)
   * インターネットから AI モデルをダウンロードします
   */
  async init() {
    // MediaPipe の実行に必要なファイル(WASM)を CDN から読み込む
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    // 手検出器を作成する
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        // 手を見つけるためのAIモデル(Googleが公開しているもの)
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",        // GPUを使って高速に処理する
      },
      runningMode: "VIDEO",     // 動画(カメラ)モードで動かす
      numHands: 1,              // 検出する手は1つだけ
    });
  }

  /**
   * カメラ映像の今のフレームから手を検出する(毎フレーム呼ぶ)
   * @param {HTMLVideoElement} video カメラ映像
   * @param {number} timestampMs 現在時刻(ミリ秒)
   * @returns {{found: boolean, cx?: number, cy?: number, size?: number, isOpen?: boolean}}
   *   found  : 手が見つかったか
   *   cx, cy : 手のひら中心の位置(映像内の割合 0.0〜1.0)
   *   size   : 手の大きさ(0.0〜1.0。カメラに近いほど大きい)
   *   isOpen : 手のひらをパーに開いているか
   */
  detect(video, timestampMs) {
    // 準備がまだ・映像がまだ映っていない場合は「見つからない」を返す
    if (!this.landmarker || video.readyState < 2) {
      return { found: false };
    }

    // 映像が前回と同じフレームなら、前回の結果をそのまま使う(無駄な処理を省く)
    if (video.currentTime === this.lastVideoTime) {
      return this.lastResult;
    }
    this.lastVideoTime = video.currentTime;

    // ここで実際に手を検出する
    const result = this.landmarker.detectForVideo(video, timestampMs);

    // 手が1つも見つからなかった場合
    if (!result.landmarks || result.landmarks.length === 0) {
      this.lastResult = { found: false };
      return this.lastResult;
    }

    // 最初に見つかった手の関節ポイント21個(x, y は 0.0〜1.0 の割合)
    const lm = result.landmarks[0];

    // --- 手のひらの中心を計算する ---
    // 手首(0)と4本の指の付け根(5, 9, 13, 17)の平均 = だいたい手のひらの真ん中
    const palmPoints = [lm[0], lm[5], lm[9], lm[13], lm[17]];
    let cx = 0, cy = 0;
    for (const p of palmPoints) {
      cx += p.x;
      cy += p.y;
    }
    cx /= palmPoints.length;
    cy /= palmPoints.length;

    // --- 手の大きさを計算する ---
    // 手首(0)から中指の付け根(9)までの距離。カメラに近いほど大きくなる
    const size = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);

    // --- 手をパーに開いているか調べる ---
    // 「指先が指の第2関節より手首から遠い」なら、その指は伸びていると判断
    // 4本の指(人差し指〜小指)のうち3本以上伸びていたら「パー」とみなす
    const wrist = lm[0];
    const fingers = [
      [6, 8],    // 人差し指 [第2関節, 指先]
      [10, 12],  // 中指
      [14, 16],  // 薬指
      [18, 20],  // 小指
    ];
    let openCount = 0;
    for (const [pip, tip] of fingers) {
      const distTip = Math.hypot(lm[tip].x - wrist.x, lm[tip].y - wrist.y);
      const distPip = Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y);
      if (distTip > distPip) openCount++;
    }
    const isOpen = openCount >= 3;

    this.lastResult = { found: true, cx, cy, size, isOpen };
    return this.lastResult;
  }
}
