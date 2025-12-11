(() => {
  const BLOCK = 2048;
  const SAMPLE_RATE = 44100;
  let FMIN = 50;
  let FMAX = 800;
  const OPEN_STRINGS = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];
  const TOLERANCES = {6:5, 5:5, 4:7, 3:10, 2:12, 1:15};

  const freqTable = [];
  for (let string = 6; string >= 1; string--) {
    const base = OPEN_STRINGS[6 - string];
    for (let fret = 0; fret <= 3; fret++) {
      freqTable.push({ string, fret, freq: base * Math.pow(2, fret / 12) });
    }
  }

  const freqLabel = document.getElementById('freq');
  const tabEl = document.getElementById('tab');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');

  let tabLines = ["E|","A|","D|","G|","B|","E|"];
  function updateTAB(string, fret) {
    const idx = 6 - string;
    for (let i = 0; i < 6; i++) tabLines[i] += (i === idx ? fret : "-");
    tabEl.textContent = tabLines.map(l => l.slice(-30)).join("\n");
  }

  function findClosest(f0) {
    if (!f0) return null;
    const c = freqTable.reduce((a, b) => Math.abs(a.freq - f0) < Math.abs(b.freq - f0) ? a : b);
    if (Math.abs(c.freq - f0) > TOLERANCES[c.string]) return null;
    return c;
  }

  function yin(buffer, threshold = 0.15, sampleRate = SAMPLE_RATE) {
    const tauMax = Math.min(Math.floor(sampleRate / FMIN), buffer.length - 1);
    const tauMin = Math.max(2, Math.floor(sampleRate / FMAX));
    const yinBuffer = new Float64Array(tauMax + 1);

    for (let t = tauMin; t <= tauMax; t++) {
      let sum = 0;
      for (let i = 0; i < buffer.length - t; i++) {
        const diff = buffer[i] - buffer[i + t];
        sum += diff * diff;
      }
      yinBuffer[t] = sum;
    }

    let runningSum = 0;
    for (let t = tauMin; t <= tauMax; t++) {
      runningSum += yinBuffer[t];
      yinBuffer[t] = yinBuffer[t] * t / runningSum;
    }

    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (yinBuffer[t] < threshold) {
        tau = t;
        break;
      }
    }
    if (tau === -1) return null;

    if (tau + 1 <= tauMax && tau - 1 >= tauMin) {
      const x0 = yinBuffer[tau - 1];
      const x1 = yinBuffer[tau];
      const x2 = yinBuffer[tau + 1];
      const a = (x0 + x2 - 2 * x1) / 2;
      const b = (x2 - x0) / 2;
      if (a) tau = tau - b / (2 * a);
    }
    return sampleRate / tau;
  }

  let audioContext = null;
  let workletNode = null;
  let mediaStream = null;

  const ring = new Float32Array(BLOCK * 2);
  let ringWrite = 0;
  let ringCount = 0;
  const recentNotes = [];
  const RECENT_MAX = 6;

  function pushToRing(chunk) {
    for (let i = 0; i < chunk.length; i++) ring[(ringWrite + i) % ring.length] = chunk[i];
    ringWrite = (ringWrite + chunk.length) % ring.length;
    ringCount = Math.min(ringCount + chunk.length, ring.length);
  }

  function readBlock() {
    if (ringCount < BLOCK) return null;
    const out = new Float32Array(BLOCK);
    let start = (ringWrite - BLOCK + ring.length) % ring.length;
    for (let i = 0; i < BLOCK; i++) out[i] = ring[(start + i) % ring.length];
    ringCount = Math.max(0, ringCount - Math.floor(BLOCK / 2));
    return out;
  }

  function handleIncomingChunk(chunk) {
    const arr = (chunk instanceof Float32Array) ? chunk : Float32Array.from(chunk);
    pushToRing(arr);
    const block = readBlock();
    if (!block) return;

    // 音量バー
    let rms = 0;
    for (let i = 0; i < block.length; i++) rms += block[i] ** 2;
    rms = Math.sqrt(rms / block.length);
    const volumePercent = Math.min(100, rms * 400);
    document.getElementById("volume-bar").style.width = volumePercent + "%";
    document.getElementById("vu-meter").style.width = volumePercent + "%";

    const f0 = yin(block, 0.15, audioContext.sampleRate || SAMPLE_RATE);
    if (!f0 || isNaN(f0) || f0 <= 0) return;
    freqLabel.textContent = `${f0.toFixed(1)} Hz`;

    const n = findClosest(f0);
    if (!n) return;

    recentNotes.push(`${n.string}-${n.fret}`);
    if (recentNotes.length > RECENT_MAX) recentNotes.shift();

    const counts = {};
    for (const r of recentNotes) counts[r] = (counts[r] || 0) + 1;
    const best = Object.entries(counts).find(([k, v]) => v >= 1); // 1にして即反映
    if (!best) return;

    const [s, f] = best[0].split('-').map(Number);
    updateTAB(s, f);
  }

  async function startAudio() {
    if (audioContext) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.audioWorklet.addModule('processor.js');

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioContext.createMediaStreamSource(mediaStream);
      workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
      workletNode.port.onmessage = (e) => handleIncomingChunk(e.data);

      source.connect(workletNode);

      startBtn.disabled = true;
      stopBtn.disabled = false;
      startBtn.textContent = '実行中…';
      startBtn.style.background = '#aa0000';
      startBtn.style.cursor = 'not-allowed';
    } catch (err) {
      console.error(err);
      alert('マイク初期化エラー。コンソールを確認してください。');
      cleanup();
    }
  }

  function stopAudio() {
    if (!audioContext) return;
    try {
      if (workletNode) {
        workletNode.port.onmessage = null;
        workletNode.disconnect?.();
        workletNode = null;
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
      }
      audioContext.close?.();
    } catch (err) {
      console.warn(err);
    } finally {
      cleanup();
    }
  }

const fminSlider = document.getElementById("fmin-slider");
const fmaxSlider = document.getElementById("fmax-slider");
const fminValue = document.getElementById("fmin-value");
const fmaxValue = document.getElementById("fmax-value");

fminSlider.addEventListener("input", () => {
    FMIN = Number(fminSlider.value);
    fminValue.textContent = FMIN;
});
fmaxSlider.addEventListener("input", () => {
    FMAX = Number(fmaxSlider.value);
    fmaxValue.textContent = FMAX;
});

function yin(buffer, threshold = 0.15, sampleRate = SAMPLE_RATE) {
    const tauMax = Math.min(Math.floor(sampleRate / FMIN), buffer.length - 1);
    const tauMin = Math.max(2, Math.floor(sampleRate / FMAX));
    // ... 既存の差分計算や累積平均など
}

  function cleanup() {
    audioContext = null;
    workletNode = null;
    ringWrite = 0;
    ringCount = 0;
    recentNotes.length = 0;

    startBtn.disabled = false;
    stopBtn.disabled = true;
    startBtn.textContent = '▶ 開始';
    startBtn.style.background = '#008000';
    startBtn.style.cursor = 'pointer';
  }

  startBtn.addEventListener('click', startAudio);
  stopBtn.addEventListener('click', stopAudio);

  cleanup();
})();
