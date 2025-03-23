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
      
      // Start the agentic loop
      while (!loopComplete && iterations < MAX_ITERATIONS) {
        iterations++;
        console.log(`Starting agentic iteration #${iterations}`);
        
        try {
          // Get current conversation history
          const conversationHistory = this.conversationManager.getConversationHistory();
          
          // Create messages for this iteration
          let messages = [
            { role: 'system', content: systemPrompt }
          ];
          
          // If there was an error in the previous iteration, add a special message about it
          if (lastError) {
            messages.push({
              role: 'user',
              content: `There was an error in the previous step: ${lastError.message}. Please handle this gracefully and adjust your approach.`
            });
            lastError = null; // Reset the error
          }
          
          // Check if we need to summarize conversation history due to large payload
          let shouldSummarize = false;
          let totalPayloadSize = 0;
          
          // Estimate payload size
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
          
          // Add conversation history (either summarized or full)
          if (shouldSummarize && conversationHistory.length > 2) {
            console.log('Payload size too large, summarizing conversation history');
            
            // Keep the latest user message but summarize the rest
            const latestMessages = conversationHistory.slice(-2);  // Keep most recent exchange
            const olderMessages = conversationHistory.slice(0, -2);
            
            // Only summarize if we have older messages to summarize
            if (olderMessages.length > 0) {
              // Save original history
              const originalHistory = [...this.conversationManager.getConversationHistory()];
              
              // Temporarily replace history with older messages for summarization
              this.conversationManager.clearConversationHistory();
              olderMessages.forEach(msg => this.conversationManager.addToConversationHistory(msg));
              
              // Generate summary using OpenAI
              const summary = await this.conversationManager.summarizeConversationHistory(2000);
              
              // Restore original history
              this.conversationManager.clearConversationHistory();
              originalHistory.forEach(msg => this.conversationManager.addToConversationHistory(msg));
              
              // Add summary and latest messages
              messages.push(summary as any);
              messages = [...messages, ...latestMessages];
              
              console.log('Conversation history summarized successfully');
            } else {
              // If not enough history to summarize, just use the full history
              messages = [...messages, ...conversationHistory];
            }
          } else {
            // Use full conversation history if not summarizing
            messages = [...messages, ...conversationHistory];
          }
          
          // Call OpenAI API to get assistant's action/thought
          const response = await client.chat.completions.create({
            model: 'gpt-4o',
            messages: messages as any,
            tools: tools,
            temperature: 0.8,
          });
          
          const assistantMessage = response.choices[0].message;
          
          // Add the assistant's response to the conversation history
          this.conversationManager.addToConversationHistory(assistantMessage as any);
          
          // Check if we're done (no tool calls)
          if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
            console.log('No tool calls, completing agentic loop');
            finalResponse = assistantMessage.content || '';
            loopComplete = true;
            continue;
          }
          
          // Process tool calls
          console.log(`Processing ${assistantMessage.tool_calls.length} tool calls`);
          
          // Check if the 'done' tool is called
          const doneToolCall = assistantMessage.tool_calls.find(toolCall => 
            toolCall.function.name === 'done'
          );
          
          if (doneToolCall) {
            console.log('Done tool detected, breaking the agentic loop');
            
            try {
              // Execute the done tool to get the summary
              const functionArgs = JSON.parse(doneToolCall.function.arguments);
              const output = await this.toolExecutor.executeToolWithTimeout(
                'done',
                functionArgs,
                5000 // Short timeout for done tool
              );
              
              // Add the tool response to the conversation history
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: doneToolCall.id,
                content: output
              });
              
              // Set finalResponse to the summary and complete the loop
              finalResponse = `Task completed: ${functionArgs.summary}`;
              loopComplete = true;
              continue;
            } catch (error) {
              console.error('Error executing done tool:', error);
              
              // Check if this is an OpenAI API error
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
              
              // For non-OpenAI API errors, add a placeholder response to maintain API validity
              const errorMessage = error instanceof Error ? error.message : String(error);
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: doneToolCall.id,
                content: `Error executing tool: ${errorMessage}`
              });
              
              lastError = error instanceof Error ? error : new Error(String(error));
              
              // Sleep for 1 second before continuing to prevent rapid retries
              await this.sleep(1000);
              continue;
            }
          }
          
          // Flag to track if any breaking changes need user permission
          let needsPermission = false;
          let permissionMessage = '';
          
          // Group tools that need permission
          const breakingTools = assistantMessage.tool_calls.filter(toolCall => {
            return breakingChangeTools.includes(toolCall.function.name);
          });
          
          // Ask for permission if there are breaking changes
          if (breakingTools.length > 0) {
            needsPermission = true;
            
            // Format a user-friendly permission message
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
            
            // Important: Add placeholder responses for all tool calls to satisfy OpenAI's requirement
            // that every tool call must have a corresponding response
            for (const toolCall of assistantMessage.tool_calls) {
              // Add a pending placeholder response for each tool call
              this.conversationManager.addToConversationHistory({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: 'Waiting for user permission...'
              });
            }
            
            // Add the permission request to the conversation
            this.conversationManager.addToConversationHistory({
              role: 'assistant',
              content: permissionMessage
            });
            
            // Return here and wait for user's permission
            return permissionMessage;
          }
          
          // Execute tool calls (if we don't need permission)
          for (const toolCall of assistantMessage.tool_calls) {
            console.log(`Executing tool call: ${toolCall.function.name}`);
            
            try {
              // Parse the function arguments
              const functionName = toolCall.function.name;
              const functionArgs = JSON.parse(toolCall.function.arguments);
              
              // Execute the tool
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
              
              // Save the error for the next iteration
              lastError = error instanceof Error ? error : new Error(String(error));
              
              // Sleep for 1 second to prevent rapid retries after an error
              await this.sleep(1000);
            }
          }
          
        } catch (error) {
          console.error(`Error in agentic loop iteration #${iterations}:`, error);
          
          // Check if this is an OpenAI API error
          const isOpenAIError = error instanceof Error && 
            (error.message.includes('400 Invalid parameter') || 
             error.message.includes('invalid_request_error') ||
             error.message.includes('OpenAI API'));
          
          if (isOpenAIError) {
            console.error('Detected OpenAI API error, breaking the loop');
            loopComplete = true;
            finalResponse = `I'm having trouble processing your request due to an API error. Please try again with a simpler query.`;
            
            // Don't set lastError, as we don't want to add this to the conversation history
            continue;
          }
          
          // For other errors, continue the loop with retries
          lastError = error instanceof Error ? error : new Error(String(error));
          
          // Sleep for 1 second before continuing to prevent rapid retries
          await this.sleep(1000);
          
          // If we've hit the maximum number of retries, exit the loop
          if (iterations >= MAX_ITERATIONS - 1) {
            loopComplete = true;
            finalResponse = `I encountered multiple errors while processing your request. Last error: ${lastError.message}`;
          }
        }
      }
      
      // Return the final response
      return finalResponse;
    } catch (error) {
      console.error('Critical error in processQuery:', error);
      
      // Try with a simplified approach if the tool-based query fails
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
    
    // Check if the user granted permission
    const permissionGranted = userResponse.toLowerCase().includes('yes');
    
    // Add the user's response to the conversation history
    this.conversationManager.addToConversationHistory({
      role: 'user',
      content: userResponse
    });
    
    // Handle the case differently based on permission
    if (permissionGranted) {
      // Execute the pending tool calls that were previously shown to the user
      // First, find the most recent assistant message with tool calls
      const history = this.conversationManager.getConversationHistory();
      let lastAssistantWithTools = null;
      
      // Find the most recent assistant message with tool calls (going backwards)
      for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i];
        if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
          lastAssistantWithTools = message;
          break;
        }
      }
      
      if (lastAssistantWithTools && lastAssistantWithTools.tool_calls) {
        console.log('Found pending tool calls to execute');
        
        // Execute each tool call that required permission
        for (const toolCall of lastAssistantWithTools.tool_calls) {
          try {
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);
            
            console.log(`Executing permitted tool call: ${functionName}`);
            
            // Execute the tool
            const output = await this.toolExecutor.executeToolWithTimeout(
              functionName, 
              functionArgs,
              30000 // 30 second timeout
            );
            
            // Find and update the existing placeholder response for this tool call
            const history = this.conversationManager.getConversationHistory();
            let placeholderResponseFound = false;
            
            // Look for the placeholder response and update it
            for (let i = 0; i < history.length; i++) {
              const message = history[i];
              if (
                message.role === 'tool' && 
                message.tool_call_id === toolCall.id && 
                message.content === 'Waiting for user permission...'
              ) {
                // Replace the placeholder with the actual output
                history[i].content = output;
                placeholderResponseFound = true;
                console.log(`Updated placeholder response for tool call ${toolCall.id}`);
                break;
              }
            }
            
            // If no placeholder was found, add a new response (should not happen, but just in case)
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
            
            // Find and update the existing placeholder response for this tool call
            const history = this.conversationManager.getConversationHistory();
            let placeholderResponseFound = false;
            
            // Look for the placeholder response and update it with the error
            for (let i = 0; i < history.length; i++) {
              const message = history[i];
              if (
                message.role === 'tool' && 
                message.tool_call_id === toolCall.id && 
                message.content === 'Waiting for user permission...'
              ) {
                // Replace the placeholder with the error message
                history[i].content = `Error: ${error}`;
                placeholderResponseFound = true;
                console.log(`Updated placeholder with error for tool call ${toolCall.id}`);
                break;
              }
            }
            
            // If no placeholder was found, add a new error response (shouldn't happen)
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
    
    // Get OpenAI client
    const client = this.openaiClient.getClient();
    
    // Get current conversation history with tool responses
    const conversationHistory = this.conversationManager.getConversationHistory();
    
    // Get tool definitions
    const tools = getToolDefinitions();
    
    // Create messages for this request
    const messages = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Add guidance about the permission decision if it was denied
    if (!permissionGranted) {
      messages.push({
        role: 'system',
        content: 'Permission was denied by the user. Acknowledge this to the user and suggest alternative approaches that don\'t require file or system changes.'
      } as any);
    }
    
    // Add the conversation history
    messages.push(...conversationHistory);
    
    console.log('Sending conversation with', messages.length, 'messages to OpenAI');
    
    // Call OpenAI API to continue the conversation
    const response = await client.chat.completions.create({
      model: 'gpt-4',
      messages: messages as any,
      tools: tools,
      temperature: 0.2,
    });
    
    const assistantMessage = response.choices[0].message;
    
    // Add the assistant's response to the conversation history
    this.conversationManager.addToConversationHistory(assistantMessage as any);
    
    // If there are new tool calls in the response, process them
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // Continue the agentic loop with an empty query to process these new tool calls
      return this.processQuery('');
    } else {
      // Return the assistant's text response
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
      
      // Get current conversation history
      const conversationHistory = this.conversationManager.getConversationHistory();
      
      // Add system message at the beginning
      const messages = [
        { role: 'system', content: 'You are a helpful coding assistant. Due to technical limitations, you cannot use tools in this conversation.' },
        ...conversationHistory
      ];
      
      // Make the API call to get the assistant's response
      const response = await client.chat.completions.create({
        model: 'gpt-4',
        messages: messages as any,
        temperature: 0.9,
      });
      
      const assistantMessage = response.choices[0].message;
      
      // Add the assistant's response to the conversation history
      this.conversationManager.addToConversationHistory(assistantMessage as any);
      
      // Return the assistant's response
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
