import type { Message, LlmResult, LlmLike, ToolUse } from "./types.js";

export interface FakeTurn {
  text?: string;
  toolUses?: ToolUse[];
}

/**
 * Scripted stand-in for LlmClient. Given the turn index and the running message
 * list, the script returns what the "model" should say next. Lets the whole
 * pipeline — baseline, agent loop, eval harness — run offline with zero spend.
 */
export class FakeLlm implements LlmLike {
  readonly model: string;
  private inTok = 0;
  private outTok = 0;
  private turn = 0;

  constructor(
    private readonly script: (ctx: {
      turn: number;
      messages: Message[];
    }) => FakeTurn,
    model = "fake",
  ) {
    this.model = model;
  }

  get usage() {
    return { inputTokens: this.inTok, outputTokens: this.outTok, costUsd: 0 };
  }

  async call(params: { messages: Message[] }): Promise<LlmResult> {
    const out = this.script({ turn: this.turn++, messages: params.messages });
    this.inTok += 120;
    this.outTok += 60;
    return {
      text: out.text ?? "",
      toolUses: out.toolUses ?? [],
      stopReason: out.toolUses?.length ? "tool_use" : "end_turn",
      inputTokens: 120,
      outputTokens: 60,
    };
  }
}
