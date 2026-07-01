/**
 * This file can be edited to customize webpack configuration.
 * To reset delete this file and rerun theia build again.
 */
// @ts-check
const configs = require('./gen-webpack.config.js');
const nodeConfig = require('./gen-webpack.node.config.js');

/**
 * Expose bundled modules on window.theia.moduleName namespace, e.g.
 * window['theia']['@theia/core/lib/common/uri'].
 * Such syntax can be used by external code, for instance, for testing.
configs[0].module.rules.push({
    test: /\.js$/,
    loader: require.resolve('@theia/application-manager/lib/expose-loader')
}); */

// onnxruntime-node ships multiple platform-specific .node binaries with the
// same filename, which causes a webpack emit conflict. Externalise it so the
// backend requires it at runtime from node_modules instead.
//
// sharp is an optional dependency of @huggingface/transformers, pulled in only
// by image pipelines we never use (we run feature-extraction + text-generation).
// Bundling it makes webpack choke on sharp's platform-specific @img/* sub-packages.
// Externalise it so it is resolved lazily at runtime from node_modules.
nodeConfig.config.externals = Object.assign({}, nodeConfig.config.externals, {
    'onnxruntime-node': 'commonjs onnxruntime-node',
    'sharp': 'commonjs sharp',
});

module.exports = [
    ...configs,
    nodeConfig.config
];
