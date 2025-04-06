import * as vscode from 'vscode';
import { OpenAIClient } from './OpenAIClient';
import { ConversationManager } from './ConversationManager';
import { ContextFilesManager } from './ContextFilesManager';
import { ToolExecutor } from './ToolExecutor';
import { ConversationMessage, ToolCallResult, SummarizedHistoryMessage } from './types';
import { systemPrompt } from './systemPrompt';
import { getToolDefinitions } from '../tools/getTools';

/**
 * Main service that coordinates OpenAI interactions, conversation management,
 * context tracking, and tool execution
 */
export class OpenAIService {
  private openaiClient: OpenAIClient;
  private conversationManager: ConversationManager;
  private contextFilesManager: ContextFilesManager;
  private toolExecutor: ToolExecutor;
  
  // Re-export the onDidUpdateContextFiles event
  public readonly onDidUpdateContextFiles: vscode.Event<string[]>;
  
  constructor() {
    // Initialize components
    this.openaiClient = new OpenAIClient();
    this.conversationManager = new ConversationManager();
    this.contextFilesManager = new ContextFilesManager();
    this.toolExecutor = new ToolExecutor(this.contextFilesManager);
    
    // Setup event forwarding
    this.onDidUpdateContextFiles = this.contextFilesManager.onDidUpdateContextFiles;
    
    // Initialize OpenAI client
    this.openaiClient.initializeClient();
  }
  
  /**
   * Validates the OpenAI API key
   */
  public validateApiKey() {
    return this.openaiClient.validateApiKey();
  }
  
  /**
   * Helper method to sleep for a specified duration
   * @param ms Milliseconds to sleep
   * @returns Promise that resolves after the specified time
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Process a user query and generate a response through an agentic loop
   */
  public async processQuery(query: string): Promise<string> {
    try {
      console.log('Processing query with agentic loop:', query);
      
      // Track if we've encountered an OpenAI API error to ensure we break the loop
      let encounteredApiError = false;
      
      // Validate API key
      const validation = this.validateApiKey();
      if (!validation.valid) {
        throw new Error(validation.message);
      }
      
      // Get OpenAI client
      const client = this.openaiClient.getClient();
      
      // Add user message to conversation history
      this.conversationManager.addToConversationHistory({
        role: 'user',
        content: query
      });
      
      // Get tool definitions
      const tools = getToolDefinitions();
      
      // Define the specific tool names that require user confirmation
      const breakingChangeTools = [
        'create_file',
        'update_file',
        'create_directory',
        'run_command'
      ];
      
      // Initialize agentic loop variables
      let loopComplete = false;
      let finalResponse = '';
      let lastError: Error | null = null;
      let iterations = 0;
      const MAX_ITERATIONS = 5; // Safety limit to prevent infinite loops
      const MAX_PAYLOAD_SIZE = 10000; // Approximate character limit to trigger summarization
      const MAX_MESSAGES = 10; // Maximum number of messages before we consider summarizing

      while (!loopComplete && iterations < MAX_ITERATIONS) {
        iterations++;
        console.log(`Starting agentic iteration #${iterations}`);
        
        try {

          const conversationHistory = this.conversationManager.getConversationHistory();
          
          let messages = [
            { role: 'system', content: systemPrompt }
          ];
          
          if (lastError) {
            messages.push({
              role: 'user',
              content: `There was an error in the previous step: ${lastError.message}. Please handle this gracefully and adjust your approach.`
            });
            lastError = null; // Reset the error
          }
          
          let shouldSummarize = false;
          let totalPayloadSize = 0;
          
          for (const message of conversationHistory) {
            totalPayloadSize += message.content ? message.content.length : 0;
            if (message.tool_calls) {
              // Add rough estimate for tool calls
              message.tool_calls.forEach(tc => {
                totalPayloadSize += tc.function.name.length;
                totalPayloadSize += tc.function.arguments.length;
              });
            }
          }
          
          console.log(`Estimated payload size: ${totalPayloadSize} characters`);
          shouldSummarize = totalPayloadSize > MAX_PAYLOAD_SIZE || conversationHistory.length > MAX_MESSAGES;

          if (shouldSummarize && conversationHistory.length > 2) {
            console.log('Payload size too large, summarizing conversation history');
            
            const latestMessages = conversationHistory.slice(-2);  // Keep most recent exchange
            const olderMessages = conversationHistory.slice(0, -2);
            
            if (olderMessages.length > 0) {
              const originalHistory = [...this.conversationManager.getConversationHistory()];
              
              this.conversationManager.clearConversationHistory();
              olderMessages.forEach(msg => this.conversationManager.addToConversationHistory(msg));
              
              const summary = await this.conversationManager.summarizeConversationHistory(2000);
              
              this.conversationManager.clearConversationHistory();
              originalHistory.forEach(msg => this.conversationManager.addToConversationHistory(msg));
              
              messages.push(summary as any);
              messages = [...messages, ...latestMessages];
              
              console.log('Conversation history summarized successfully');
            } else {
              messages = [...messages, ...conversationHistory];
            }
          } else {
            messages = [...messages, ...conversationHistory];
          }
          
          let response;
          try {
            response = await client.chat.completions.create({
              model: 'gpt-4o',
              messages: messages as any,
              tools: tools,
              temperature: 0.8,
            });
          } catch (error) {
            console.error('OpenAI API error during completion creation:', error);
            

            if (error instanceof Error && (
              error.message.includes('400 Invalid parameter') ||
              error.message.includes('messages with role \'tool\'') ||
              error.message.includes('invalid_request_error')
            )) {
              console.error('Critical OpenAI API validation error, breaking loop immediately');
              
              console.log('Clearing conversation history due to OpenAI API error');
              this.conversationManager.clearConversationHistory();
              
              const apiError = new Error('OPENAI_API_ERROR: ' + error.message);
              apiError.name = 'OpenAIApiValidationError';
              throw apiError; // This will bubble up to the AgentLoopService
            }
            
            // Rethrow other errors
            throw error;
          }
          
          const assistantMessage = response.choices[0].message;
          
          this.conversationManager.addToConversationHistory(assistantMessage as any);
          

          if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
            console.log('No tool calls, completing agentic loop');
            finalResponse = assistantMessage.content || '';
            loopComplete = true;
            continue;
          }
          
          console.log(`Processing ${assistantMessage.tool_calls.length} tool calls`);
          

          const doneToolCall = assistantMessage.tool_calls.find(toolCall => 
            toolCall.function.name === 'done'
          );
          
          if (doneToolCall) {
            console.log('Done tool detected, breaking the agentic loop');
            
            try {

              const functionArgs = JSON.parse(doneToolCall.function.arguments);
              const output = await this.toolExecutor.executeToolWithTimeout(
                'done',
                functionArgs,
                5000 
              );
              
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: doneToolCall.id,
                content: output
              });
              
              finalResponse = `Task completed: ${functionArgs.summary}`;
              loopComplete = true;
              continue;
            } catch (error) {
              console.error('Error executing done tool:', error);
              
              const isOpenAIError = error instanceof Error && 
                (error.message.includes('400 Invalid parameter') || 
                 error.message.includes('invalid_request_error') ||
                 error.message.includes('OpenAI API'));
              
              if (isOpenAIError) {
                console.error('Detected OpenAI API error in done tool, breaking the loop');
                loopComplete = true;
                finalResponse = `I'm having trouble processing your request due to an API error. Please try again with a simpler query.`;
                continue;
              }
              
              const errorMessage = error instanceof Error ? error.message : String(error);
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: doneToolCall.id,
                content: `Error executing tool: ${errorMessage}`
              });
              
              lastError = error instanceof Error ? error : new Error(String(error));
              
              await this.sleep(1000);
              continue;
            }
          }
          
          let needsPermission = false;
          let permissionMessage = '';
          
          const breakingTools = assistantMessage.tool_calls.filter(toolCall => {
            return breakingChangeTools.includes(toolCall.function.name);
          });

          if (breakingTools.length > 0) {
            needsPermission = true;
            
            permissionMessage = 'I need your permission to perform the following operations:\n\n';
            
            for (const toolCall of breakingTools) {
              const functionName = toolCall.function.name;
              const functionArgs = JSON.parse(toolCall.function.arguments);
              
              switch (functionName) {
                case 'create_file':
                  permissionMessage += `• Create a new file at: ${functionArgs.FilePath}\n`;
                  break;
                case 'update_file':
                  permissionMessage += `• Update the file at: ${functionArgs.FilePath}\n`;
                  break;
                case 'create_directory':
                  permissionMessage += `• Create a new directory at: ${functionArgs.DirectoryPath}\n`;
                  break;
                case 'run_command':
                  permissionMessage += `• Run the command: ${functionArgs.CommandLine} in ${functionArgs.Cwd}\n`;
                  break;
              }
            }
            
            permissionMessage += '\nDo you want to allow these operations? (yes/no)';

            for (const toolCall of assistantMessage.tool_calls) {
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: 'Waiting for user permission...'
              });
            }
            
            this.conversationManager.addToConversationHistory({
              role: 'assistant',
              content: permissionMessage
            });
            
            return permissionMessage;
          }
          
          for (const toolCall of assistantMessage.tool_calls) {
            console.log(`Executing tool call: ${toolCall.function.name}`);
            
            try {
              const functionName = toolCall.function.name;
              const functionArgs = JSON.parse(toolCall.function.arguments);
              
              const output = await this.toolExecutor.executeToolWithTimeout(
                functionName, 
                functionArgs,
                30000 // 30 second timeout
              );
              
              // Add the tool response to the conversation history
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: output
              });
            } catch (error) {
              console.error('Error executing tool call:', error);
              
              // Check if this is an OpenAI API error
              const isOpenAIError = error instanceof Error && 
                (error.message.includes('400 Invalid parameter') || 
                 error.message.includes('invalid_request_error') ||
                 error.message.includes('OpenAI API'));
              
              if (isOpenAIError) {
                console.error('Detected OpenAI API error in tool call, breaking the loop');
                loopComplete = true;
                finalResponse = `I'm having trouble processing your request due to an API error. Please try again with a simpler query.`;
                break; // Exit the tool call loop
              }
              
              // For non-OpenAI API errors, add a placeholder response to maintain API validity
              const errorMessage = error instanceof Error ? error.message : String(error);
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error executing tool: ${errorMessage}`
              });
              
              lastError = error instanceof Error ? error : new Error(String(error));
              
              await this.sleep(1000);
            }
          }
          
        } catch (error) {
          console.error(`Error in agentic loop iteration #${iterations}:`, error);
          
          const isOpenAIError = error instanceof Error && 
            (error.message.includes('400 Invalid parameter') || 
             error.message.includes('invalid_request_error') ||
             error.message.includes('OpenAI API'));
          
          if (isOpenAIError) {
            console.error('Detected OpenAI API error, breaking the loop');
            loopComplete = true;
            
            console.log('Sanitizing conversation history to remove invalid tool messages');
            this.conversationManager.sanitizeToolMessages();
            
            this.conversationManager.clearConversationHistory();
            console.log('Cleared conversation history due to OpenAI API error in iteration');
            
            finalResponse = `I encountered an API error while processing your request. The conversation has been reset. Please try again with a simpler query.`;
            
            return finalResponse;
          }
          
          lastError = error instanceof Error ? error : new Error(String(error));
          
          await this.sleep(1000);
          
          if (iterations >= MAX_ITERATIONS - 1) {
            loopComplete = true;
            finalResponse = `I encountered multiple errors while processing your request. Last error: ${lastError.message}`;
          }
        }
      }
      
      return finalResponse;
    } catch (error) {
      console.error('Critical error in processQuery:', error);
      
      try {
        return await this.processQuerySimple(query);
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        return `I encountered an error processing your request: ${error}. Please try again or check your OpenAI API key settings.`;
      }
    }
  }
  
  /**
   * Continue processing after receiving user permission for breaking changes
   */
  public async continueWithPermission(userResponse: string): Promise<string> {
    console.log('Continuing with permission response:', userResponse);
    
    const permissionGranted = userResponse.toLowerCase().includes('yes');
    
    this.conversationManager.addToConversationHistory({
      role: 'user',
      content: userResponse
    });
    
    if (permissionGranted) {
      const history = this.conversationManager.getConversationHistory();
      let lastAssistantWithTools = null;
      
      for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i];
        if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
          lastAssistantWithTools = message;
          break;
        }
      }
      
      if (lastAssistantWithTools && lastAssistantWithTools.tool_calls) {
        console.log('Found pending tool calls to execute');
        
        for (const toolCall of lastAssistantWithTools.tool_calls) {
          try {
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);
            
            console.log(`Executing permitted tool call: ${functionName}`);
            
            const output = await this.toolExecutor.executeToolWithTimeout(
              functionName, 
              functionArgs,
              30000 // 30 second timeout
            );
            
            const history = this.conversationManager.getConversationHistory();
            let placeholderResponseFound = false;
            
            for (let i = 0; i < history.length; i++) {
              const message = history[i];
              if (
                message.role === 'tool' && 
                message.tool_call_id === toolCall.id && 
                message.content === 'Waiting for user permission...'
              ) {
                history[i].content = output;
                placeholderResponseFound = true;
                console.log(`Updated placeholder response for tool call ${toolCall.id}`);
                break;
              }
            }
            
            if (!placeholderResponseFound) {
              console.log(`No placeholder found for tool call ${toolCall.id}, adding new response`);
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: output
              });
            }
          } catch (error) {
            console.error('Error executing tool call:', error);
            
            const history = this.conversationManager.getConversationHistory();
            let placeholderResponseFound = false;
            
            for (let i = 0; i < history.length; i++) {
              const message = history[i];
              if (
                message.role === 'tool' && 
                message.tool_call_id === toolCall.id && 
                message.content === 'Waiting for user permission...'
              ) {
                history[i].content = `Error: ${error}`;
                placeholderResponseFound = true;
                console.log(`Updated placeholder with error for tool call ${toolCall.id}`);
                break;
              }
            }
            if (!placeholderResponseFound) {
              console.log(`No placeholder found for tool call ${toolCall.id}, adding new error response`);
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: ${error}`
              });
            }
          }
        }
      } else {
        console.warn('No pending tool calls found to execute');
      }
    }
    
    const client = this.openaiClient.getClient();
    
    const conversationHistory = this.conversationManager.getConversationHistory();
    
    const tools = getToolDefinitions();
    
    const messages = [
      { role: 'system', content: systemPrompt }
    ];
    
    if (!permissionGranted) {
      messages.push({
        role: 'system',
        content: 'Permission was denied by the user. Acknowledge this to the user and suggest alternative approaches that don\'t require file or system changes.'
      } as any);
    }
    
    messages.push(...conversationHistory);
    
    console.log('Sending conversation with', messages.length, 'messages to OpenAI');
    
    const response = await client.chat.completions.create({
      model: 'gpt-4',
      messages: messages as any,
      tools: tools,
      temperature: 0.9,
    });
    
    const assistantMessage = response.choices[0].message;
    
    this.conversationManager.addToConversationHistory(assistantMessage as any);
    
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      return this.processQuery('');
    } else {
      return assistantMessage.content || '';
    }
  }
  
  /**
   * Simplified version of processQuery that doesn't use tools
   * This is used as a fallback when there's an issue with the tool-based flow
   */
  private async processQuerySimple(query: string): Promise<string> {
    try {
      console.log('Processing simple query (fallback):', query);
      
      const validation = this.validateApiKey();
      if (!validation.valid) {
        throw new Error(validation.message);
      }
      
      const client = this.openaiClient.getClient();
      
      this.conversationManager.addToConversationHistory({
        role: 'user',
        content: query
      });
      
      const conversationHistory = this.conversationManager.getConversationHistory();
      
      const messages = [
        { role: 'system', content: 'You are a helpful coding assistant. Due to technical limitations, you cannot use tools in this conversation.' },
        ...conversationHistory
      ];
      
      const response = await client.chat.completions.create({
        model: 'gpt-4',
        messages: messages as any,
        temperature: 0.9,
      });
      
      const assistantMessage = response.choices[0].message;
      
      this.conversationManager.addToConversationHistory(assistantMessage as any);
      
      return assistantMessage.content || '';
    } catch (error) {
      console.error('Error processing simple query:', error);
      return `I encountered an error processing your request: ${error}. Please try again or check your OpenAI API key settings.`;
    }
  }
  
  /**
   * Get the list of context files
   */
  public getContextFiles(): string[] {
    return this.contextFilesManager.getContextFiles();
  }
  
  /**
   * Clear the list of context files
   */
  public clearContextFiles(): void {
    this.contextFilesManager.clearContextFiles();
  }
  
  /**
   * Add a file to the context files list
   */
  public addContextFile(filePath: string): void {
    this.contextFilesManager.addContextFile(filePath);
  }
}
