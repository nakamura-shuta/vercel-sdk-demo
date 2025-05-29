// React 18で必要なReact本体とReactDOMのインポート
import React from 'react';
import ReactDOM from 'react-dom/client';
// メインのアプリケーションコンポーネント
import App from './App';
// グローバルなスタイルシート
import './index.css';

// React 18の新しいcreateRoot APIを使用してアプリケーションをレンダリング
// document.getElementById('root')でHTMLのroot要素を取得
// ! は TypeScriptのnon-null assertion operatorで、要素が確実に存在することを示す
ReactDOM.createRoot(document.getElementById('root')!).render(
  // StrictModeは開発時の警告を有効にし、潜在的な問題を検出する
  <React.StrictMode>
    <App />
  </React.StrictMode>,
); 