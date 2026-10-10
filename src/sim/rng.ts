/** Small, fast, seedable PRNG (mulberry32). Same seed → same sequence. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Exponentially distributed interval for a Poisson process of `rate` events per second. */
  exponential(rate: number): number {
    return -Math.log(1 - this.next()) / rate;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
