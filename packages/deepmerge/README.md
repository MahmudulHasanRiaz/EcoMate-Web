# deepmerge (in-repo replacement)

Drop-in replacement for the npm `deepmerge` package, which is unmaintained
(last release 4.3.1 in 2023) and carries a Dependabot advisory with no patched
version. This workspace package satisfies the `^4.2.2` / `^4.3.1` ranges of its
only consumers in this repo — all dev/test tooling: `jest-config`,
`fork-ts-checker-webpack-plugin`, `@rollup/plugin-node-resolve` — so npm links
this package in place of the registry one.

The API surface is exactly deepmerge v4's (a callable `merge(target, source)`
plus `merge.all([...])`), implemented on top of the actively maintained
`deepmerge-ts` engine, whose merge semantics match v4 defaults (deep merge of
plain objects, array concatenation, no target mutation).

Limitation: v4's `options` argument (custom `arrayMerge`, etc.) is not
supported — deepmerge-ts has fixed semantics. No consumer in this repo passes
options (verified in their shipped code, and the full test suite exercises
jest-config's merge paths on every CI run). If a future consumer needs
options, it should migrate to `deepmerge-ts` directly and this shim can be
retired.
