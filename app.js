let audioContext;
let workletNode;
let source;

// 弦の基本周波数
const STRINGS = [
    {name:"E", freq:329.63},
    {name:"B", freq:246.94},
    {name:"G", freq:196.00},
    {name:"D", freq:146.83},
    {name:"A", freq:110.00},
    {name:"E", freq:82.41},
];

// ➤ 指板計算
function findClosestStringFret(freq) {
    if (!freq) return null;

    let best = null;
    let minDiff = Infinity;

    STRINGS.forEach((s, idx) => {
        for (let fret = 0; fret <= 20; fret++) {
            const f2 = s.freq * Math.pow(2, fret / 12);
            const diff = Math.abs(f2 - freq);
            if (diff < minDiff) {
                minDiff = diff;
                best = { string: idx, fret };
            }
        }
    });
    return best;
}

// ➤ タブ譜更新
function updateTab(stringIndex, fret) {
    const tab = document.getElementById("tab").innerText.split("\n");
    tab[5 - stringIndex] += `-${fret}-`;
    document.getElementById("tab").innerText = tab.join("\n");
}

// ➤ 音量バー更新
function updateVolume(buffer) {
    let rms = Math.sqrt(buffer.reduce((s, x) => s + x * x, 0) / buffer.length);
    let db = rms * 200; 
    db = Math.min(100, Math.max(0, db));
    document.getElementById("volume-bar").style.width = db + "%";
}

// ➤ 周波数の帯域フィルタ
function bandPass(buffer, minHz, maxHz, sampleRate) {
    const low = minHz / (sampleRate / 2);
    const high = maxHz / (sampleRate / 2);
    const filtered = new Float32Array(buffer.length);
    for (let i = 1; i < buffer.length; i++) {
        let sample = buffer[i];
        if (sample < low || sample > high) sample = 0;
        filtered[i] = sample;
    }
    return filtered;
}

// 🎧 音声開始
async function startAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.audioWorklet.addModule("processor.js");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    source = audioContext.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(audioContext, "audio-processor");

    workletNode.port.onmessage = (e) => {
        const buffer = e.data;

        updateVolume(buffer);

        const minHz = parseInt(document.getElementById("fmin").value);
        const maxHz = parseInt(document.getElementById("fmax").value);

        const f0 = yin(buffer, 0.15, audioContext.sampleRate);

        if (!f0) return;
        if (f0 < minHz || f0 > maxHz) return; // ★ 環境ノイズ除去

        document.getElementById("freq").innerText = f0.toFixed(1) + " Hz";

        const note = findClosestStringFret(f0);
        if (note) updateTab(note.string, note.fret);
    };

    source.connect(workletNode);
}

// 🎧 停止
document.getElementById("stop-btn").onclick = () => {
    if (audioContext) audioContext.close();
};

// スライダー表示更新
document.getElementById("fmin").oninput = (e) =>
    document.getElementById("fmin-label").innerText = e.target.value;

document.getElementById("fmax").oninput = (e) =>
    document.getElementById("fmax-label").innerText = e.target.value;

document.getElementById("start-btn").onclick = startAudio;
