/**
 * Upload speed and time left, from (time, bytes sent) samples.
 * The speed is averaged over the last 30 seconds so one slow part or a
 * retry does not make the estimate jump around.
 */
export function createRateMeter(windowMs = 30000, now = () => Date.now()) {
  const samples = [];
  return {
    push(bytes) {
      const t = now();
      samples.push([t, bytes]);
      while (samples.length > 2 && t - samples[0][0] > windowMs) samples.shift();
    },
    bytesPerSecond() {
      if (samples.length < 2) return 0;
      const [t0, b0] = samples[0];
      const [t1, b1] = samples[samples.length - 1];
      return t1 > t0 && b1 > b0 ? ((b1 - b0) * 1000) / (t1 - t0) : 0;
    },
    reset() {
      samples.length = 0;
    },
  };
}

export function formatRate(bytesPerSecond) {
  if (!(bytesPerSecond > 0)) return "";
  const mb = bytesPerSecond / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1024)} KB/s`;
}

export function formatTimeLeft(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return "under a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `about ${hours} h ${rest} min left` : `about ${hours} h left`;
}

/** "25% · 4.2 MB/s · about 45 min left" */
export function describeProgress(progress, stats) {
  const parts = [`${progress}%`];
  if (stats && stats.rate) parts.push(formatRate(stats.rate));
  if (stats && stats.rate && stats.remaining > 0) parts.push(formatTimeLeft(stats.remaining / stats.rate));
  return parts.filter(Boolean).join(" · ");
}
