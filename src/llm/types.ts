import type Anthropic from "@anthropic-ai/sdk";

export type Message = Anthropic.MessageParam;

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
}

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmResult {
  text: string;
  toolUses: ToolUse[];
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Common surface of the real client and the test double. */
export interface LlmLike {
  readonly model: string;
  readonly usage: LlmUsage;
  call(params: {
    system: string;
    messages: Message[];
    tools?: ToolSpec[];
    maxTokens?: number;
  }): Promise<LlmResult>;
}
