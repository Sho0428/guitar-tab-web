class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input[0]) {
        // 無音は送らない
        let sum = 0;
        for (let i = 0; i < input[0].length; i++) sum += input[0][i] ** 2;
        const rms = Math.sqrt(sum / input[0].length);
        if (rms > 0.001) {
          this.port.postMessage(input[0]);
        }
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
