import * as vscode from 'vscode';
import OpenAI from 'openai';
import { APIKeyValidation } from './types';

/**
 * Handles the OpenAI API client initialization and validation
 */
export class OpenAIClient {
  private client: OpenAI | null = null;

  /**
   * Initialize the OpenAI client with the API key from VS Code settings
   */
  public initializeClient(): OpenAI {
    const apiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey');
    
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured');
    }
    
    this.client = new OpenAI({
      apiKey: apiKey
    });
    
    return this.client;
  }

  /**
   * Get the OpenAI client instance, initializing it if needed
   */
  public getClient(): OpenAI {
    if (!this.client) {
      return this.initializeClient();
    }
    return this.client;
  }

  /**
   * Validates the OpenAI API key and returns an error message if invalid
   */
  public validateApiKey(): APIKeyValidation {
    const apiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey');
    
    if (!apiKey || apiKey.trim() === '') {
      return {
        valid: false,
        message: 'OpenAI API key is not configured. Please set it in VS Code settings (File > Preferences > Settings > Extensions > Quest1 Code Assistant).'
      };
    }
    
    // Check if the API key has the correct format (sk-...)
    if (!apiKey.startsWith('sk-')) {
      return {
        valid: false,
        message: 'Invalid OpenAI API key format. API keys should start with "sk-"'
      };
    }
    
    return { valid: true };
  }
}
