import path from 'path'
import { fileURLToPath } from 'url'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import CopyWebpackPlugin from 'copy-webpack-plugin'
import { CleanWebpackPlugin } from 'clean-webpack-plugin'
import pkg from 'workbox-webpack-plugin'

const { GenerateSW } = pkg
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Webpack build for the browser chat UI.
 *
 * Produces a static bundle under `dist/` with content-hashed asset names, an
 * injected service worker for offline/PWA support, and the static assets
 * (icon, manifest) copied verbatim. No server-side code is emitted — the app
 * talks to the model providers directly from the browser.
 *
 * @param {{ version?: string }} env - Webpack environment; `version` is the
 *   build identifier surfaced in the footer (set from `get-version.sh`).
 * @returns {import('webpack').Configuration} The webpack configuration.
 */
export default (env = {}) => ({
  entry: './src/index.js',
  output: {
    filename: 'main-[contenthash].js',
    path: path.resolve(__dirname, 'dist'),
    clean: true
  },
  devServer: {
    static: path.resolve(__dirname, 'dist'),
    port: 8080,
    open: false
  },
  plugins: [
    new CleanWebpackPlugin(),
    new HtmlWebpackPlugin({
      template: './src/index.html',
      filename: 'index.html',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: false
      },
      version: env.version || 'dev'
    }),
    new MiniCssExtractPlugin({
      filename: 'style-[contenthash].css'
    }),
    new CopyWebpackPlugin({
      patterns: [{ from: 'src/static', to: '' }]
    }),
    new GenerateSW({
      clientsClaim: true,
      skipWaiting: true,
      runtimeCaching: [
        {
          urlPattern: /$/,
          handler: 'StaleWhileRevalidate'
        }
      ]
    })
  ],
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      }
    ]
  }
})
