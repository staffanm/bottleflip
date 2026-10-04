// Runs whole throws for the score search and the long-press solve, off the main thread.
import { makeBottle, step } from './sim.js';

self.onmessage = (e) => {
  const { id, p } = e.data;
  const b = makeBottle(p);
  while (!b.done) step(b);
  self.postMessage({ id, res: { outcome: b.outcome, airAng: b.airAng } });
};
