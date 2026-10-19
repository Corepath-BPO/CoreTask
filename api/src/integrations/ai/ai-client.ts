/**
 * What CoreTask asks of a language model: pick from these tools.
 *
 * Every AI feature here is a decision rather than prose — which section, yes or
 * no, what comment — so the one shape needed is a tool call. Asking for tools
 * instead of parsing free text is also what keeps a model to the choices it was
 * offered: an answer outside a tool's schema is not an answer at all.
 */

/** One thing the model may do, with the JSON Schema of its arguments. */
export interface AiTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One thing the model chose to do. */
export interface AiToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AiRequest {
  system: string;
  prompt: string;
  tools: AiTool[];
  /** A tool the model must call. Without it the model must call at least one. */
  require?: string;
  maxTokens?: number;
}

/**
 * The model, behind an abstract class so Nest can inject it by type and a test
 * can hand the runner a stand-in without a network.
 */
export abstract class AiClient {
  /** Whether a model is configured. The steps grey out when it is not. */
  abstract readonly available: boolean;

  /** The tool calls the model made, in its order. Throws when it could not answer. */
  abstract call(request: AiRequest): Promise<AiToolCall[]>;
}

/** Thrown when an AI step runs on a server with no model configured. */
export class AiUnavailableError extends Error {
  constructor() {
    super('AI isn’t set up on this server.');
  }
}
