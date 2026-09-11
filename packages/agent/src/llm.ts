/**
 * Minimal OpenRouter chat client. OpenRouter is model agnostic, so the same
 * client works across Anthropic, OpenAI, and others by changing the model slug.
 *
 * The reasoning model is the sensitive component: in production the key lives
 * inside the Chainlink CRE TEE and is fetched with runtime.getSecret(). Here in
 * the agent loop it is used for planning and hypothesis forming.
 */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmConfig {
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";

const RETIRED_OPENROUTER_MODELS: Record<string, string> = {
  "anthropic/claude-3.5-sonnet": DEFAULT_OPENROUTER_MODEL,
  "anthropic/claude-3.5-sonnet:beta": DEFAULT_OPENROUTER_MODEL,
  "anthropic/claude-3.7-sonnet": DEFAULT_OPENROUTER_MODEL,
  "anthropic/claude-3.7-sonnet:thinking": DEFAULT_OPENROUTER_MODEL,
};

function resolveModel(model: string | undefined): string {
  const requested = model || DEFAULT_OPENROUTER_MODEL;
  return RETIRED_OPENROUTER_MODELS[requested] ?? requested;
}

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    apiKey: env.OPENROUTER_API_KEY || undefined,
    model: resolveModel(env.OPENROUTER_MODEL),
    baseUrl: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  };
}

export class LlmClient {
  constructor(private readonly config: LlmConfig) {}

  get available(): boolean {
    return Boolean(this.config.apiKey);
  }

  async chat(messages: LlmMessage[], opts?: { temperature?: number; json?: boolean }): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error("OPENROUTER_API_KEY not set");
    }
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://stakefit.dev",
        "X-Title": "StakeFit",
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: opts?.temperature ?? 0.2,
        response_format: opts?.json ? { type: "json_object" } : undefined,
        messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return body.choices[0]?.message?.content ?? "";
  }
}
