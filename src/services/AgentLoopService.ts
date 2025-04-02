import * as vscode from 'vscode';
import { IAgentLoopService, IOpenAIClientService, IConversationService, IMessageFormatterService, IToolCallProcessorService, IResponseGeneratorService } from './interfaces';
import { systemPrompt } from './systemPrompt';
import { getToolDefinitions } from '../tools/getTools';
import { ConversationMessage } from './types';

/**
 * Service responsible for executing the agentic loop
 */
export class AgentLoopService implements IAgentLoopService {
  // Define constants for iteration control
  private readonly MAX_ITERATIONS = 10; // Safety limit to prevent infinite loops
  private readonly MAX_PAYLOAD_SIZE = 100000; // Approximate character limit to trigger summarization
  private readonly MAX_MESSAGES = 12; // Maximum number of messages before we consider summarizing
  
  // Define the specific tool names that require user confirmation
  private readonly BREAKING_CHANGE_TOOLS = [
    'create_file',
    'update_file',
    'create_directory',
    'run_command'
  ];

  constructor(
    private readonly openAIClient: IOpenAIClientService,
    private readonly conversationService: IConversationService,
    private readonly messageFormatter: IMessageFormatterService,
    private readonly toolCallProcessor: IToolCallProcessorService,
    private readonly responseGenerator: IResponseGeneratorService
  ) {}

  /**
   * Execute the agent loop to process a user query
   * @param query The user query to process
   * @returns The final response
   */
  public async executeAgentLoop(query: string): Promise<string> {
    console.log('Processing query with agentic loop:', query);
    
    try {
    
    // Validate API key (assuming this returns detailed information)
    const validation = this.openAIClient.validateApiKey();
    if (!validation.valid) {
      throw new Error(`OpenAI API key validation failed: ${validation.message}`);
    }
    
    // Add user query to conversation history
    this.conversationService.addToConversationHistory({
      role: 'user',
      content: query
    });
    
    // Get tool definitions
    const tools = getToolDefinitions();
    
    // Initialize agentic loop variables
    let loopComplete = false;
    let finalResponse = '';
    let lastError: Error | null = null;
    let iterations = 0;
    
    // Add a flag to force exit in case of API errors
    let forceExitLoop = false;
    
    // Start the agentic loop
    while (!loopComplete && !forceExitLoop && iterations < this.MAX_ITERATIONS) {
      iterations++;
      console.log(`Starting agentic iteration #${iterations}`);
      
      try {
        // Get current conversation history
        const conversationHistory = this.conversationService.getConversationHistory();
        
        // Create messages for this iteration
        let messages = this.messageFormatter.formatMessages(
          systemPrompt, 
          conversationHistory, 
          lastError
        );
        
        // Check if we need to summarize conversation history due to large payload
        const shouldSummarize = this.messageFormatter.shouldSummarizeHistory(
          conversationHistory,
          this.MAX_PAYLOAD_SIZE,
          this.MAX_MESSAGES
        );
        
        // Summarize conversation history if needed
        if (shouldSummarize && conversationHistory.length > 2) {
          console.log('Payload size too large, summarizing conversation history');
          
          // Keep the latest user message but summarize the rest
          const latestMessages = conversationHistory.slice(-2);  // Keep most recent exchange
          const olderMessages = conversationHistory.slice(0, -2);
          
          // Only summarize if we have older messages to summarize
          if (olderMessages.length > 0) {
            // Save original history
            const originalHistory = [...this.conversationService.getConversationHistory()];
            
            // Temporarily replace history with older messages for summarization
            this.conversationService.clearConversationHistory();
            olderMessages.forEach(msg => this.conversationService.addToConversationHistory(msg));
            
            // Generate summary using OpenAI
            const summary = await this.conversationService.summarizeConversationHistory(2000);
            
            // Restore original history
            this.conversationService.clearConversationHistory();
            originalHistory.forEach(msg => this.conversationService.addToConversationHistory(msg));
            
            // Add summary and latest messages
            messages = [
              { role: 'system', content: systemPrompt },
              // Ensure summary has the required 'role' property (OpenAI expects it)
              { role: 'assistant', content: typeof summary === 'string' ? summary : (summary as any).content || JSON.stringify(summary) },
              ...latestMessages
            ];
            
            console.log('Conversation history summarized successfully');
          }
        }
        
        // Call OpenAI API to get assistant's action/thought
        let response;
        let assistantMessage;
        
        try {
          response = await this.openAIClient.createChatCompletion(
            messages as any,
            tools,
            'gpt-4o',
            0.8
          );
          
          assistantMessage = response.choices[0].message;
        } catch (apiError) {
          console.error('Critical error in OpenAI API call:', apiError);
          
          // Check if this is an OpenAI API validation error
          if (apiError instanceof Error && (
            apiError.message.includes('400 Invalid parameter') ||
            apiError.message.includes('messages with role \'tool\' must be a response') ||
            apiError.message.includes('invalid_request_error')
          )) {
            console.error('Detected OpenAI API validation error, breaking loop immediately');
            
            // First sanitize the conversation history to remove invalid tool call/response pairs
            console.log('Sanitizing conversation history to remove invalid tool messages');
            this.conversationService.sanitizeToolMessages();
            
            // Then clear the entire conversation history to ensure a clean state
            this.conversationService.clearConversationHistory();
            console.log('Cleared conversation history due to OpenAI API validation error');
            
            // Force exit the loop immediately
            forceExitLoop = true;
            loopComplete = true;
            finalResponse = `I encountered an API error while processing your request. The conversation has been reset. Please try your question again with simpler instructions.`;
            
            // Break out of the current iteration
            break;
          }
          
          // Re-throw for normal error handling path
          throw apiError;
        }
        
        // Add the assistant's response to the conversation history
        this.conversationService.addToConversationHistory(assistantMessage as any);
        
        // Check if we're done (no tool calls)
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          console.log('No tool calls, completing agentic loop');
          finalResponse = this.responseGenerator.generateFinalResponse(assistantMessage);
          loopComplete = true;
          continue;
        }
        
        // Process tool calls
        console.log(`Processing ${assistantMessage.tool_calls.length} tool calls`);
        
        // Check if the 'done' tool is called
        const doneToolCall = assistantMessage.tool_calls.find((toolCall: { function: { name: string } }) => 
          toolCall.function.name === 'done'
        );
        
        if (doneToolCall) {
          console.log('Done tool detected, breaking the agentic loop');
          
          try {
            // Process the done tool call
            const { results } = await this.toolCallProcessor.processToolCalls([doneToolCall], []);
            
            // Add tool responses to conversation history
            results.forEach(result => {
              this.conversationService.addToConversationHistory({
                role: 'tool',
                tool_call_id: result.tool_call_id,
                content: result.output
              });
            });
            
            // Get the output from the done tool as the final response
            finalResponse = results[0]?.output || this.responseGenerator.generateFinalResponse(assistantMessage);
            loopComplete = true;
          } catch (error) {
            console.error('Error processing done tool:', error);
            lastError = error instanceof Error ? error : new Error(String(error));
          }
          
          continue;
        }
        
        // Process regular tool calls
        const { requiresUserConfirmation, results } = await this.toolCallProcessor.processToolCalls(
          assistantMessage.tool_calls,
          this.BREAKING_CHANGE_TOOLS
        );
        
        // If any tools require user confirmation, ask for it
        if (requiresUserConfirmation) {
          // Show a notification to the user
          const response = await vscode.window.showWarningMessage(
            'The AI assistant is requesting permission to make changes to your workspace. Approve?',
            'Approve', 'Deny'
          );
          
          if (response !== 'Approve') {
            throw new Error('User denied permission for the assistant to make changes');
          }
        }
        
        // Add tool responses to conversation history
        results.forEach(result => {
          this.conversationService.addToConversationHistory({
            role: 'tool',
            tool_call_id: result.tool_call_id,
            content: result.output
          });
        });
        
        // Check if any tool calls failed and set error for next iteration
        const failedToolCall = results.find(result => !result.success);
        if (failedToolCall) {
          lastError = new Error(`Tool execution failed: ${failedToolCall.output}`);
        }
        
      } catch (error) {
        console.error(`Error in agentic iteration #${iterations}:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Wait briefly before retrying
        await this.sleep(500);
      }
    }
    
    // If we couldn't complete the loop successfully, generate an error response
    if (!loopComplete) {
      console.warn('Agentic loop exceeded maximum iterations without completion');
      finalResponse = `I'm sorry, but I encountered an issue while processing your request. ${
        lastError ? `Error: ${lastError.message}` : 'Please try again with a clearer or simpler query.'
      }`;
    }
    
    return finalResponse;
    } catch (error) {
      console.error('Critical error in executeAgentLoop:', error);
      
      // Check for OpenAI API validation errors
      const isOpenAIError = error instanceof Error && (
        error.message.includes('OPENAI_API_ERROR') || 
        error.message.includes('400 Invalid parameter') ||
        error.message.includes('messages with role \'tool\' must be a response') ||
        error.message.includes('invalid_request_error') ||
        (error.name === 'OpenAIApiValidationError')
      );
      
      if (isOpenAIError) {
        console.error('Detected OpenAI API validation error, returning friendly error message');
        
        // Clear conversation history to prevent the same error from happening again
        try {
          // Get a reference to the conversation before sanitizing
          const conversationHistory = this.conversationService.getConversationHistory();
          console.log(`Current conversation history has ${conversationHistory.length} messages`);
          
          // First sanitize the conversation history to remove any invalid tool call/response pairs
          console.log('Sanitizing conversation history to remove invalid tool messages');
          const sanitizedCount = this.conversationService.sanitizeToolMessages();
          console.log(`Sanitized ${sanitizedCount} tool messages from conversation history`);
          
          // IMPORTANT: Then clear the entire conversation history to prevent the same error
          this.conversationService.clearConversationHistory();
          console.log('Cleared conversation history due to OpenAI API validation error');
          
          // Add a single system message to the conversation to reset context
          this.conversationService.addToConversationHistory({
            role: 'system',
            content: 'The conversation has been reset due to an API error.'
          });
        } catch (clearError) {
          console.error('Error while trying to clear conversation history:', clearError);
        }
        
        return `I encountered an issue while processing your request. The conversation has been reset to prevent further errors. Please try your question again.`;
      }
      
      // For other errors, just propagate them
      throw error;
    }
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
   * Execute the agent loop with streaming responses
   * @param query The user query to process
   * @param onChunk Callback function that receives each chunk of the streaming response
   * @returns The final complete response
   */
  public async executeStreamingAgentLoop(query: string, onChunk: (chunk: string) => void): Promise<string> {
    console.log('Processing query with streaming agentic loop:', query);
    
    // Validate API key
    const validation = this.openAIClient.validateApiKey();
    if (!validation.valid) {
      throw new Error(`OpenAI API key validation failed: ${validation.message}`);
    }
    
    // Add user query to conversation history
    this.conversationService.addToConversationHistory({
      role: 'user',
      content: query
    });
    
    // Get tool definitions
    const tools = getToolDefinitions();
    
    // Initialize variables
    let finalResponse = '';
    let lastError: Error | null = null;
    let streamedContent = '';
    let assistantMessageBuffer: any = { content: '', tool_calls: [] };
    
    try {
      // Get current conversation history and sanitize it to ensure it's valid
      const conversationHistory = this.conversationService.validateAndSanitizeConversationHistory();
      
      // Create messages for this iteration
      let messages = this.messageFormatter.formatMessages(
        systemPrompt, 
        conversationHistory, 
        lastError
      );
      
      // Check if we need to summarize conversation history due to large payload
      const shouldSummarize = this.messageFormatter.shouldSummarizeHistory(
        conversationHistory,
        this.MAX_PAYLOAD_SIZE,
        this.MAX_MESSAGES
      );
      
      // Summarize conversation history if needed (similar to executeAgentLoop)
      if (shouldSummarize && conversationHistory.length > 2) {
        console.log('Payload size too large, summarizing conversation history');
        
        // Keep the latest user message but summarize the rest
        const latestMessages = conversationHistory.slice(-2);  // Keep most recent exchange
        const olderMessages = conversationHistory.slice(0, -2);
        
        // Only summarize if we have older messages to summarize
        if (olderMessages.length > 0) {
          // Save original history
          const originalHistory = [...this.conversationService.getConversationHistory()];
          
          // Temporarily replace history with older messages for summarization
          this.conversationService.clearConversationHistory();
          olderMessages.forEach(msg => this.conversationService.addToConversationHistory(msg));
          
          // Generate summary using OpenAI
          const summary = await this.conversationService.summarizeConversationHistory(2000);
          
          // Restore original history
          this.conversationService.clearConversationHistory();
          originalHistory.forEach((msg: ConversationMessage) => this.conversationService.addToConversationHistory(msg));
          
          // Add summary and latest messages
          messages = [
            { role: 'system', content: systemPrompt },
            // Ensure summary has the required 'role' property (OpenAI expects it)
            { role: 'assistant', content: typeof summary === 'string' ? summary : (summary as any).content || JSON.stringify(summary) },
            ...latestMessages
          ];
          
          console.log('Conversation history summarized successfully');
        }
      }
      
      // Ensure all messages have the required 'role' property
      console.log('Before validation - Messages to be sent to OpenAI:', JSON.stringify(messages, null, 2));
      
      // Validate and fix all messages to ensure they have the required 'role' property
      // and remove empty tool_calls arrays
      messages = messages.map((msg, index) => {
        // Create a new message object for modifications
        let updatedMsg = { ...msg };
        
        // Fix missing role property
        if (!updatedMsg.role) {
          console.error(`Message at index ${index} is missing the required 'role' property:`, updatedMsg);
          
          // Determine the appropriate role based on the message content and context
          let inferredRole = 'user'; // Default fallback
          
          // If it contains tool_call_id, it's likely a tool response
          if (updatedMsg.tool_call_id) {
            inferredRole = 'tool';
          }
          // If it contains tool_calls, it's likely an assistant message
          else if (updatedMsg.tool_calls) {
            inferredRole = 'assistant';
          }
          // If it contains content that looks like a system message
          else if (updatedMsg.content && typeof updatedMsg.content === 'string' && 
                  (updatedMsg.content.startsWith('You are') || updatedMsg.content.includes('system instructions'))) {
            inferredRole = 'system';
          }
          
          console.log(`Fixed missing role for message ${index} - assigned role: '${inferredRole}'`);
          updatedMsg.role = inferredRole;
        }
        
        // Handle empty tool_calls arrays - OpenAI doesn't accept empty tool_calls arrays
        if (updatedMsg.tool_calls && Array.isArray(updatedMsg.tool_calls) && updatedMsg.tool_calls.length === 0) {
          console.log(`Removing empty tool_calls array from message at index ${index}`);
          // Delete the tool_calls property if it's an empty array
          delete updatedMsg.tool_calls;
        }
        
        return updatedMsg;
      });
      
      console.log('After validation - Messages being sent to OpenAI:', JSON.stringify(messages, null, 2));
      
      // Call OpenAI API with streaming
      await this.openAIClient.createStreamingChatCompletion(
        messages as any,
        tools,
        'gpt-4o',
        0.8,
        (chunk) => {
          // Extract content and tool calls from streaming chunks
          if (chunk.choices && chunk.choices[0]) {
            const delta = chunk.choices[0].delta;
            
            // Handle content deltas
            if (delta.content) {
              console.log('[AgentLoopService] Received content delta:', delta.content);
              streamedContent += delta.content;
              assistantMessageBuffer.content += delta.content;
              
              // Send content chunk to callback
              console.log('[AgentLoopService] Sending chunk to callback');
              onChunk(delta.content);
            } else {
              console.log('[AgentLoopService] Received delta without content:', JSON.stringify(delta));
            }
            
            // Handle tool call deltas
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              // We need to merge tool call chunks appropriately
              this.processToolCallChunk(delta.tool_calls, assistantMessageBuffer);
              
              // For tool calls, we won't stream until we have complete information
              // as it would not be helpful for the user to see partial JSON
            }
          }
        }
      );
      
      // Check if we have complete tool calls before adding to conversation history
      let hasCompletedToolCalls = assistantMessageBuffer.tool_calls && 
                               assistantMessageBuffer.tool_calls.length > 0 && 
                               assistantMessageBuffer.tool_calls.every((tc: any) => 
                                 tc.function && tc.function.name && tc.function.arguments);
      
      console.log(`[AgentLoopService] Tool calls status: ${hasCompletedToolCalls ? 'Complete' : 'Incomplete'}`);
      if (hasCompletedToolCalls) {
        console.log('[AgentLoopService] Tool calls detected, buffering response...');
      } else {
        // If no tool calls or incomplete tool calls, add message to conversation history
        console.log('[AgentLoopService] Adding assistant message to conversation history');
        this.conversationService.addToConversationHistory(assistantMessageBuffer as any);
      }
      
      // If there are complete tool calls, process them (non-streaming part)
      if (hasCompletedToolCalls) {
        // Check if the 'done' tool is called
        const doneToolCall = assistantMessageBuffer.tool_calls.find(
          (toolCall: { function: { name: string } }) => toolCall.function.name === 'done'
        );
        
        if (doneToolCall) {
          console.log('Done tool detected, completing the streaming loop');
          
          try {
            // First add the assistant message with tool_calls to conversation history
            console.log('[AgentLoopService] Adding assistant message with tool_calls to conversation history');
            this.conversationService.addToConversationHistory(assistantMessageBuffer as any);
            
            // Process the done tool call
            const { results } = await this.toolCallProcessor.processToolCalls([doneToolCall], []);
            
            // Then add tool responses to conversation history
            console.log('[AgentLoopService] Adding tool responses to conversation history');
            results.forEach(result => {
              this.conversationService.addToConversationHistory({
                role: 'tool',
                tool_call_id: result.tool_call_id,
                content: result.output
              });
            });
            
            // Get the output from the done tool as the final response
            finalResponse = results[0]?.output || this.responseGenerator.generateFinalResponse(assistantMessageBuffer);
          } catch (error) {
            console.error('Error processing done tool:', error);
            throw error;
          }
        } else {
          // Process regular tool calls
          const { requiresUserConfirmation, results } = await this.toolCallProcessor.processToolCalls(
            assistantMessageBuffer.tool_calls,
            this.BREAKING_CHANGE_TOOLS
          );
          
          // If any tools require user confirmation, ask for it
          if (requiresUserConfirmation) {
            // Show a notification to the user
            const response = await vscode.window.showWarningMessage(
              'The AI assistant is requesting permission to make changes to your workspace. Approve?',
              'Approve', 'Deny'
            );
            
            if (response !== 'Approve') {
              throw new Error('User denied permission for the assistant to make changes');
            }
          }
          
          // First add the assistant message with tool_calls to conversation history
          console.log('[AgentLoopService] Adding assistant message with tool_calls to conversation history');
          this.conversationService.addToConversationHistory(assistantMessageBuffer as any);
          
          // Then add tool responses to conversation history
          console.log('[AgentLoopService] Adding tool responses to conversation history');
          results.forEach(result => {
            this.conversationService.addToConversationHistory({
              role: 'tool',
              tool_call_id: result.tool_call_id,
              content: result.output
            });
          });
          
          // Return the streamed content as the final response since tool processing is handled separately
          finalResponse = streamedContent;
        }
      } else {
        // No tool calls, return the streamed content
        finalResponse = this.responseGenerator.generateFinalResponse(assistantMessageBuffer);
      }
      
      return finalResponse;
    } catch (error) {
      console.error('Error in streaming agent loop:', error);
      
      // Check if this is an OpenAI API error related to message validation
      if (error instanceof Error && (
        error.message.includes('400 Invalid parameter') ||
        error.message.includes('messages with role \'tool\' must be a response to a preceeding message') ||
        error.message.includes('invalid_request_error')
      )) {
        console.error('Detected OpenAI API validation error, aborting agent loop');
        
        // Clear conversation history to prevent the same error from happening again
        try {
          // Get a reference to the conversation before clearing it
          const conversationHistory = this.conversationService.getConversationHistory();
          console.log(`Current conversation history has ${conversationHistory.length} messages`);
          
          // Clear the conversation history to prevent the same error
          this.conversationService.clearConversationHistory();
          console.log('Cleared conversation history due to OpenAI API validation error');
        } catch (clearError) {
          console.error('Error while trying to clear conversation history:', clearError);
        }
        
        return `I encountered an issue while processing your request. The conversation has been reset to prevent further errors. Please try your question again.`;
      }
      
      throw error;
    }
  }
  
  /**
   * Process tool call chunks and merge them into the assistant message buffer
   * @param toolCallChunks The new tool call chunks
   * @param assistantMessageBuffer The buffer to update
   */
  private processToolCallChunk(toolCallChunks: any[], assistantMessageBuffer: any): void {
    // Ensure tool_calls array exists
    if (!assistantMessageBuffer.tool_calls) {
      assistantMessageBuffer.tool_calls = [];
    }
    
    // Process each tool call chunk
    for (const chunk of toolCallChunks) {
      // Find existing tool call or create a new one
      let toolCall = assistantMessageBuffer.tool_calls.find(
        (tc: any) => tc.index === chunk.index
      );
      
      if (!toolCall) {
        // Create new tool call entry
        toolCall = {
          id: chunk.id || `call_${assistantMessageBuffer.tool_calls.length}`,
          type: 'function',
          function: { name: '', arguments: '' },
          index: chunk.index
        };
        assistantMessageBuffer.tool_calls.push(toolCall);
      }
      
      // Update the tool call with new chunk data
      if (chunk.function) {
        if (chunk.function.name) {
          toolCall.function.name += chunk.function.name;
        }
        if (chunk.function.arguments) {
          toolCall.function.arguments += chunk.function.arguments;
        }
      }
    }
  }
}
