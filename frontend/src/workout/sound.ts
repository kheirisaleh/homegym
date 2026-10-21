let audioContext: AudioContext | null = null;

export function beep(times = 3, frequency = 880): void {
  try {
    audioContext ??= new AudioContext();
    const context = audioContext;
    for (let index = 0; index < times; index++) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      gain.connect(context.destination);
      const start = context.currentTime + index * 0.28;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      oscillator.start(start);
      oscillator.stop(start + 0.22);
    }
  } catch {
    audioContext = null;
  }
}

export function vibrate(pattern: number | number[]): void {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}
