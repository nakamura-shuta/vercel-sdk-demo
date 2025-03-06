import fastify from 'fastify';
import cors from '@fastify/cors';
import { streamText } from 'ai';
import dotenv from 'dotenv';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { promises as fs } from 'fs';
import path from 'path';

// 環境変数を読み込む
dotenv.config();

const server = fastify();

// ログディレクトリの作成（存在しない場合）
const LOG_DIR = path.join(__dirname, 'logs');
(async () => {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    console.log(`Log directory created at ${LOG_DIR}`);
  } catch (error) {
    console.error('Error creating log directory:', error);
  }
})();

// 会話履歴をファイルに保存する関数
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

// CORSを有効化
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
    // リクエストボディからプロンプトを取得
    const { prompt } = request.body as { prompt: string };
    
    // セッションIDを生成（単純なタイムスタンプベース）
    const sessionId = `session_${Date.now()}`;

    // AWS認証情報が設定されているか確認
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      reply.code(500).send({ error: 'AWS credentials are not set' });
      return;
    }

    // Amazon Bedrockのプロバイダーを設定
    // createAmazonBedrock関数を使用して、AWS認証情報を指定したプロバイダーインスタンスを作成
    const bedrockProvider = createAmazonBedrock({
      region: process.env.AWS_REGION || 'us-east-1', // AWSリージョン
      accessKeyId: process.env.AWS_ACCESS_KEY_ID, // AWSアクセスキーID
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // AWSシークレットアクセスキー
    });

    // カスタムデータを作成（メタデータとして使用）
    const customData = {
      timestamp: new Date().toISOString(), // 現在のタイムスタンプ
      source: 'Vercel AI SDK Demo with AWS Bedrock',
      prompt: prompt, // ユーザーのプロンプト
      model: 'Claude 3.5 Sonnet', // 使用しているモデル
      sessionId: sessionId, // セッションID
      references: [
        { title: 'AWS Bedrock Documentation', url: 'https://docs.aws.amazon.com/bedrock/' },
        { title: 'Claude API Reference', url: 'https://docs.anthropic.com/claude/reference/' },
        { title: 'Fastify Documentation', url: 'https://www.fastify.io/docs/latest/' }
      ]
    };

    // ストリーミングレスポンスを作成
    // streamText関数を使用して、AIモデルからのレスポンスをストリーミング形式で取得
    const result = await streamText({
      // bedrockProviderを使用して特定のモデルを指定
      // 'anthropic.claude-3-5-sonnet-20240620-v1:0'はAmazon Bedrock上のClaude 3.5 Sonnetモデル
      model: bedrockProvider('anthropic.claude-3-5-sonnet-20240620-v1:0'),
      // ユーザーからのメッセージを設定
      messages: [{ role: 'user', content: prompt }],
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
          console.log(`Conversation with prompt "${prompt.substring(0, 30)}..." saved to ${filePath}`);
        } catch (error) {
          console.error('Error saving conversation:', error);
        }
      }
    });

    // Server-Sent Events (SSE)のためのヘッダーを設定
    // これにより、クライアントはイベントストリームを受信できる
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', // SSEのコンテンツタイプ
      'Cache-Control': 'no-cache', // キャッシュを無効化
      'Connection': 'keep-alive', // 接続を維持
      'Access-Control-Allow-Origin': '*', // CORSを許可
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    
    // カスタムデータをSSEイベントとして送信
    // 'event: customData'でイベント名を指定し、データをJSON形式で送信
    reply.raw.write(`event: customData\ndata: ${JSON.stringify(customData)}\n\n`);

    // テキストストリームを取得
    // result.textStreamはAsyncIterableで、AIからの応答が小さなチャンクで届く
    const { textStream } = result;
    
    // テキストをチャンクごとに送信
    // for await...ofループを使用して、ストリームからチャンクを順次取得
    for await (const chunk of textStream) {
      // 各チャンクをSSEイベントとしてクライアントに送信
      // 'data:'プレフィックスはSSEの標準形式
      reply.raw.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }

    // ストリームの終了を通知
    // '[DONE]'はストリームの終了を示す特別なマーカー
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end(); // レスポンスを終了
    
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
    // クエリパラメータからプロンプトを取得
    // GETリクエストではクエリパラメータを使用
    const prompt = (request.query as any).prompt || 'こんにちは、AIアシスタントです。何かお手伝いできることはありますか？';
    
    // セッションIDを生成
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
      prompt: prompt,
      model: 'Claude 3 Sonnet',
      sessionId: sessionId,
      references: [
        { title: 'AWS Bedrock Documentation', url: 'https://docs.aws.amazon.com/bedrock/' },
        { title: 'Claude API Reference', url: 'https://docs.anthropic.com/claude/reference/' },
        { title: 'Fastify Documentation', url: 'https://www.fastify.io/docs/latest/' }
      ]
    };

    // ストリーミングレスポンスを作成
    // POSTエンドポイントと同様の処理だが、モデルが異なる
    const result = await streamText({
      model: bedrockProvider('anthropic.claude-3-sonnet-20240229-v1:0'), // Claude 3 Sonnetモデルを使用
      messages: [{ role: 'user', content: prompt }],
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
          console.log(`Conversation with prompt "${prompt.substring(0, 30)}..." saved to ${filePath}`);
        } catch (error) {
          console.error('Error saving conversation:', error);
        }
      }
    });

    // SSEのためのヘッダーを設定
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS', // GETメソッドを許可
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    
    // カスタムデータをSSEイベントとして送信
    reply.raw.write(`event: customData\ndata: ${JSON.stringify(customData)}\n\n`);

    // テキストストリームを取得
    const { textStream } = result;
    
    // テキストをチャンクごとに送信
    for await (const chunk of textStream) {
      // 各チャンクをSSEイベントとしてクライアントに送信
      reply.raw.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }

    // ストリームの終了を通知
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
    
  } catch (error) {
    console.error('Error:', error);
    reply.code(500).send({ error: 'An error occurred while processing the request' });
  }
});

// 会話履歴を取得するエンドポイント
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

// 簡単なヘルスチェックエンドポイント
// サーバーが稼働しているかを確認するためのシンプルなエンドポイント
server.get('/', async (request, reply) => {
  reply.send({ status: 'ok', message: 'Server is running' });
});

// サーバーを起動
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

start(); 