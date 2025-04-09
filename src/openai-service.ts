import * as vscode from 'vscode';
import { ServiceFactory } from './services/ServiceFactory';
import { OpenAIServiceFacade } from './services/OpenAIServiceFacade';

/**
 * OpenAIService - Facade/Adapter for the modular OpenAI service implementation
 * 
 * This class maintains the same public interface as the original OpenAIService
 * but delegates all functionality to the new refactored implementation.
 */
export class OpenAIService {
  // The actual service implementation
  private serviceImpl: OpenAIServiceFacade;
  
  // Re-export the onDidUpdateContextFiles event
  public readonly onDidUpdateContextFiles: vscode.Event<string[]>;
  
  constructor(projectPath : string) {
    // Initialize the modular service implementation using our factory
    this.serviceImpl = ServiceFactory.createOpenAIService(projectPath);
    
    // Connect the event from the implementation
    this.onDidUpdateContextFiles = this.serviceImpl.onDidUpdateContextFiles;
  }
  
  /**
   * Validates the OpenAI API key and returns an error message if invalid
   */
  public validateApiKey(): { valid: boolean; message?: string } {
    return this.serviceImpl.validateApiKey();
  }
  
  /**
   * Process a user query and generate a response
   */
  public async processQuery(query: string): Promise<string> {
    return this.serviceImpl.processQuery(query);
  }
  
  // Streaming functionality has been removed to avoid issues with tool calls
  
  /**
   * Add a file to the context files list
   * @param filePath The path to the file that was accessed
   */
  public addContextFile(filePath: string): void {
    this.serviceImpl.addContextFile(filePath);
  }
  
  /**
   * Get the list of context files
   * @returns Array of file paths that have been used for context
   */
  public getContextFiles(): string[] {
    return this.serviceImpl.getContextFiles();
  }
  
  /**
   * Clear the list of context files
   */
  public clearContextFiles(): void {
    this.serviceImpl.clearContextFiles();
  }
}
