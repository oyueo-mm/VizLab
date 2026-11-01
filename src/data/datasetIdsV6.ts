/** Ids of the datasets added in v0.6 (kept apart so each batch only edits this list). */
export type DatasetIdV6 =
  | 'ml-clusters' | 'ml-moons' | 'ml-spiral' | 'ml-highdim' | 'ml-swissroll' | 'ml-tabular' | 'ml-tokens'
  | 'ts-seasonal' | 'ts-ar2' | 'ts-pair' | 'ts-hourly' | 'bayes-sample' | 'bayes-skewed' | 'bayes-trials' | 'bayes-counts' | 'sbc-design' | 'competing-risks' | 'extreme-annual' | 'joint-demo'
  | 'mandelbrot-sites' | 'julia-presets' | 'newton-z3' | 'newton-z5' | 'newton-nova' | 'zeros-poles-a' | 'zeros-poles-b'
  | 'attractor-params' | 'particles-liquid' | 'particles-fcc' | 'particles-gas' | 'tb-params' | 'tb-params-gapped' | 'phase-bi-cd' | 'phase-sn-pb'
  | 'scalar-metaballs' | 'scalar-orbital' | 'scalar-gyroid' | 'vector-abc' | 'vector-dipole' | 'tensor-dti'
  | 'mol-water' | 'mol-ammonia' | 'mol-methane' | 'mol-ethene' | 'mol-benzene' | 'mol-ethane' | 'mol-co2'
  | 'crystal-nacl' | 'crystal-cu' | 'crystal-fe' | 'crystal-diamond' | 'crystal-cscl' | 'crystal-mg'
  | 'geo-field-iso' | 'geo-field-aniso' | 'events-spacetime' | 'case-control'
