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
}

export interface APIKeyValidation {
  valid: boolean;
  message?: string;
}
