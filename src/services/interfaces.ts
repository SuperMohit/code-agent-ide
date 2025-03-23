import * as vscode from 'vscode';
import { ConversationMessage, ToolCallResult, SummarizedHistoryMessage } from './types';
import { DiagnosticInfo } from './DiagnosticsService';
import { SymbolInfo } from './types/SymbolInfo';
import { CodeActionInfo } from './types/CodeActionInfo';

/**
 * Interface for the OpenAI client service
 */
export interface IOpenAIClientService {
  initializeClient(): void;
  validateApiKey(): { valid: boolean; message?: string };
  createChatCompletion(messages: any[], tools: any[], model: string, temperature: number): Promise<any>;
  
  /**
   * Create a streaming chat completion using the OpenAI API
   * @param messages The conversation messages
   * @param tools The available tools
   * @param model The model to use (e.g., 'gpt-4o')
   * @param temperature The temperature setting
   * @param onChunk Callback function to process each chunk of the streaming response
   */
  createStreamingChatCompletion(
    messages: any[],
    tools: any[],
    model: string,
    temperature: number,
    onChunk: (chunk: any) => void
  ): Promise<void>;
}

/**
 * Interface for conversation management
 */
export interface IConversationService {
  getConversationHistory(): ConversationMessage[];
  addToConversationHistory(message: ConversationMessage): void;
  clearConversationHistory(): void;
  validateAndSanitizeConversationHistory(): ConversationMessage[];
  validateConversationHistory(): void;
  summarizeConversationHistory(maxTokens: number): Promise<SummarizedHistoryMessage>;
}

/**
 * Interface for context files management
 */
export interface IContextFilesService {
  readonly onDidUpdateContextFiles: vscode.Event<string[]>;
  getContextFiles(): string[];
  addContextFile(filePath: string): void;
  clearContextFiles(): void;
}

/**
 * Interface for tool execution
 */
export interface IToolExecutorService {
  executeToolWithTimeout(toolName: string, args: any, timeoutMs: number): Promise<string>;
  requiresUserConfirmation(toolName: string): boolean;
}

/**
 * Interface for message formatting
 */
export interface IMessageFormatterService {
  formatMessages(systemPrompt: string, conversationHistory: ConversationMessage[], lastError: Error | null): any[];
  shouldSummarizeHistory(conversationHistory: ConversationMessage[], maxPayloadSize: number, maxMessages: number): boolean;
}

/**
 * Interface for the agent loop handler
 */
export interface IAgentLoopService {
  executeAgentLoop(query: string): Promise<string>;
  
  /**
   * Execute the agent loop with streaming responses
   * @param query The user query to process
   * @param onChunk Callback function that receives each chunk of the streaming response
   * @returns The final complete response
   */
  executeStreamingAgentLoop(query: string, onChunk: (chunk: string) => void): Promise<string>;
}

/**
 * Interface for tool call processing
 */
export interface IToolCallProcessorService {
  processToolCalls(toolCalls: any[], breakingChangeTools: string[]): Promise<{ requiresUserConfirmation: boolean; results: ToolCallResult[] }>;
}

/**
 * Interface for response generation
 */
export interface IResponseGeneratorService {
  generateFinalResponse(assistantMessage: any): string;
}

/**
 * Interface for the diagnostics service
 */
export interface IDiagnosticsService {
  readonly onDidChangeDiagnostics: vscode.Event<DiagnosticInfo[]>;
  getAllDiagnostics(): DiagnosticInfo[];
  getDiagnosticsForFile(filePath: string): DiagnosticInfo[];
  getErrorDiagnostics(): DiagnosticInfo[];
  getTypeScriptDiagnostics(): DiagnosticInfo[];
  getFocusedDiagnosticsForFile(filePath: string): string;
  dispose(): void;
}

/**
 * Interface for the symbol information service
 */
export interface ISymbolInformationService {
  getSymbolsInFile(filePath: string): Promise<SymbolInfo[]>;
  getSymbolAtPosition(filePath: string, line: number, character: number): Promise<SymbolInfo | undefined>;
  findReferences(filePath: string, line: number, character: number): Promise<SymbolInfo[]>;
  getDefinition(filePath: string, line: number, character: number): Promise<SymbolInfo | undefined>;
  getDocumentSymbolHierarchy(filePath: string): Promise<string>;
}

/**
 * Interface for the code action service
 */
export interface ICodeActionService {
  getCodeActionsForRange(filePath: string, startLine: number, startCharacter: number, endLine: number, endCharacter: number): Promise<CodeActionInfo[]>;
  getCodeActionsForDiagnostic(filePath: string, diagnostic: DiagnosticInfo): Promise<CodeActionInfo[]>;
  applyCodeAction(filePath: string, codeAction: CodeActionInfo): Promise<boolean>;
  getQuickFixesForFile(filePath: string): Promise<string>;
}
