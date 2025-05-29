/**
 * Vercel AI SDK Demo Server with Amazon Bedrock
 * 
 * このサーバーは、Amazon Bedrockを使用してAIストリーミングレスポンスを提供する
 * Fastifyベースのバックエンドサーバーです。
 * 
 * 主な機能:
 * - Amazon Bedrock Claude 3/3.5モデルとの統合
 * - リアルタイムストリーミングレスポンス
 * - 会話履歴の保存とログ管理
 * - 参照ドキュメントをコンテキストとして含める機能
 * - CORS対応でフロントエンドからのアクセスを許可
 */

// 必要なライブラリのインポート
import fastify from 'fastify'; // 高速なWebフレームワーク
import cors from '@fastify/cors'; // Cross-Origin Resource Sharing (CORS) サポート
import { streamText, createDataStreamResponse, Message, CoreMessage } from 'ai'; // Vercel AI SDK
import dotenv from 'dotenv'; // 環境変数管理
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'; // Amazon Bedrock統合
import { promises as fs } from 'fs'; // ファイルシステム操作（非同期版）
import path from 'path'; // パス操作ユーティリティ

// 環境変数を読み込む
dotenv.config();

// Fastifyサーバーインスタンスを作成
const server = fastify();

/**
 * ログディレクトリの設定と作成
 * 会話履歴を保存するためのディレクトリを作成
 * recursive: trueにより、親ディレクトリも自動作成される
 */
const LOG_DIR = path.join(__dirname, 'logs');
(async () => {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    console.log(`Log directory created at ${LOG_DIR}`);
  } catch (error) {
    console.error('Error creating log directory:', error);
  }
})();

/**
 * 参照ドキュメントの型定義
 * AIが回答する際に参考にする外部ドキュメントの情報を格納
 */
interface ReferenceDoc {
  title: string;    // ドキュメントのタイトル
  url: string;      // ドキュメントのURL
  content?: string; // ドキュメントの内容（オプション）
}

/**
 * システムプロンプトを生成する関数
 * @param references 参照ドキュメント情報の配列
 * @returns システムプロンプト
 */
function generateSystemPrompt(references: ReferenceDoc[] = []): string {
  // 基本的なシステムプロンプト
  let systemPrompt = `あなたは優秀なAIアシスタントです。ユーザーの質問に対して、正確で役立つ回答を提供してください。
回答は簡潔かつ分かりやすく、必要に応じて例を含めてください。`;

  // 参照ドキュメントがある場合は、それらの情報を追加
  if (references.length > 0) {
    systemPrompt += `\n\n以下の参照ドキュメントを使用して回答を作成してください：\n`;
    
    references.forEach((doc, index) => {
      systemPrompt += `\n[${index + 1}] ${doc.title} (${doc.url})`;
      if (doc.content) {
        systemPrompt += `\n内容: ${doc.content}\n`;
      }
    });
    
    systemPrompt += `\n参照ドキュメントの情報を活用し、適切な場合は引用元を明示してください。`;
  }

  return systemPrompt;
}

/**
 * メッセージ配列にシステムプロンプトを追加する関数
 * @param messages ユーザーとアシスタントのメッセージ配列
 * @param references 参照ドキュメント情報の配列
 * @returns システムプロンプトを含むメッセージ配列
 */
function addSystemPromptToMessages(
  messages: Array<{ role: 'user' | 'assistant' | 'system', content: string }>, 
  references: ReferenceDoc[] = []
): Array<{ role: 'user' | 'assistant' | 'system', content: string }> {
  const systemPrompt = generateSystemPrompt(references);
  
  // システムプロンプトがすでに存在するか確認
  const hasSystemPrompt = messages.some(msg => msg.role === 'system');
  
  if (hasSystemPrompt) {
    // 既存のシステムプロンプトを置き換え
    return messages.map(msg => 
      msg.role === 'system' ? { role: 'system' as const, content: systemPrompt } : msg
    );
  } else {
    // 新しいシステムプロンプトを先頭に追加
    return [{ role: 'system' as const, content: systemPrompt }, ...messages];
  }
}

/**
 * 会話履歴をファイルに保存する関数
 * @param sessionId セッションID - 会話を識別するためのユニークID
 * @param data 保存する会話データ（プロンプト、レスポンス、メタデータなど）
 * @returns 保存されたファイルのパス、失敗時はnull
 * 
 * ファイル名形式: {sessionId}_{timestamp}.json
 * タイムスタンプの':'は'-'に置換してファイルシステムに対応
 */
async function saveConversationToFile(sessionId: string, data: any) {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `${sessionId}_${timestamp}.json`;
    const filePath = path.join(LOG_DIR, filename);
    
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Conversation saved to ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Error saving conversation to file:', error);
    return null;
  }
}

/**
 * CORS（Cross-Origin Resource Sharing）の設定
 * フロントエンドアプリケーションからのクロスオリジンリクエストを許可
 * 
 * 設定内容:
 * - origin: '*' - すべてのオリジンからのアクセスを許可（本番環境では制限推奨）
 * - methods: HTTPメソッドの許可リスト
 * - allowedHeaders: 許可するリクエストヘッダー
 * - credentials: クッキーなどの認証情報の送信を許可
 */
server.register(cors, {
  origin: '*', // すべてのオリジンを許可
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

/**
 * ストリーミングデータのエンドポイント (POST)
 * クライアントからのPOSTリクエストを処理し、Amazon Bedrockを使用してAIレスポンスをストリーミングで返す
 */
server.post('/api/streaming-data', async (request, reply) => {
  try {
    // リクエストボディからプロンプト、メッセージ、参照ドキュメントを取得
    const { prompt, messages, references } = request.body as { 
      prompt?: string, 
      messages?: Array<{ role: string, content: string }>,
      references?: ReferenceDoc[]
    };
    
    // プロンプトまたはメッセージが必要
    if (!prompt && (!messages || messages.length === 0)) {
      reply.code(400).send({ error: 'Prompt or messages is required' });
      return;
    }

    // ユーザーの入力内容を取得（最後のメッセージまたはプロンプト）
    const userInput = messages && messages.length > 0 
      ? messages[messages.length - 1].content 
      : (prompt as string);

    // メッセージ配列を使用するか、プロンプトからメッセージ配列を作成
    let messageArray = messages ? 
      messages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })) : 
      [{ role: 'user' as const, content: prompt as string }];
    
    // システムプロンプトを追加
    messageArray = addSystemPromptToMessages(messageArray, references || []) as typeof messageArray;
    
    // デバッグ用：システムプロンプトと参照ドキュメント情報をログに出力
    console.log('\n=== 参照ドキュメント情報 ===');
    if (references && references.length > 0) {
      console.log(`${references.length}件の参照ドキュメントが指定されています：`);
      references.forEach((ref, idx) => {
        console.log(`[${idx + 1}] ${ref.title} (${ref.url})`);
        if (ref.content) {
          console.log(`  内容プレビュー: ${ref.content.substring(0, 50)}...`);
        }
      });
    } else {
      console.log('参照ドキュメントはありません');
    }
    
    // システムプロンプトを取得して出力
    const systemMsg = messageArray.find(msg => msg.role === 'system');
    if (systemMsg) {
      console.log('\n=== システムプロンプト ===');
      console.log(systemMsg.content);
    }
    
    console.log('\n=== メッセージ配列 ===');
    console.log(JSON.stringify(messageArray, null, 2));
    console.log('========================\n');
    
    // セッションIDを生成（単純なタイムスタンプベース）
    const sessionId = `session_${Date.now()}`;

    /**
     * AWS認証情報の検証
     * 環境変数にAWSアクセスキーとシークレットキーが設定されているか確認
     * 設定されていない場合は500エラーを返す
     */
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      reply.code(500).send({ error: 'AWS credentials are not set' });
      return;
    }

    /**
     * Amazon Bedrockプロバイダーの設定
     * AWS認証情報を使用してBedrockサービスに接続するプロバイダーを作成
     * 
     * 設定パラメータ:
     * - region: AWSリージョン（デフォルト: us-east-1）
     * - accessKeyId: AWS IAMアクセスキーID
     * - secretAccessKey: AWS IAMシークレットアクセスキー
     */
    const bedrockProvider = createAmazonBedrock({
      region: process.env.AWS_REGION || 'us-east-1', // AWSリージョン
      accessKeyId: process.env.AWS_ACCESS_KEY_ID, // AWSアクセスキーID
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // AWSシークレットアクセスキー
    });

    /**
     * カスタムデータオブジェクトの作成
     * ストリーミングレスポンスに含めるメタデータを定義
     * このデータはクライアントサイドで追加情報として利用可能
     * 
     * 含まれるデータ:
     * - timestamp: リクエスト処理開始時刻（ISO 8601形式）
     * - source: システム識別子
     * - prompt: ユーザーが入力したプロンプトテキスト
     * - model: 使用するAIモデル名
     * - sessionId: 会話セッションの一意識別子
     * - references: 参照ドキュメント情報（デフォルト値付き）
     */
    const customData = {
      timestamp: new Date().toISOString(), // 現在のタイムスタンプ
      source: 'Vercel AI SDK Demo with AWS Bedrock',
      prompt: userInput, // ユーザーの入力内容
      model: 'Claude 3.5 Sonnet', // 使用しているモデル
      sessionId: sessionId, // セッションID
      references: (references || [
        { title: 'AWS Bedrock Documentation', url: 'https://docs.aws.amazon.com/bedrock/' },
        { title: 'Claude API Reference', url: 'https://docs.anthropic.com/claude/reference/' },
        { title: 'Fastify Documentation', url: 'https://www.fastify.io/docs/latest/' }
      ]).map(ref => ({
        title: ref.title,
        url: ref.url,
        ...(ref.content ? { content: ref.content } : {})
      }))
    };

    /**
     * AIストリーミングレスポンスの生成
     * Vercel AI SDKのstreamText関数を使用して、
     * Amazon Bedrock上のClaudeモデルからリアルタイムでレスポンスを取得
     * 
     * パラメータ:
     * - model: 使用するAIモデル（Claude 3.5 Sonnet）
     * - messages: システムプロンプトとユーザーメッセージを含む配列
     * - onChunk: テキストチャンクを受信するたびに呼び出されるコールバック
     * - onFinish: ストリーミング完了時に呼び出されるコールバック
     */
    const result = await streamText({
      // bedrockProviderを使用して特定のモデルを指定
      // 'anthropic.claude-3-5-sonnet-20240620-v1:0'はAmazon Bedrock上のClaude 3.5 Sonnetモデル
      model: bedrockProvider('anthropic.claude-3-5-sonnet-20240620-v1:0'),
      // ユーザーからのメッセージを設定
      messages: messageArray,
      // チャンク受信時に呼び出されるコールバック
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          console.log(`Received text chunk: ${chunk.textDelta.substring(0, 20)}...`);
        }
      },
      // ストリーミング完了時に呼び出されるコールバック
      onFinish: async ({ response }) => {
        try {
          // 最後のメッセージ（AIの応答）を取得
          const assistantMessage = response.messages.find(msg => msg.role === 'assistant');
          const responseContent = assistantMessage ? assistantMessage.content : '';
          
          // 会話データを作成
          const conversationData = {
            ...customData,
            response: responseContent, // AIの応答内容
            completedAt: new Date().toISOString()
          };
          
          // 会話をファイルに保存
          const filePath = await saveConversationToFile(sessionId, conversationData);
          console.log(`Conversation with prompt "${userInput.substring(0, 30)}..." saved to ${filePath}`);
        } catch (error) {
          console.error('Error saving conversation:', error);
        }
      }
    });

    /**
     * データストリームレスポンスの作成
     * Vercel AI SDKのcreateDataStreamResponse関数を使用して、
     * SSE（Server-Sent Events）形式のストリーミングレスポンスを生成
     * 
     * execute関数内の処理:
     * 1. カスタムデータ（メタデータ）の送信
     * 2. 処理開始のステータス通知
     * 3. AIからのテキストストリームをマージ
     * 
     * headers:
     * - Content-Type: SSE形式を指定
     * - Cache-Control: キャッシュを無効化
     * - Connection: 持続的接続を維持
     * - CORS関連ヘッダー: クロスオリジンアクセスを許可
     * - X-Accel-Buffering: Nginxのバッファリングを無効化
     */
    const response = createDataStreamResponse({
      execute: async (dataStream) => {
        // カスタムデータを送信
        dataStream.writeData(customData);
        
        // 処理開始のメッセージアノテーションを送信
        dataStream.writeMessageAnnotation({ 
          status: 'processing',
          timestamp: new Date().toISOString()
        });
        
        // テキストストリームをマージ（より簡潔な方法）
        result.mergeIntoDataStream(dataStream);
      },
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Accel-Buffering': 'no'
      },
      onError: (error) => {
        // エラーメッセージをカスタマイズ
        console.error('Streaming error:', error);
        return error instanceof Error 
          ? `エラーが発生しました: ${error.message}` 
          : `エラーが発生しました: ${String(error)}`;
      }
    });

    // Fastifyのreplyオブジェクトを使用して、レスポンスを返す
    reply.raw.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    
    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          reply.raw.end();
          return;
        }
        reply.raw.write(value);
        return pump();
      };
      await pump();
    } else {
      reply.raw.end();
    }
    
  } catch (error) {
    console.error('Error:', error);
    reply.code(500).send({ error: 'An error occurred while processing the request' });
  }
});

/**
 * ストリーミングデータのエンドポイント (GET)
 * EventSourceオブジェクトからのGETリクエストを処理するためのエンドポイント
 * クライアント側でEventSourceを使用する場合に利用される
 */
server.get('/api/streaming-data', async (request, reply) => {
  try {
    // クエリパラメータからプロンプトと参照ドキュメントを取得
    const promptQuery = request.query as { prompt?: string, references?: string };
    
    if (!promptQuery.prompt) {
      reply.code(400).send({ error: 'Prompt is required' });
      return;
    }

    const userPrompt = promptQuery.prompt;

    // 参照ドキュメントがある場合はJSONとしてパース
    let references: ReferenceDoc[] = [];
    if (promptQuery.references) {
      try {
        references = JSON.parse(promptQuery.references);
      } catch (e) {
        console.warn('Failed to parse references:', e);
      }
    }

    // メッセージ配列を作成
    const userMessage = { role: 'user' as const, content: userPrompt };
    let messageArray: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [userMessage];
    
    // システムプロンプトを追加
    messageArray = addSystemPromptToMessages(messageArray, references);
    
    // デバッグ用：システムプロンプトと参照ドキュメント情報をログに出力
    console.log('\n=== 参照ドキュメント情報 ===');
    if (references && references.length > 0) {
      console.log(`${references.length}件の参照ドキュメントが指定されています：`);
      references.forEach((ref, idx) => {
        console.log(`[${idx + 1}] ${ref.title} (${ref.url})`);
        if (ref.content) {
          console.log(`  内容プレビュー: ${ref.content.substring(0, 50)}...`);
        }
      });
    } else {
      console.log('参照ドキュメントはありません');
    }
    
    // システムプロンプトを取得して出力
    const systemMsg = messageArray.find(msg => msg.role === 'system');
    if (systemMsg) {
      console.log('\n=== システムプロンプト ===');
      console.log(systemMsg.content);
    }
    
    console.log('\n=== メッセージ配列 ===');
    console.log(JSON.stringify(messageArray, null, 2));
    console.log('========================\n');
    
    // セッションIDを生成（単純なタイムスタンプベース）
    const sessionId = `session_${Date.now()}`;

    // AWS認証情報が設定されているか確認
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      reply.code(500).send({ error: 'AWS credentials are not set' });
      return;
    }

    // Amazon Bedrockのプロバイダーを設定
    const bedrockProvider = createAmazonBedrock({
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    });

    // カスタムデータを作成
    const customData = {
      timestamp: new Date().toISOString(),
      source: 'Vercel AI SDK Demo with AWS Bedrock',
      prompt: userPrompt,
      model: 'Claude 3 Sonnet',
      sessionId: sessionId,
      references: references.length > 0 ? references.map(ref => ({
        title: ref.title,
        url: ref.url,
        ...(ref.content ? { content: ref.content } : {})
      })) : [
        { title: 'AWS Bedrock Documentation', url: 'https://docs.aws.amazon.com/bedrock/' },
        { title: 'Claude API Reference', url: 'https://docs.anthropic.com/claude/reference/' },
        { title: 'Fastify Documentation', url: 'https://www.fastify.io/docs/latest/' }
      ]
    };

    /**
     * AIストリーミングレスポンスの生成（GETエンドポイント用）
     * Claude 3 Sonnetモデルを使用してレスポンスを生成
     */
    const result = await streamText({
      model: bedrockProvider('anthropic.claude-3-sonnet-20240229-v1:0'), // Claude 3 Sonnetモデルを使用
      messages: messageArray,
      // チャンク受信時に呼び出されるコールバック
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          console.log(`Received text chunk: ${chunk.textDelta.substring(0, 20)}...`);
        }
      },
      // ストリーミング完了時に呼び出されるコールバック
      onFinish: async ({ response }) => {
        try {
          // 最後のメッセージ（AIの応答）を取得
          const assistantMessage = response.messages.find(msg => msg.role === 'assistant');
          const responseContent = assistantMessage ? assistantMessage.content : '';
          
          // 会話データを作成
          const conversationData = {
            ...customData,
            response: responseContent, // AIの応答内容
            completedAt: new Date().toISOString()
          };
          
          // 会話をファイルに保存
          const filePath = await saveConversationToFile(sessionId, conversationData);
          console.log(`Conversation with prompt "${userPrompt.substring(0, 30)}..." saved to ${filePath}`);
        } catch (error) {
          console.error('Error saving conversation:', error);
        }
      }
    });

    /**
     * データストリームレスポンスの作成（GETエンドポイント用）
     * EventSource APIを使用するクライアント向けのSSEレスポンスを生成
     */
    const response = createDataStreamResponse({
      execute: async (dataStream) => {
        // カスタムデータを送信
        dataStream.writeData(customData);
        
        // 処理開始のメッセージアノテーションを送信
        dataStream.writeMessageAnnotation({ 
          status: 'processing',
          timestamp: new Date().toISOString()
        });
        
        // テキストストリームをマージ（より簡潔な方法）
        result.mergeIntoDataStream(dataStream);
      },
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS', // GETメソッドを許可
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Accel-Buffering': 'no'
      },
      onError: (error) => {
        // エラーメッセージをカスタマイズ
        console.error('Streaming error:', error);
        return error instanceof Error 
          ? `エラーが発生しました: ${error.message}` 
          : `エラーが発生しました: ${String(error)}`;
      }
    });

    // Fastifyのreplyオブジェクトを使用して、レスポンスを返す
    reply.raw.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    
    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          reply.raw.end();
          return;
        }
        reply.raw.write(value);
        return pump();
      };
      await pump();
    } else {
      reply.raw.end();
    }
    
  } catch (error) {
    console.error('Error:', error);
    reply.code(500).send({ error: 'An error occurred while processing the request' });
  }
});

/**
 * 会話履歴を取得するエンドポイント (GET /api/history)
 * 保存された会話ログファイルから最新の履歴を取得
 * 
 * レスポンス:
 * - 成功時: 最新10件の会話履歴を含む配列
 * - エラー時: 500ステータスコードとエラーメッセージ
 * 
 * 処理の流れ:
 * 1. ログディレクトリからすべてのJSONファイルを取得
 * 2. ファイル名でソートして最新10件を選択
 * 3. 各ファイルの内容を読み込んでJSONとしてパース
 * 4. 配列として返す
 */
server.get('/api/history', async (request, reply) => {
  try {
    const files = await fs.readdir(LOG_DIR);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    // 最新の10件のみ返す
    const recentFiles = jsonFiles.sort().reverse().slice(0, 10);
    
    const history = [];
    for (const file of recentFiles) {
      const filePath = path.join(LOG_DIR, file);
      const content = await fs.readFile(filePath, 'utf8');
      history.push(JSON.parse(content));
    }
    
    reply.send(history);
  } catch (error) {
    console.error('Error retrieving history:', error);
    reply.code(500).send({ error: 'Failed to retrieve conversation history' });
  }
});

/**
 * ヘルスチェックエンドポイント (GET /)
 * サーバーの稼働状態を確認するためのシンプルなエンドポイント
 * 
 * レスポンス:
 * - status: 'ok' - サーバーが正常に稼働していることを示す
 * - message: サーバーの状態メッセージ
 * 
 * 用途: モニタリングツールやロードバランサーのヘルスチェックに使用
 */
server.get('/', async (request, reply) => {
  reply.send({ status: 'ok', message: 'Server is running' });
});

/**
 * サーバー起動関数
 * Fastifyサーバーを指定されたポートとホストで起動
 * 
 * 設定:
 * - port: 3001 - サーバーがリッスンするポート番号
 * - host: '0.0.0.0' - すべてのネットワークインターフェースでリッスン
 * 
 * エラーハンドリング:
 * - 起動に失敗した場合はエラーをログに出力してプロセスを終了
 */
const start = async () => {
  try {
    await server.listen({ port: 3001, host: '0.0.0.0' });
    console.log('Server is running on http://localhost:3001');
    console.log(`Conversation logs will be saved to ${LOG_DIR}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

// サーバーを起動
start(); 