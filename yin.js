function yin(buffer, threshold = 0.15, sampleRate = 44100) {
    let tauMax = Math.floor(sampleRate / 50);
    let tauMin = Math.floor(sampleRate / 800);

    let yinBuffer = new Array(tauMax).fill(0);

    // 差分
    for (let t = tauMin; t < tauMax; t++) {
        let sum = 0;
        for (let i = 0; i < buffer.length - t; i++) {
            let diff = buffer[i] - buffer[i + t];
            sum += diff * diff;
        }
        yinBuffer[t] = sum;
    }

    // 累積平均
    for (let t = tauMin + 1; t < tauMax; t++) {
        yinBuffer[t] = yinBuffer[t] * t / yinBuffer.slice(1, t + 1).reduce((a, b) => a + b, 0);
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
