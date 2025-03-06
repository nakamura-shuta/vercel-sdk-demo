import { useState, useEffect, useRef } from 'react';
import { useCompletion } from '@ai-sdk/react';
import './App.css';

// 参考ドキュメントの型定義
// APIから返される参考リンク情報の型
interface Reference {
  title: string;
  url: string;
}

// カスタムデータの型定義
// サーバーから送信されるカスタムイベントデータの型
interface CustomData {
  timestamp: string; // レスポンス生成時のタイムスタンプ
  source: string;    // データソース情報
  prompt: string;    // ユーザーが入力したプロンプト
  model: string;     // 使用されたAIモデル
  references: Reference[]; // 参考ドキュメントのリスト
}

function App() {
  // 状態管理用のステート
  const [customData, setCustomData] = useState<CustomData | null>(null); // カスタムデータを保持
  const [error, setError] = useState<string | null>(null); // エラーメッセージを保持
  const [streamData, setStreamData] = useState<any[]>([]); // ストリーミングデータの履歴を保持
  
  // DOM参照用のref
  const completionRef = useRef<HTMLDivElement>(null); // ストリームデータ表示領域へのref
  const customDataRef = useRef<HTMLDivElement>(null); // カスタムデータ表示領域へのref

  // Vercel AI SDKのuseCompletionフックを使用
  const {
    completion,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error: aiError,
    setCompletion,
    data
  } = useCompletion({
    api: 'http://localhost:3001/api/streaming-data',
    headers: {
      'Content-Type': 'application/json',
    },
    streamProtocol: 'data', // データストリームプロトコルを指定
    onFinish: (prompt, completion) => {
      console.log('Stream finished');
      console.log('Prompt:', prompt);
      console.log('Final completion:', completion);
    },
    onError: (error) => {
      console.error('Error:', error);
      setError(`エラーが発生しました: ${error.message || 'Unknown error'}`);
    }
  });

  // 各チャンクを受信したときにストリームデータを更新
  useEffect(() => {
    // 新しいcompletionが来たときにストリームデータに追加
    if (completion) {
      const newChunk = { text: completion };
      setStreamData(prev => {
        // 前回と同じ内容なら追加しない（重複防止）
        if (prev.length > 0 && prev[prev.length - 1].text === completion) {
          return prev;
        }
        return [...prev, newChunk];
      });
    }
  }, [completion]);

  // データストリームの最初のチャンクからカスタムデータを抽出
  useEffect(() => {
    if (data && data.length > 0) {
      console.log('Stream data:', data);
      // 最初のデータオブジェクトをカスタムデータとして設定
      const customDataObj = data[0];
      if (customDataObj && typeof customDataObj === 'object' && !Array.isArray(customDataObj)) {
        // @ts-ignore - カスタムデータの型が不明
        setCustomData(customDataObj as unknown as CustomData);
      }
    }
  }, [data]);

  // エラー状態の同期
  useEffect(() => {
    if (aiError) {
      setError(`エラーが発生しました: ${aiError.message || 'Unknown error'}`);
    }
  }, [aiError]);

  // スクロールを最下部に移動する関数
  useEffect(() => {
    if (completionRef.current) {
      completionRef.current.scrollTop = completionRef.current.scrollHeight;
    }
  }, [completion]);

  // カスタムデータのスクロールを最下部に移動する関数
  useEffect(() => {
    if (customDataRef.current) {
      customDataRef.current.scrollTop = customDataRef.current.scrollHeight;
    }
  }, [customData]);

  // フォーム送信ハンドラ
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCustomData(null);
    setStreamData([]);
    setCompletion('');
    handleSubmit(e);
  };

  // 参考ドキュメントを表示するコンポーネント
  const ReferenceLinks = ({ references }: { references: Reference[] }) => {
    return (
      <div className="reference-links">
        <h3>参考ドキュメント:</h3>
        <ul>
          {references.map((ref, index) => (
            <li key={index}>
              <a href={ref.url} target="_blank" rel="noopener noreferrer">
                {ref.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="app-container">
      <h1>Vercel AI SDK + AWS Bedrock ストリーミングデータのデモ</h1>
      
      {/* エラーメッセージの表示 */}
      {error && (
        <div className="error-container">
          <p className="error-message">{error}</p>
          <p className="error-help">
            サーバーが起動していることを確認してください。<br />
            また、.envファイルにAWS認証情報が正しく設定されていることを確認してください。
          </p>
        </div>
      )}
      
      {/* 入力フォーム */}
      <form onSubmit={handleFormSubmit} className="input-form">
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="質問を入力してください..."
          className="input-field"
        />
        <button type="submit" disabled={isLoading} className="submit-button">
          {isLoading ? '生成中...' : '送信'}
        </button>
      </form>
      
      {/* AIの回答を表示するセクション */}
      <div className="completion-container">
        <h2>AIの回答:</h2>
        <div className="completion-box" ref={completionRef}>
          {isLoading ? (
            completion ? (
              <div>{completion}</div>
            ) : (
              <div className="loading">生成中...</div>
            )
          ) : completion ? (
            <div>{completion}</div>
          ) : (
            <div className="placeholder">AIの回答がここに表示されます</div>
          )}
        </div>
      </div>

      {/* 参考ドキュメントリンクの表示 */}
      {customData && customData.references && (
        <div className="references-container">
          <ReferenceLinks references={customData.references} />
        </div>
      )}

      {/* ストリーミングデータの表示（デバッグ用） */}
      <div className="data-container">
        <h2>ストリーミングデータ:</h2>
        <div className="data-box">
          {streamData.length > 0 ? (
            <pre>{JSON.stringify(streamData, null, 2)}</pre>
          ) : (
            <div className="placeholder">ストリーミングデータがここに表示されます</div>
          )}
        </div>
      </div>

      {/* カスタムデータの表示（デバッグ用） */}
      <div className="custom-data-container">
        <h2>カスタムデータ処理:</h2>
        <div className="data-box" ref={customDataRef}>
          {customData ? (
            <pre>{JSON.stringify(customData, null, 2)}</pre>
          ) : (
            <div className="placeholder">カスタムデータがここに表示されます</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App; 