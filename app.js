(() => {

  // ===== 帯域調整 =====
  let FMIN = 50;
  let FMAX = 800;

  const fminSlider = document.getElementById("fmin");
  const fmaxSlider = document.getElementById("fmax");
  const fminVal = document.getElementById("fmin-val");
  const fmaxVal = document.getElementById("fmax-val");

  fminSlider.addEventListener("input", e => {
    FMIN = Number(e.target.value);
    fminVal.textContent = FMIN;
  });

  fmaxSlider.addEventListener("input", e => {
    FMAX = Number(e.target.value);
    fmaxVal.textContent = FMAX;
  });

  // ===== ギター基準音 =====
  const OPEN_STRINGS = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];
  const TOLERANCES = { 6:5, 5:5, 4:7, 3:10, 2:12, 1:15 };

  const tabEl = document.getElementById("tab");
  const freqLabel = document.getElementById("freq");
  const volumeBar = document.getElementById("volume-bar");

  let tabLines = ["E|","A|","D|","G|","B|","E|"];

  function updateTAB(string, fret) {
    const idx = 6 - string;
    for (let i = 0; i < 6; i++) {
      tabLines[i] += (i === idx ? fret : "-");
    }
    tabEl.textContent = tabLines.map(l => l.slice(-30)).join("\n");
  }

  const freqTable = [];
  for (let string = 6; string >= 1; string--) {
    const base = OPEN_STRINGS[6 - string];
    for (let fret = 0; fret <= 3; fret++) {
      freqTable.push({ string, fret, freq: base * Math.pow(2, fret / 12) });
    }
  }

  function findClosestStringFret(f0) {
    if (!f0) return null;
    const c = freqTable.reduce((a, b) =>
      Math.abs(a.freq - f0) < Math.abs(b.freq - f0) ? a : b
    );
    if (Math.abs(c.freq - f0) > TOLERANCES[c.string]) return null;
    return c;
  }

  // ===== YIN =====
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
      let divisor = yinBuffer.slice(1, t + 1).reduce((a, b) => a + b, 0);
      yinBuffer[t] = yinBuffer[t] * t / divisor;
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

  // ===== 音量バー更新 =====
  function updateVolumeBar(buf) {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);

    let volumePercent = Math.min(100, rms * 400);
    volumeBar.style.width = volumePercent + "%";
  }

  // ===== AudioWorklet =====
  let audioContext = null;
  let mediaStream = null;
  let workletNode = null;

  async function startAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.audioWorklet.addModule("processor.js");

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, "audio-processor");

    workletNode.port.onmessage = (e) => {
      const buf = e.data;

      updateVolumeBar(buf);

      const f0 = yin(buf, 0.15, audioContext.sampleRate);
      if (!f0) return;

      freqLabel.textContent = `${f0.toFixed(1)} Hz`;

      const n = findClosestStringFret(f0);
      if (n) updateTAB(n.string, n.fret);
    };

    source.connect(workletNode);
  }

  document.getElementById("start-btn").onclick = startAudio;
})();
