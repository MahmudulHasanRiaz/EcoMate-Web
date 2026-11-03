'use strict';
/**
 * deepmerge v4 API compatibility shim, powered by deepmerge-ts.
 *
 * Why this exists: the original `deepmerge` package is unmaintained
 * (last release 4.3.1, 2023) and carries a Dependabot advisory with no
 * patched version. Its maintained successor, deepmerge-ts, has the same
 * merge semantics (deep merge of plain objects, array concatenation,
 * no target mutation) but a different export shape (named exports only),
 * so it cannot be aliased directly: the consumers in this repo
 * (jest-config, fork-ts-checker-webpack-plugin, @rollup/plugin-node-resolve)
 * require a callable function with an `.all` method.
 *
 * This shim provides exactly that shape on top of deepmerge-ts:
 *   const merge = require('deepmerge');
 *   merge(target, source);        // -> deepmerge-ts deepmerge(target, source)
 *   merge.all([a, b, c]);         // -> sequential deepmerge
 *
 * Deliberate limitation: deepmerge v4's `options` argument
 * (arrayMerge / customMerge / isMergeableObject overrides) is not
 * supported, because deepmerge-ts has fixed semantics. None of the
 * consumers in this repo pass options (verified in their shipped code);
 * if a future consumer does, it must migrate to deepmerge-ts directly.
 */
const { deepmerge } = require('deepmerge-ts');

function merge(target, source) {
  return deepmerge(target, source);
}

merge.all = function all(objects) {
  return objects.reduce((acc, obj) => deepmerge(acc, obj), {});
};

module.exports = merge;
module.exports.default = merge;
