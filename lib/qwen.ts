// Qwen client implementation
export class QwenClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = process.env.NEXT_PUBLIC_QWEN_API_KEY || process.env.QWEN_API_KEY || '';
    this.baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.model = process.env.QWEN_MODEL || 'qwen3.5';
  }

  async chatCompletion(messages: {role: string, content: string}[], temperature: number = 0.6) {
    if (!this.apiKey) {
      throw new Error('QWEN_API_KEY is required');
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Qwen API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }
}

// Export singleton instance
export const qwenClient = new QwenClient();