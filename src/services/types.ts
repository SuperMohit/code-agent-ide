import OpenAI from 'openai';

// Properly type the conversation messages to match OpenAI API types
export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface ConversationMessage {
  role: Role;
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ToolCallResult {
  tool_call_id: string;
  output: string;
  success: boolean;
}

export interface APIKeyValidation {
  valid: boolean;
  message?: string;
}

/**
 * Represents a summarized version of conversation history
 * Preserves important context like file references and code snippets
 */
export interface SummarizedHistoryMessage {
  role: 'system';
  content: string;
  summary_type: 'conversation_history';
  file_references?: string[];
  timestamp: number;
}
