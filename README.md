# Vercel AI SDK + Amazon Bedrock Demo

## 前提条件

- Node.js 18以上
- AWSアカウントとAmazon Bedrockへのアクセス権限
- AWS認証情報（アクセスキーIDとシークレットアクセスキー）

## セットアップ

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd vercel-sdk-demo
```

### 2. サーバーのセットアップ

```bash
cd server
npm install
```

`.env.example`ファイルを`.env`にコピーし、AWS認証情報を設定：

```bash
cp .env.example .env
```

`.env`ファイルを編集して、AWS認証情報を入力：

```
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=us-east-1
```

### 3. クライアントのセットアップ

```bash
cd ../client
npm install
```

## 実行方法

### 1. サーバーの起動

```bash
cd server
npm run dev
```

サーバーは`http://localhost:3001`で起動。

### 2. クライアントの起動

別のターミナルで：

```bash
cd client
npm run dev
```


## 使用方法

1. ブラウザで`http://localhost:3002`にアクセスし。
2. テキスト入力欄に質問やプロンプトを入力します。
3. 「送信」ボタンをクリックします。
4. AIからのストリーミングレスポンスがリアルタイムで表示されます。

## 技術スタック

- **サーバーサイド**：
  - Fastify
  - Vercel AI SDK
  - Amazon Bedrock SDK
  - TypeScript

- **クライアントサイド**：
  - React
  - Vite
  - Vercel AI SDK React Hooks
  - TypeScript

## 参考リソース

- [Vercel AI SDK](https://sdk.vercel.ai/)
- [Amazon Bedrock ドキュメント](https://docs.aws.amazon.com/bedrock/)
- [Anthropic Claude API リファレンス](https://docs.anthropic.com/claude/reference/)

