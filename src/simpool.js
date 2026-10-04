// A pool of workers that run whole throws in parallel (one per spare CPU core).
// Without worker support the throws run on the main thread instead.
import { makeBottle, step } from './sim.js';

const size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
let workers = null, queue = [], nextId = 0;
const pending = new Map();

function start() {
  if (workers) return;
  workers = [];
  try {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => {
        w.busy = false;
        const cb = pending.get(e.data.id);
        pending.delete(e.data.id);
        if (cb) cb(e.data.res);
        pump();
      };
      workers.push(w);
    }
  } catch (err) {
    workers = [];
  }
}

function pump() {
  for (const w of workers) {
    if (w.busy || !queue.length) continue;
    const job = queue.shift();
    w.busy = true;
    pending.set(job.id, job.cb);
    w.postMessage({ id: job.id, p: job.p });
  }
}

// Resolves with {outcome, airAng}, or with null if the throw was dropped from the queue by cancelQueued().
export function runThrow(p) {
  start();
  if (!workers.length) {
    return new Promise((res) => setTimeout(() => {
      const b = makeBottle(p);
      while (!b.done) step(b);
      res({ outcome: b.outcome, airAng: b.airAng });
    }, 0));
  }
  return new Promise((res) => { queue.push({ id: nextId++, p, cb: res }); pump(); });
}

// Drops the throws that have not started yet. Throws already running finish and their results are delivered.
export function cancelQueued() {
  const q = queue;
  queue = [];
  for (const j of q) j.cb(null);
}
