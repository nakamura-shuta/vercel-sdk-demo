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
  const [eventSourceActive, setEventSourceActive] = useState<boolean>(false); // EventSourceの状態を管理
  const [aiResponse, setAiResponse] = useState<string>(''); // AIの完全な応答テキストを保持
  
  // DOM参照用のref
  const streamDataRef = useRef<HTMLDivElement>(null); // ストリームデータ表示領域へのref
  const customDataRef = useRef<HTMLDivElement>(null); // カスタムデータ表示領域へのref

  // Vercel AI SDKのuseCompletionフックを使用
  // このフックはAIモデルとの対話を管理する
  const {
    completion,    // 現在の完了テキスト
    input,         // 入力フィールドの値
    handleInputChange, // 入力変更ハンドラ
    handleSubmit,  // フォーム送信ハンドラ
    isLoading,     // ローディング状態
    data           // 完了データ
  } = useCompletion({
    api: 'http://localhost:3001/api/streaming-data', // APIエンドポイント
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      // 追加のパラメータがあれば設定できます
    },
    onFinish: () => {
      // ストリームが完了したときの処理
      console.log('Stream finished');
    },
    onError: (error) => {
      // エラー発生時の処理
      console.error('Error:', error);
      setError(`エラーが発生しました: ${error.message || 'Unknown error'}`);
    },
    // @ts-ignore - onData is available but not in the type definition
    onData: (newData: any) => {
      // 新しいデータを受信したときの処理
      console.log('Received data:', newData);
      // カスタムデータを処理
      if (newData && Array.isArray(newData)) {
        setCustomData(null); // 配列データは現在のカスタムデータ型と互換性がないため、nullに設定
      }
    }
  });

  // スクロールを最下部に移動する関数
  // ストリームデータやAIレスポンスが更新されたときに自動スクロール
  useEffect(() => {
    if (streamDataRef.current) {
      streamDataRef.current.scrollTop = streamDataRef.current.scrollHeight;
    }
  }, [streamData, aiResponse]);

  // カスタムデータのスクロールを最下部に移動する関数
  useEffect(() => {
    if (customDataRef.current) {
      customDataRef.current.scrollTop = customDataRef.current.scrollHeight;
    }
  }, [customData]);

  // EventSourceを使用してカスタムイベントを受信する
  // Server-Sent Events (SSE)を使用してサーバーからのストリーミングデータを受信
  useEffect(() => {
    let eventSource: EventSource | null = null;
    
    if (input && eventSourceActive) {
      // プロンプトをクエリパラメータとして追加
      // GETリクエストでEventSourceを初期化
      const url = `http://localhost:3001/api/streaming-data?prompt=${encodeURIComponent(input)}`;
      eventSource = new EventSource(url);
      
      // カスタムデータイベントを処理
      // サーバーから送信される'customData'という名前のイベントをリッスン
      eventSource.addEventListener('customData', (event) => {
        try {
          // イベントデータをJSONとしてパース
          const data = JSON.parse(event.data) as CustomData;
          console.log('Custom data received:', data);
          setCustomData(data);
        } catch (error) {
          console.error('Error parsing custom data:', error);
        }
      });
      
      // 通常のデータイベントを処理
      // 名前のないデータイベントはonmessageで受信
      eventSource.onmessage = (event) => {
        try {
          // ストリーム終了の特殊マーカーを確認
          if (event.data === '[DONE]') {
            if (eventSource) {
              eventSource.close(); // ストリームが完了したらEventSourceを閉じる
              setEventSourceActive(false);
            }
            return;
          }
          
          // データをJSONとしてパース
          const data = JSON.parse(event.data);
          if (data.text) {
            console.log('Text chunk received:', data.text);
            // テキストチャンクを処理
            setStreamData(prev => [...prev, data]); // ストリームデータ履歴に追加
            // AIの回答を蓄積（チャンクを連結）
            setAiResponse(prev => prev + data.text);
          }
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      };
      
      // エラーハンドリング
      eventSource.onerror = () => {
        console.error('EventSource error');
        if (eventSource) {
          eventSource.close();
          setEventSourceActive(false);
        }
        setError('EventSourceでエラーが発生しました。サーバーが起動していることを確認してください。');
      };
    }
    
    // クリーンアップ関数
    // コンポーネントがアンマウントされたときにEventSourceを閉じる
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [input, eventSourceActive]);

  // フォーム送信ハンドラ
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); // エラーをリセット
    setCustomData(null); // カスタムデータをリセット
    setStreamData([]); // ストリームデータをリセット
    setAiResponse(''); // AIの回答をリセット
    
    // EventSourceを使用する場合
    // このフラグをtrueに設定すると、useEffectでEventSourceが初期化される
    setEventSourceActive(true);
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
      
      {/* AIの回答を表示するセクション */}
      <div className="completion-container">
        <h2>AIの回答:</h2>
        <div className="completion-box" ref={streamDataRef}>
          {isLoading || eventSourceActive ? (
            aiResponse ? (
              <div>{aiResponse}</div>
            ) : (
              <div className="loading">生成中...</div>
            )
          ) : aiResponse ? (
            <div>{aiResponse}</div>
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

      {/* 入力フォーム */}
      <form onSubmit={handleFormSubmit} className="input-form">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="質問を入力してください..."
          className="input-field"
        />
        <button type="submit" disabled={isLoading || eventSourceActive} className="submit-button">
          {isLoading || eventSourceActive ? '生成中...' : '送信'}
        </button>
      </form>
    </div>
  );
}

export default App; 