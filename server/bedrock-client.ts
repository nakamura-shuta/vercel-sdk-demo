import {
    BedrockRuntimeClient,
    InvokeModelCommand,
    InvokeModelWithResponseStreamCommand
} from '@aws-sdk/client-bedrock-runtime';

/**
 * Amazon Bedrock APIを使用するためのクライアントクラス
 * このクラスはAmazon Bedrockの言語モデルを呼び出すためのメソッドを提供します
 */
export class BedrockClient {
    private client: BedrockRuntimeClient; // Amazon Bedrock APIクライアントインスタンス
    private modelId: string; // 使用するモデルのID

    /**
     * BedrockClientのコンストラクタ
     * @param modelId 使用するモデルのID（デフォルトはClaude 3 Sonnet）
     */
    constructor(modelId: string = 'anthropic.claude-3-sonnet-20240229-v1:0') {
        this.modelId = modelId;
        // AWS SDKのBedrockRuntimeClientを初期化
        this.client = new BedrockRuntimeClient({
            region: process.env.AWS_REGION || 'us-east-1', // AWSリージョン
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!, // AWSアクセスキーID
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! // AWSシークレットアクセスキー
            }
        });
    }

    /**
     * Amazon Bedrockモデルを呼び出してテキスト生成を行う（非ストリーミング）
     * @param prompt ユーザーからのプロンプト
     * @returns 生成されたテキスト
     */
    public async invokeModel(prompt: string): Promise<string> {
        // InvokeModelCommandを作成
        const command = new InvokeModelCommand({
            modelId: this.modelId, // 使用するモデルID
            contentType: "application/json", // リクエストのコンテンツタイプ
            accept: "application/json", // レスポンスのコンテンツタイプ
            body: JSON.stringify({
                // Anthropicモデル用のパラメータ
                anthropic_version: "bedrock-2023-05-31", // Anthropic APIバージョン
                max_tokens: 4000, // 生成する最大トークン数
                top_k: 250, // 上位k個の候補から選択
                stop_sequences: [], // 生成を停止するシーケンス
                temperature: 0.7, // 生成の多様性（高いほど創造的）
                top_p: 0.999, // 確率の高い候補から選択（nucleus sampling）
                messages: [
                    {
                        role: "user", // ユーザーメッセージ
                        content: [
                            {
                                type: "text", // テキストコンテンツ
                                text: prompt // ユーザーのプロンプト
                            }
                        ]
                    }
                ]
            })
        });

        try {
            // コマンドを実行してレスポンスを取得
            const response = await this.client.send(command);
            // レスポンスボディをデコードしてJSONとしてパース
            const responseData = JSON.parse(new TextDecoder().decode(response.body));
            // 生成されたテキストを返す
            return responseData?.content?.[0]?.text || '';
        } catch (error) {
            console.error('Error invoking Bedrock:', error);
            throw error;
        }
    }

    /**
     * Amazon Bedrockモデルを呼び出してストリーミングレスポンスを取得
     * @param prompt ユーザーからのプロンプト
     * @param onChunk 各テキストチャンクを処理するコールバック関数
     */
    public async streamResponse(prompt: string, onChunk: (chunk: string) => void): Promise<void> {
        try {
            // ストリーミング用のInvokeModelWithResponseStreamCommandを作成
            const command = new InvokeModelWithResponseStreamCommand({
                modelId: this.modelId, // 使用するモデルID
                contentType: "application/json", // リクエストのコンテンツタイプ
                accept: "application/json", // レスポンスのコンテンツタイプ
                body: JSON.stringify({
                    // Anthropicモデル用のパラメータ（invokeModelと同様）
                    anthropic_version: "bedrock-2023-05-31",
                    max_tokens: 4000,
                    top_k: 250,
                    stop_sequences: [],
                    temperature: 0.7,
                    top_p: 0.999,
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: prompt
                                }
                            ]
                        }
                    ]
                })
            });

            // ストリーミングレスポンスを取得
            const response = await this.client.send(command);
            const decoder = new TextDecoder(); // バイナリデータをテキストにデコードするためのデコーダー

            // レスポンスボディをチャンクごとに処理
            for await (const chunk of response.body!) {
                if (chunk.chunk?.bytes) {
                    // チャンクのバイトデータをデコード
                    const decodedChunk = decoder.decode(chunk.chunk.bytes);
                    // デコードしたデータをJSONとしてパース
                    const parsedChunk = JSON.parse(decodedChunk);
                    // content_block_deltaタイプのチャンクからテキストを抽出
                    if (parsedChunk.type === 'content_block_delta' && parsedChunk.delta?.text) {
                        // コールバック関数を呼び出してテキストチャンクを処理
                        onChunk(parsedChunk.delta.text);
                    }
                }
            }
        } catch (error) {
            console.error('Error streaming from Bedrock:', error);
            throw error;
        }
    }
} 