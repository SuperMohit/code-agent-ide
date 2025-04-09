import { OpenAIServiceFacade } from './OpenAIServiceFacade';
import { OpenAIClientServiceImpl } from './OpenAIClientServiceImpl';
import { ConversationManager } from './ConversationManager';
import { ContextFilesManager } from './ContextFilesManager';
import { ToolExecutor } from './ToolExecutor';
import { DiagnosticsService } from './DiagnosticsService';
import { CodeActionService } from './CodeActionService';
import { SymbolInformationService } from './SymbolInformationService';
import { IDiagnosticsService, ICodeActionService, ISymbolInformationService } from './interfaces';

/**
 * Factory for creating and wiring up all the services
 * Simplifies dependency injection and service creation
 */
export class ServiceFactory {
  // Singleton instances of services
  private static diagnosticsService: IDiagnosticsService;
  private static codeActionService: ICodeActionService;
  private static symbolInformationService: ISymbolInformationService;

  
  /**
   * Create a new instance of the OpenAI service facade with all required dependencies
   * @returns A configured OpenAIServiceFacade instance
   */
  public static createOpenAIService(projectPath: string): OpenAIServiceFacade {
    // Create the core service implementations
    const openAIClient = new OpenAIClientServiceImpl();
    const conversationManager = new ConversationManager();
    const contextFilesManager = new ContextFilesManager();
    const toolExecutor = new ToolExecutor(contextFilesManager);

    
    // Create and return the facade that coordinates all services
    return OpenAIServiceFacade.create(
      openAIClient,
      conversationManager,
      contextFilesManager,
      toolExecutor,
      projectPath || ''
    );
  }
  
  /**
   * Get the diagnostics service (creates it if it doesn't exist)
   * @returns The diagnostics service instance
   */
  public static getDiagnosticsService(): IDiagnosticsService {
    if (!this.diagnosticsService) {
      this.diagnosticsService = new DiagnosticsService();
    }
    return this.diagnosticsService;
  }
  
  /**
   * Get the code action service (creates it if it doesn't exist)
   * @returns The code action service instance
   */
  public static getCodeActionService(): ICodeActionService {
    if (!this.codeActionService) {
      this.codeActionService = new CodeActionService();
    }
    return this.codeActionService;
  }
  
  /**
   * Get the symbol information service (creates it if it doesn't exist)
   * @returns The symbol information service instance
   */
  public static getSymbolInformationService(): ISymbolInformationService {
    if (!this.symbolInformationService) {
      this.symbolInformationService = new SymbolInformationService();
    }
    return this.symbolInformationService;
  }
}
