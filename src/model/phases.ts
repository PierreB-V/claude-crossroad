/**
 * All maximal sets of mutually compatible movements (maximal cliques of the
 * compatibility graph), found with Bron–Kerbosch with pivoting.
 * These are the candidate phases the genetic algorithm picks from.
 */
export function maximalCompatibleSets(conflicts: readonly boolean[][]): number[][] {
  const n = conflicts.length;
  const neighbours: Set<number>[] = Array.from({ length: n }, (_, v) => {
    const s = new Set<number>();
    for (let u = 0; u < n; u++) if (u !== v && !conflicts[v][u]) s.add(u);
    return s;
  });

  const result: number[][] = [];
  const expand = (r: number[], p: number[], x: number[]) => {
    if (p.length === 0 && x.length === 0) {
      result.push([...r].sort((a, b) => a - b));
      return;
    }
    const pivot = p.length > 0 ? p[0] : x[0];
    const candidates = p.filter((v) => !neighbours[pivot].has(v));
    for (const v of candidates) {
      const nv = neighbours[v];
      expand([...r, v], p.filter((u) => nv.has(u)), x.filter((u) => nv.has(u)));
      p = p.filter((u) => u !== v);
      x = [...x, v];
    }
  };
  if (n > 0) expand([], Array.from({ length: n }, (_, i) => i), []);

  return result.sort((a, b) => b.length - a.length || compareLex(a, b));
}

function compareLex(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
