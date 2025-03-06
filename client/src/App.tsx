import { useState, useEffect, useRef } from 'react';
import { useCompletion } from '@ai-sdk/react';
import './App.css';

// 参考ドキュメントの型定義
interface Reference {
  title: string;
  url: string;
}

// カスタムデータの型定義
interface CustomData {
  timestamp: string;
  source: string;
  prompt: string;
  model: string;
  references: Reference[];
}

function App() {
  const [customData, setCustomData] = useState<CustomData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamData, setStreamData] = useState<any[]>([]);
  const [eventSourceActive, setEventSourceActive] = useState<boolean>(false);
  const [aiResponse, setAiResponse] = useState<string>('');
  const streamDataRef = useRef<HTMLDivElement>(null);
  const customDataRef = useRef<HTMLDivElement>(null);

  const {
    completion,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    data
  } = useCompletion({
    api: 'http://localhost:3001/api/streaming-data',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      // 追加のパラメータがあれば設定できます
    },
    onFinish: () => {
      console.log('Stream finished');
    },
    onError: (error) => {
      console.error('Error:', error);
      setError(`エラーが発生しました: ${error.message || 'Unknown error'}`);
    },
    // @ts-ignore - onData is available but not in the type definition
    onData: (newData: any) => {
      console.log('Received data:', newData);
      // カスタムデータを処理
      if (newData && Array.isArray(newData)) {
        setCustomData(null); // 配列データは現在のカスタムデータ型と互換性がないため、nullに設定
      }
    }
  });

  // スクロールを最下部に移動する関数
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
  useEffect(() => {
    let eventSource: EventSource | null = null;
    
    if (input && eventSourceActive) {
      // プロンプトをクエリパラメータとして追加
      const url = `http://localhost:3001/api/streaming-data?prompt=${encodeURIComponent(input)}`;
      eventSource = new EventSource(url);
      
      // カスタムデータイベントを処理
      eventSource.addEventListener('customData', (event) => {
        try {
          const data = JSON.parse(event.data) as CustomData;
          console.log('Custom data received:', data);
          setCustomData(data);
        } catch (error) {
          console.error('Error parsing custom data:', error);
        }
      });
      
      // 通常のデータイベントを処理
      eventSource.onmessage = (event) => {
        try {
          if (event.data === '[DONE]') {
            if (eventSource) {
              eventSource.close();
              setEventSourceActive(false);
            }
            return;
          }
          
          const data = JSON.parse(event.data);
          if (data.text) {
            console.log('Text chunk received:', data.text);
            // テキストチャンクを処理
            setStreamData(prev => [...prev, data]);
            // AIの回答を蓄積
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
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [input, eventSourceActive]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); // エラーをリセット
    setCustomData(null); // カスタムデータをリセット
    setStreamData([]); // ストリームデータをリセット
    setAiResponse(''); // AIの回答をリセット
    
    // EventSourceを使用する場合
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
      
      {error && (
        <div className="error-container">
          <p className="error-message">{error}</p>
          <p className="error-help">
            サーバーが起動していることを確認してください。<br />
            また、.envファイルにAWS認証情報が正しく設定されていることを確認してください。
          </p>
        </div>
      )}
      
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

      {customData && customData.references && (
        <div className="references-container">
          <ReferenceLinks references={customData.references} />
        </div>
      )}

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