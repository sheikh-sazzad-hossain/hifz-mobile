// Recitation stopwatch. Pure logic: time comes from differences of a clock (performance.now), never from counting
// ticks, so throttled timers on a phone cannot make it drift. Paused time is never counted.
export function createTimer(clock = () => performance.now()) {
  let acc = 0; // ms gathered before the current running stretch
  let since = null; // clock value when the current stretch began (null = not running)
  let used = false;
  return {
    start() { acc = 0; since = clock(); used = true; this.stopped = false; }, // a new start always resets to 0
    pause() { if (since !== null) { acc += clock() - since; since = null; } },
    resume() { if (used && since === null && !this.stopped) since = clock(); },
    stop() { this.pause(); this.stopped = true; },
    stopped: false,
    get running() { return since !== null; },
    elapsedMs() { return since === null ? acc : acc + (clock() - since); },
  };
}

// 65 s → "01:05"; 3725 s → "1:02:05"
export function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
