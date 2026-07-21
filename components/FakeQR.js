"use client";
import { useEffect, useRef } from "react";

/** Decorative QR placeholder. Production renders the real QRIS string or pickup code. */
export default function FakeQR({ seed, size = 200 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const n = 25, cell = size / n;
    let h = 0;
    for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#241812";
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const inFinder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
        if (!inFinder && rnd() < 0.45) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    const finder = (ox, oy) => {
      ctx.fillRect(ox, oy, 7 * cell, 7 * cell);
      ctx.fillStyle = "#fff"; ctx.fillRect(ox + cell, oy + cell, 5 * cell, 5 * cell);
      ctx.fillStyle = "#241812"; ctx.fillRect(ox + 2 * cell, oy + 2 * cell, 3 * cell, 3 * cell);
    };
    finder(0, 0); finder((n - 7) * cell, 0); finder(0, (n - 7) * cell);
  }, [seed, size]);
  return <canvas ref={ref} width={size} height={size} />;
}
