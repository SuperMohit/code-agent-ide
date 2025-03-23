import { IToolCallProcessorService, IToolExecutorService } from './interfaces';
import { ToolCallResult } from './types';

/**
 * Service responsible for processing tool calls from the OpenAI API
 */
export class ToolCallProcessorService implements IToolCallProcessorService {
  constructor(
    private readonly toolExecutor: IToolExecutorService
  ) {}

  /**
   * Process a list of tool calls and execute them
   * @param toolCalls The tool calls to process
   * @param breakingChangeTools List of tool names that require user confirmation
   * @returns Object containing results and whether user confirmation is required
   */
  public async processToolCalls(
    toolCalls: any[], 
    breakingChangeTools: string[]
  ): Promise<{ requiresUserConfirmation: boolean; results: ToolCallResult[] }> {
    const results: ToolCallResult[] = [];
    let requiresUserConfirmation = false;
    
    // Process each tool call
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      
      // Skip the 'done' tool as it's handled separately
      if (toolName === 'done') {
        continue;
      }
      
      try {
        // Parse function arguments
        const functionArgs = JSON.parse(toolCall.function.arguments);
        
        // Check if this tool requires user confirmation
        if (breakingChangeTools.includes(toolName) || this.toolExecutor.requiresUserConfirmation(toolName)) {
          requiresUserConfirmation = true;
        }
        
        // Execute the tool with a timeout
        const output = await this.toolExecutor.executeToolWithTimeout(
          toolName,
          functionArgs,
          30000 // 30 second timeout for regular tools
        );
        
        // Record the result
        results.push({
          tool_call_id: toolCall.id,
          output,
          success: true
        });
      } catch (error) {
        console.error(`Error executing tool ${toolName}:`, error);
        
        // Record the failure
        results.push({
          tool_call_id: toolCall.id,
          output: `Error: ${error instanceof Error ? error.message : String(error)}`,
          success: false
        });
      }
    }
    
    return { requiresUserConfirmation, results };
  }
}
