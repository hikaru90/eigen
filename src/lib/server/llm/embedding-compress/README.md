# Vendored embedding compress

Deterministic prose compression logic adapted from [cavemem](https://github.com/JuliusBrussee/cavemem) (`packages/compress`, MIT). Used only to shrink strings sent to the embedding API; upstream `lexicon.json` and core algorithms are copied to avoid an npm dependency on `@cavemem/compress`.
