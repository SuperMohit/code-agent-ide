import * as vscode from 'vscode';
import OpenAI from 'openai';
import { IOpenAIClientService } from './interfaces';

/**
 * Implementation of OpenAI client service that handles API communication
 */
export class OpenAIClientServiceImpl implements IOpenAIClientService {
  private client: OpenAI | null = null;
  
  /**
   * Initialize the OpenAI client with API key from settings
   */
  public initializeClient(): void {
    const apiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey');
    
    if (!apiKey || apiKey.trim() === '') {
      console.warn('OpenAI API key not configured');
      return;
    }
    
    try {
      this.client = new OpenAI({
        apiKey: apiKey.trim()
      });
      console.log('OpenAI client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize OpenAI client:', error);
    }
  }
  
  /**
   * Validate that the API key is configured and valid
   */
  public validateApiKey(): { valid: boolean; message?: string } {
    const apiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey');
    
    if (!apiKey || apiKey.trim() === '') {
      return {
        valid: false,
        message: 'OpenAI API key not configured. Please set it in the extension settings.'
      };
    }
    
    if (!this.client) {
      this.initializeClient();
    }
    
    return {
      valid: true,
      message: 'API key is configured'
    };
  }
  
  /**
   * Create a chat completion using the OpenAI API
   */
  public async createChatCompletion(
    messages: any[], 
    tools: any[], 
    model: string, 
    temperature: number
  ): Promise<any> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }
    
    // Validate key before making the API call
    const validation = this.validateApiKey();
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    
    try {
      return await this.client.chat.completions.create({
        model,
        messages,
        tools,
        temperature,
      });
    } catch (error) {
      console.error('Error creating chat completion:', error);
      throw error;
    }
  }
  
  /**
   * Create a streaming chat completion using the OpenAI API
   * @param messages The conversation messages
   * @param tools The available tools
   * @param model The model to use
   * @param temperature The temperature setting
   * @param onChunk Callback function for processing each chunk
   */
  public async createStreamingChatCompletion(
    messages: any[],
    tools: any[],
    model: string,
    temperature: number,
    onChunk: (chunk: any) => void
  ): Promise<void> {
    // TypeScript hack: even though we return a string, we declare return type as void to match interface
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }
    
    // Validate key before making the API call
    const validation = this.validateApiKey();
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    
    try {
      // Create a streaming completion
      const stream = await this.client.chat.completions.create({
        model,
        messages,
        tools,
        temperature,
        stream: true,
      });
      
      // Process each chunk as it arrives
      for await (const chunk of stream) {
        // Pass the raw chunk to the callback as expected by AgentLoopService
        onChunk(chunk);
      }
      // Return void (no return value) to match interface
    } catch (error) {
      console.error('Error creating streaming chat completion:', error);
      throw error;
    }
  }
}
