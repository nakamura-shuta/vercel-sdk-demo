import fastify from 'fastify';
import cors from '@fastify/cors';
import { streamText } from 'ai';
import dotenv from 'dotenv';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

// 環境変数を読み込む
dotenv.config();

const server = fastify();

// CORSを有効化
server.register(cors, {
  origin: '*', // すべてのオリジンを許可
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// ストリーミングデータのエンドポイント (POST)
server.post('/api/streaming-data', async (request, reply) => {
  try {
    const { prompt } = request.body as { prompt: string };

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

    // ストリーミングレスポンスを作成
    const result = await streamText({
      model: bedrockProvider('anthropic.claude-3-5-sonnet-20240620-v1:0'),
      messages: [{ role: 'user', content: prompt }],
    });

    // ヘッダーを設定
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    // カスタムデータを送信
    const customData = {
      timestamp: new Date().toISOString(),
      source: 'Vercel AI SDK Demo with AWS Bedrock',
      prompt: prompt,
      model: 'Claude 3.5 Sonnet',
      references: [
        { title: 'AWS Bedrock Documentation', url: 'https://docs.aws.amazon.com/bedrock/' },
        { title: 'Claude API Reference', url: 'https://docs.anthropic.com/claude/reference/' },
        { title: 'Fastify Documentation', url: 'https://www.fastify.io/docs/latest/' }
      ]
    };
    
    // カスタムデータをイベントとして送信
    reply.raw.write(`event: customData\ndata: ${JSON.stringify(customData)}\n\n`);

    // テキストストリームを取得
    const { textStream } = result;
    
    // テキストをチャンクごとに送信
    for await (const chunk of textStream) {
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

// ストリーミングデータのエンドポイント (GET) - EventSourceのためのエンドポイント
server.get('/api/streaming-data', async (request, reply) => {
  try {
    // クエリパラメータからプロンプトを取得
    const prompt = (request.query as any).prompt || 'こんにちは、AIアシスタントです。何かお手伝いできることはありますか？';

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

    // ストリーミングレスポンスを作成
    const result = await streamText({
      model: bedrockProvider('anthropic.claude-3-sonnet-20240229-v1:0'),
      messages: [{ role: 'user', content: prompt }],
    });

    // ヘッダーを設定
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    // カスタムデータを送信
    const customData = {
      timestamp: new Date().toISOString(),
      source: 'Vercel AI SDK Demo with AWS Bedrock',
      prompt: prompt,
      model: 'Claude 3 Sonnet',
      references: [
        { title: 'AWS Bedrock Documentation', url: 'https://docs.aws.amazon.com/bedrock/' },
        { title: 'Claude API Reference', url: 'https://docs.anthropic.com/claude/reference/' },
        { title: 'Fastify Documentation', url: 'https://www.fastify.io/docs/latest/' }
      ]
    };
    
    // カスタムデータをイベントとして送信
    reply.raw.write(`event: customData\ndata: ${JSON.stringify(customData)}\n\n`);

    // テキストストリームを取得
    const { textStream } = result;
    
    // テキストをチャンクごとに送信
    for await (const chunk of textStream) {
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

// 簡単なヘルスチェックエンドポイント
server.get('/', async (request, reply) => {
  reply.send({ status: 'ok', message: 'Server is running' });
});

// サーバーを起動
const start = async () => {
  try {
    await server.listen({ port: 3001, host: '0.0.0.0' });
    console.log('Server is running on http://localhost:3001');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start(); 