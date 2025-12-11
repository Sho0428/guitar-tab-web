// ================================
// 🎧 音声設定
// ================================
let audioCtx;
let analyser;
let gainNode;
let bandpass;
let dataArray;

let lastDetectedTime = 0;
let detectCooldown = 600; // ms クールタイム

// ================================
// 🎸 YIN アルゴリズム
// ================================
function yin(buffer, threshold = 0.15, sampleRate = 44100) {
    let tauMax = Math.floor(sampleRate / FMIN);
    let tauMin = Math.floor(sampleRate / FMAX);

    let yinBuffer = new Array(tauMax).fill(0);

    for (let t = tauMin; t < tauMax; t++) {
        let sum = 0;
        for (let i = 0; i < buffer.length - t; i++) {
            let diff = buffer[i] - buffer[i + t];
            sum += diff * diff;
        }
        yinBuffer[t] = sum;
    }

    for (let t = tauMin + 1; t < tauMax; t++) {
        yinBuffer[t] = yinBuffer[t] * t /
            yinBuffer.slice(1, t + 1).reduce((a, b) => a + b, 0);
    }

    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
        if (yinBuffer[t] < threshold) {
            tau = t;
            break;
        }
    }
    if (tau === -1) return null;

    return sampleRate / tau;
}

let FMIN = 50;
let FMAX = 800;

// スライダー更新
document.getElementById("fmin").addEventListener("input", e => {
    FMIN = Number(e.target.value);
    document.getElementById("fmin-val").textContent = FMIN;
});

document.getElementById("fmax").addEventListener("input", e => {
    FMAX = Number(e.target.value);
    document.getElementById("fmax-val").textContent = FMAX;
});

// ================================
// 🎼 コード判定（簡易）
// ================================
function detectChord(freq) {
    if (!freq) return "---";

    if (freq > 70 && freq < 95) return "E2";
    if (freq >= 95 && freq < 120) return "A2";
    if (freq >= 120 && freq < 160) return "D3";
    if (freq >= 160 && freq < 220) return "G3";
    if (freq >= 220 && freq < 300) return "B3";
    if (freq >= 300 && freq < 450) return "E4";

    return "---";
}

// ================================
// 🔊 メイン処理
// ================================
document.getElementById("start").onclick = async () => {
    audioCtx = new AudioContext();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const source = audioCtx.createMediaStreamSource(stream);

    // 🎯 ① バンドパスフィルタ（環境音を減らす）
    bandpass = audioCtx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 400;
    bandpass.Q.value = 1.2;

    // 🎯 ② ボリューム取得用
    gainNode = audioCtx.createGain();

    // 🎯 ③ 周波数分析ノード
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    const bufferLength = analyser.fftSize;
    dataArray = new Float32Array(bufferLength);

    source.connect(bandpass);
    bandpass.connect(gainNode);
    gainNode.connect(analyser);

    loop();
};

// ================================
// 🔁 ループ処理（音量・周波数・判定）
// ================================
function loop() {
    requestAnimationFrame(loop);

    analyser.getFloatTimeDomainData(dataArray);

    // 🔊 RMS（音量）
    let rms = Math.sqrt(dataArray.reduce((s, v) => s + v * v, 0) / dataArray.length);

    // 🔊 音量バー更新
    document.getElementById("volume-bar").style.width =
        Math.min(100, rms * 3000) + "%";

    // 🎚 Noise Gate — 小さすぎる音は無視
    if (rms < 0.015) {
        document.getElementById("freq").innerText = "-- Hz";
        return;
    }

    // 🎵 周波数検出（YIN）
    const freq = yin(dataArray, 0.15, audioCtx.sampleRate);
    if (!freq) return;

    document.getElementById("freq").innerText = freq.toFixed(1) + " Hz";

    // 🎼 ギター音以外は無視
    if (freq < 70 || freq > 1500) return;

    // 🕒 クールタイム（連続検出防止）
    const now = Date.now();
    if (now - lastDetectedTime < detectCooldown) return;
    lastDetectedTime = now;

    // 🎸 コード判定
    const chord = detectChord(freq);
    document.getElementById("result").innerText = "コード: " + chord;
}
