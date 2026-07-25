const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

// Bundles are emitted straight into the plugin's resources so the Maven build
// packs them into the JAR (the directory is gitignored; `pnpm build` must run
// before `mvn package` — see the root build:jira-dc script).
module.exports = {
  mode: 'production',
  entry: {
    panel: './src/panel.jsx',
    settings: './src/settings.jsx',
  },
  output: {
    path: path.resolve(__dirname, '../src/main/resources/frontend'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        include: [
          path.resolve(__dirname, 'src'),
          path.resolve(__dirname, '../../packages/jira-panel-ui/src'),
        ],
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              ['@babel/preset-react', { runtime: 'classic' }],
            ],
          },
        },
      },
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: '[name].css' }),
  ],
  resolve: {
    extensions: ['.js', '.jsx'],
  },
};
