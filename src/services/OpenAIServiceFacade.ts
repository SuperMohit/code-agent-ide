import * as vscode from 'vscode';
import { IOpenAIClientService, IConversationService, IContextFilesService, IToolExecutorService, IAgentLoopService } from './interfaces';
import { OpenAIClientServiceImpl } from './OpenAIClientServiceImpl';
import { AgentLoopService } from './AgentLoopService';
import { MessageFormatterService } from './MessageFormatterService';
import { ToolCallProcessorService } from './ToolCallProcessorService';
import { ResponseGeneratorService } from './ResponseGeneratorService';

/**
 * Facade service that coordinates all OpenAI-related functionality
 * This replaces the original monolithic OpenAIService with a more modular approach
 */
export class OpenAIServiceFacade {
  private readonly agentLoopService: IAgentLoopService;
  
  // Re-export the onDidUpdateContextFiles event
  public readonly onDidUpdateContextFiles: vscode.Event<string[]>;
  
  constructor(
    private readonly openAIClient: IOpenAIClientService,
    private readonly conversationService: IConversationService,
    private readonly contextFilesService: IContextFilesService,
    private readonly toolExecutorService: IToolExecutorService,
    private readonly projectPath: string
  ) {
    // Setup event forwarding
    this.onDidUpdateContextFiles = this.contextFilesService.onDidUpdateContextFiles;
    
    // Initialize the OpenAI client
    this.openAIClient.initializeClient();
    
    // Create supporting services
    const messageFormatter = new MessageFormatterService();
    const toolCallProcessor = new ToolCallProcessorService(this.toolExecutorService);
    const responseGenerator = new ResponseGeneratorService();
    
    // Create the agent loop service that coordinates the AI interaction
    this.agentLoopService = new AgentLoopService(
      this.openAIClient,
      this.conversationService,
      messageFormatter,
      toolCallProcessor,
      responseGenerator,
      this.projectPath
    );
  }
  
  /**
   * Static factory method to create an instance with all required dependencies
   */
  public static create(
    openAIClient: IOpenAIClientService,
    conversationService: IConversationService,
    contextFilesService: IContextFilesService,
    toolExecutorService: IToolExecutorService,
    projectPath: string
  ): OpenAIServiceFacade {
    return new OpenAIServiceFacade(
      openAIClient,
      conversationService,
      contextFilesService,
      toolExecutorService,
      projectPath
    );
  }
  
  /**
   * Process a user query and generate a response
   * @param query The user's query
   * @returns Promise resolving to the AI's response
   */
  public async processQuery(query: string): Promise<string> {
    try {
      return await this.agentLoopService.executeAgentLoop(query);
    } catch (error) {
      console.error('Error processing query:', error);
      throw error;
    }
  }
  
  // Streaming functionality has been removed to avoid issues with tool calls
  
  /**
   * Validates the OpenAI API key
   * @returns Object containing validation result and message
   */
  public validateApiKey() {
    return this.openAIClient.validateApiKey();
  }
  
  /**
   * Get the list of context files
   * @returns Array of file paths used for context
   */
  public getContextFiles(): string[] {
    return this.contextFilesService.getContextFiles();
  }
  
  /**
   * Clear the list of context files
   */
  public clearContextFiles(): void {
    this.contextFilesService.clearContextFiles();
  }
  
  /**
   * Add a file to the context files list
   * @param filePath Path to the file to add
   */
  public addContextFile(filePath: string): void {
    this.contextFilesService.addContextFile(filePath);
  }
}
