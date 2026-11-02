import { createRateMeter, describeProgress, formatTimeLeft } from "../uploadRate";
import { concurrencyFor } from "../s3Upload";

test("speed is averaged over the recent window", () => {
  let t = 0;
  const meter = createRateMeter(30000, () => t);
  meter.push(0);
  t = 10000;
  meter.push(50 * 1024 * 1024);
  expect(meter.bytesPerSecond()).toBeCloseTo(5 * 1024 * 1024);
});

test("progress text shows percentage, speed, and time left", () => {
  const text = describeProgress(25, { rate: 5 * 1024 * 1024, remaining: 10 * 1024 * 1024 * 1024 });
  expect(text).toBe("25% · 5.0 MB/s · about 34 min left");
  expect(describeProgress(3, null)).toBe("3%");
  expect(formatTimeLeft(3 * 3600 + 600)).toBe("about 3 h 10 min left");
});

test("large files use all six browser connections", () => {
  expect(concurrencyFor(13 * 1024 ** 3)).toBe(6);
  expect(concurrencyFor(200 * 1024 ** 2)).toBe(4);
});
