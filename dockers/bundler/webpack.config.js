const path = require('path')
const { IgnorePlugin, ProvidePlugin } = require('webpack')

module.exports = {
  plugins: [
    new IgnorePlugin({ resourceRegExp: /electron/ }),
    new IgnorePlugin({ resourceRegExp: /^scrypt$/ }),
    new ProvidePlugin({
      WebSocket: 'ws',
      fetch: ['node-fetch', 'default'],
    }),
  ],
  target: 'node',
  entry: '../../packages/bundler/dist/src/runBundler.js',
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
