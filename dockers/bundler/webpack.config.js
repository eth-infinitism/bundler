const path = require('path')
const { IgnorePlugin, ProvidePlugin } = require('webpack')

module.exports = {
  plugins: [
    new IgnorePlugin({ resourceRegExp: /electron/ }),
    new IgnorePlugin({ resourceRegExp: /^scrypt$/ }),
    new IgnorePlugin({ resourceRegExp: /solidity-analyzer/ }),
    new IgnorePlugin({ resourceRegExp: /fsevents/ }),
    new ProvidePlugin({
      WebSocket: 'ws',
      fetch: ['node-fetch', 'default'],
    }),
  ],
  resolve: {
    alias: {
      // the packages below has a "browser" and "main" entry. Unfortunately, webpack uses the "browser" entry,
      // even through we explicitly use set "target: node"
      // (see https://github.com/webpack/webpack/issues/4674)
      '@ethersproject/random': path.resolve(__dirname, '../../node_modules/@ethersproject/random/lib/index.js'),
      '@ethersproject/base64': path.resolve(__dirname, '../../node_modules/@ethersproject/base64/lib/index.js'),
      'ethereum-cryptography/secp256k1': path.resolve(__dirname, '../../node_modules/@ethereumjs/util/node_modules/ethereum-cryptography/secp256k1-compat.js')
    },
  },
  target: 'node',
  entry: '../../packages/bundler/dist/src/exec.js',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundler.js'
  },
  stats: 'errors-only'
}
