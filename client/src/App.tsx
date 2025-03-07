import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useChat } from '@ai-sdk/react';
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

// 参考ドキュメントリンクのコンポーネント（メモ化）
const ReferenceLinks = memo(({ references }: { references: Reference[] }) => {
  if (!references || references.length === 0) return null;
  
  return (
    <div className="references">
      <h4>参考ドキュメント:</h4>
      <ul>
        {references.map((ref, index) => (
          <li key={index}>
            <a href={ref.url} target="_blank" rel="noopener noreferrer">{ref.title}</a>
          </li>
        ))}
      </ul>
    </div>
  );
});

// メッセージ表示用コンポーネント（メモ化）
const MessageItem = memo(({ role, content, isNew = false }: { role: string, content: string, isNew?: boolean }) => {
  const isUser = role === 'user';
  const messageRef = useRef<HTMLDivElement>(null);
  
  // 新しいメッセージが表示されたときだけアニメーションを適用
  useEffect(() => {
    if (isNew && messageRef.current) {
      messageRef.current.classList.add('fade-in');
      setTimeout(() => {
        if (messageRef.current) {
          messageRef.current.classList.remove('fade-in');
        }
      }, 500);
    }
  }, [isNew]);

  return (
    <div 
      className={`message ${isUser ? 'user-message' : 'ai-message'}`}
      ref={messageRef}
    >
      <div className="message-header">
        <strong>{isUser ? 'あなた' : 'AI'}</strong>
      </div>
      <div className="message-content">
        {content}
      </div>
    </div>
  );
});

// ストリーミング中のメッセージコンポーネント（メモ化）
const StreamingMessage = memo(({ content }: { content: string }) => {
  return (
    <div className="ai-message streaming">
      <div className="message-header">
        <strong>AI</strong>
        <span className="streaming-indicator">応答中...</span>
      </div>
      <div className="message-content">
        {content}
      </div>
    </div>
  );
});

// メッセージペアコンポーネント（メモ化）
const MessagePair = memo(({ userMessage, aiMessage, isLatest, isStreaming }: { 
  userMessage: { role: string, content: string, id: string }, 
  aiMessage?: { role: string, content: string, id: string }, 
  isLatest: boolean,
  isStreaming: boolean
}) => {
  return (
    <div className="message-pair">
      <MessageItem 
        role={userMessage.role} 
        content={userMessage.content} 
        isNew={false}
      />
      
      {aiMessage ? (
        <MessageItem 
          role={aiMessage.role} 
          content={aiMessage.content} 
          isNew={isLatest && !isStreaming}
        />
      ) : isLatest && isStreaming ? (
        <StreamingMessage content="" />
      ) : null}
    </div>
  );
});

// メッセージリストコンポーネント（メモ化）
const MessageList = memo(({ messages, isLoading }: { messages: any[], isLoading: boolean }) => {
  // ユーザーメッセージとAIメッセージを分離
  const messagePairs = useMemo(() => {
    const userMessages = messages.filter(m => m.role === 'user');
    const aiMessages = messages.filter(m => m.role === 'assistant');
    
    return userMessages.map((userMsg, index) => {
      const aiMsg = aiMessages[index];
      return {
        user: userMsg,
        ai: aiMsg,
        isLatest: index === userMessages.length - 1
      };
    });
  }, [messages]);
  
  if (messagePairs.length === 0) {
    return (
      <div className="empty-state">
        <p>AIアシスタントに質問してみましょう。</p>
      </div>
    );
  }
  
  return (
    <div className="message-list">
      {messagePairs.map((pair, index) => (
        <MessagePair 
          key={`pair-${pair.user.id}`}
          userMessage={pair.user}
          aiMessage={pair.ai}
          isLatest={pair.isLatest}
          isStreaming={isLoading}
        />
      ))}
      
      {/* 最新のユーザーメッセージに対するAIの応答がまだない場合 */}
      {messagePairs.length > 0 && 
       !messagePairs[messagePairs.length - 1].ai && 
       isLoading && (
        <StreamingMessage 
          content={messages[messages.length - 1]?.content || ''}
        />
      )}
    </div>
  );
});

// カスタムデータ表示コンポーネント（メモ化）
const CustomDataDisplay = memo(({ customData, showCustomData, toggleCustomData }: {
  customData: CustomData | null,
  showCustomData: boolean,
  toggleCustomData: () => void
}) => {
  if (!customData) return null;
  
  return (
    <div className="custom-data-container">
      <button 
        className="toggle-button" 
        onClick={toggleCustomData}
      >
        {showCustomData ? '参照情報を隠す ▲' : '参照情報を表示 ▼'}
      </button>
      
      {showCustomData && (
        <div className="custom-data">
          <div className="metadata">
            <p><strong>モデル:</strong> {customData.model}</p>
            <p><strong>タイムスタンプ:</strong> {new Date(customData.timestamp).toLocaleString()}</p>
          </div>
          <ReferenceLinks references={customData.references} />
        </div>
      )}
    </div>
  );
});

// ストリームデータ表示コンポーネント（メモ化）
const StreamDataDisplay = memo(({ data, showStreamData, toggleStreamData }: {
  data: any[] | undefined,
  showStreamData: boolean,
  toggleStreamData: () => void
}) => {
  if (!data || data.length === 0) return null;
  
  return (
    <div className="stream-data-container">
      <button 
        className="toggle-button" 
        onClick={toggleStreamData}
      >
        {showStreamData ? 'ストリームデータを隠す ▲' : 'ストリームデータを表示 ▼'}
      </button>
      
      {showStreamData && (
        <div className="stream-data">
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
});

// 入力フォームコンポーネント（メモ化）
const InputForm = memo(({ 
  input, 
  handleInputChange, 
  handleFormSubmit, 
  isLoading 
}: {
  input: string,
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
  handleFormSubmit: (e: React.FormEvent) => void,
  isLoading: boolean
}) => {
  return (
    <form onSubmit={handleFormSubmit} className="input-form">
      <input
        type="text"
        value={input}
        onChange={handleInputChange}
        placeholder="AIに質問してみましょう..."
        disabled={isLoading}
        className="text-input"
      />
      <button 
        type="submit" 
        disabled={isLoading || !input.trim()} 
        className="submit-button"
      >
        {isLoading ? '送信中...' : '送信'}
      </button>
    </form>
  );
});

function App() {
  // 状態管理用のステート
  const [customData, setCustomData] = useState<CustomData | null>(null); // カスタムデータを保持
  const [error, setError] = useState<string | null>(null); // エラーメッセージを保持
  const [showCustomData, setShowCustomData] = useState<boolean>(false); // カスタムデータの表示/非表示
  const [showStreamData, setShowStreamData] = useState<boolean>(false); // ストリームデータの表示/非表示
  
  // DOM参照用のref
  const messagesEndRef = useRef<HTMLDivElement>(null); // メッセージ表示領域の最下部へのref
  const messagesContainerRef = useRef<HTMLDivElement>(null); // メッセージコンテナへのref

  // Vercel AI SDKのuseChatフックを使用
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error: aiError,
    data
  } = useChat({
    api: 'http://localhost:3001/api/streaming-data',
    headers: {
      'Content-Type': 'application/json',
    },
    streamProtocol: 'data', // データストリームプロトコルを指定
    onFinish: (message) => {
      console.log('Stream finished');
      console.log('Final message:', message);
    },
    onError: (error) => {
      console.error('Error:', error);
      setError(`エラーが発生しました: ${error.message || 'Unknown error'}`);
    }
  });

  // データストリームからカスタムデータを抽出
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
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isLoading]);

  // フォーム送信ハンドラ
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    // エラーをリセット
    setError(null);
    
    // フォームを送信
    handleSubmit(e);
  };

  // トグルハンドラ
  const toggleCustomData = () => setShowCustomData(prev => !prev);
  const toggleStreamData = () => setShowStreamData(prev => !prev);

  return (
    <div className="app-container">
      <header>
        <h1>Vercel AI SDK Demo with AWS Bedrock</h1>
        <p>Claude 3.5 Sonnetモデルを使用したAIチャットアプリケーション</p>
      </header>

      <main>
        {/* メッセージ履歴表示エリア */}
        <div className="messages-container" ref={messagesContainerRef}>
          <MessageList messages={messages} isLoading={isLoading} />
          <div ref={messagesEndRef} />
        </div>

        {/* カスタムデータ表示エリア（折りたたみ可能） */}
        <CustomDataDisplay 
          customData={customData} 
          showCustomData={showCustomData} 
          toggleCustomData={toggleCustomData} 
        />

        {/* ストリームデータ表示エリア（折りたたみ可能） */}
        <StreamDataDisplay 
          data={data} 
          showStreamData={showStreamData} 
          toggleStreamData={toggleStreamData} 
        />

        {/* エラーメッセージ表示エリア */}
        {error && (
          <div className="error-container">
            <p className="error-message">{error}</p>
          </div>
        )}

        {/* 入力フォーム */}
        <InputForm 
          input={input}
          handleInputChange={handleInputChange}
          handleFormSubmit={handleFormSubmit}
          isLoading={isLoading}
        />
      </main>

      <footer>
        <p>Powered by Vercel AI SDK and AWS Bedrock</p>
      </footer>
    </div>
  );
}

export default App; 