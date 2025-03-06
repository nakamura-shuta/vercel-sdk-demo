import {
    BedrockRuntimeClient,
    InvokeModelCommand,
    InvokeModelWithResponseStreamCommand
} from '@aws-sdk/client-bedrock-runtime';

export class BedrockClient {
    private client: BedrockRuntimeClient;
    private modelId: string;
    constructor(modelId: string = 'anthropic.claude-3-sonnet-20240229-v1:0') {
        this.modelId = modelId;
        this.client = new BedrockRuntimeClient({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
            }
        });
    }

    public async invokeModel(prompt: string): Promise<string> {
        const command = new InvokeModelCommand({
            modelId: this.modelId,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify({
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

        try {
            const response = await this.client.send(command);
            const responseData = JSON.parse(new TextDecoder().decode(response.body));
            return responseData?.content?.[0]?.text || '';
        } catch (error) {
            console.error('Error invoking Bedrock:', error);
            throw error;
        }
    }

    // ストリーミング用のメソッド
    public async streamResponse(prompt: string, onChunk: (chunk: string) => void): Promise<void> {
        try {
            const command = new InvokeModelWithResponseStreamCommand({
                modelId: this.modelId,
                contentType: "application/json",
                accept: "application/json",
                body: JSON.stringify({
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

            const response = await this.client.send(command);
            const decoder = new TextDecoder();

            for await (const chunk of response.body!) {
                if (chunk.chunk?.bytes) {
                    const decodedChunk = decoder.decode(chunk.chunk.bytes);
                    const parsedChunk = JSON.parse(decodedChunk);
                    if (parsedChunk.type === 'content_block_delta' && parsedChunk.delta?.text) {
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