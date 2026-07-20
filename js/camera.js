// ================================================================
// camera.js : スマホ/PCのカメラを起動・切り替えするためのファイル
//
// ・デフォルトは「そとカメラ(背面カメラ)」
// ・トグルスイッチで「じぶんカメラ(インカメラ)」に切り替えできる
// ・インカメラのときは鏡のように左右反転して表示する
// ================================================================

export class CameraManager {
  /**
   * @param {HTMLVideoElement} videoElement カメラ映像を映す <video> タグ
   */
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;            // 現在使っているカメラの映像ストリーム
    this.facing = "environment";   // "environment"=そとカメラ / "user"=インカメラ
  }

  /** インカメラを使っているか?(true なら鏡表示にする) */
  get isMirrored() {
    return this.facing === "user";
  }

  /**
   * カメラを起動する
   * @param {string} facing "environment"(そと) または "user"(じぶん)
   */
  async start(facing = "environment") {
    // すでにカメラが動いていたら、いったん止める(カメラの二重起動を防ぐ)
    this.stop();

    this.facing = facing;

    // カメラに「こういう映像がほしい」とお願いする設定
    const constraints = {
      video: {
        facingMode: facing,              // どちら向きのカメラを使うか
        width:  { ideal: 1280 },         // 横 1280px くらいがほしい(理想値)
        height: { ideal: 720 },
      },
      audio: false,                      // 音声は使わない
    };

    try {
      // ブラウザにカメラの使用許可をもらって映像を取得する
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      // 指定した向きのカメラが無い場合など → どのカメラでもいいので再挑戦
      console.warn("指定したカメラが使えないため、使えるカメラで起動します", e);
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    // 取得した映像を <video> タグに流し込んで再生する
    this.video.srcObject = this.stream;
    await this.video.play();

    // インカメラのときだけ鏡のように左右反転するCSSクラスを付ける
    this.video.classList.toggle("mirror", this.isMirrored);
  }

  /** そとカメラ ⇔ インカメラ を切り替える */
  async toggle() {
    const next = this.facing === "environment" ? "user" : "environment";
    await this.start(next);
  }

  /** カメラを停止する */
  stop() {
    if (this.stream) {
      // カメラの映像トラックをすべて止める(カメラのランプが消える)
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}
