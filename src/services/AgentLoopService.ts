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
  private readonly MAX_ITERATIONS = 10; 
  private readonly MAX_PAYLOAD_SIZE = 100000; 
  private readonly MAX_MESSAGES = 12; 
  
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
    private readonly responseGenerator: IResponseGeneratorService,
    private readonly projectPath: string
  ) {}

  /**
   * Execute the agent loop to process a user query
   * @param query The user query to process
   * @returns The final response
   */
  public async executeAgentLoop(query: string): Promise<string> {
    console.log('Processing query with agentic loop:', query);
    
    console.log('Project Path in AgentLoopService:', this.projectPath);



    // append project path to system prompt
    const withProjectPathSystemPrompt = `${systemPrompt}\n\nRemember you are working in project path: ${this.projectPath}`;


    
    try {
    
    const validation = this.openAIClient.validateApiKey();
    if (!validation.valid) {
      throw new Error(`OpenAI API key validation failed: ${validation.message}`);
    }
    
    this.conversationService.addToConversationHistory({
      role: 'user',
      content: query
    });
    
    const tools = getToolDefinitions();
    
    let loopComplete = false;
    let finalResponse = '';
    let lastError: Error | null = null;
    let iterations = 0;
    
    let forceExitLoop = false;
    
    while (!loopComplete && !forceExitLoop && iterations < this.MAX_ITERATIONS) {
      iterations++;
      console.log(`Starting agentic iteration #${iterations}`);
      
      try {
        const conversationHistory = this.conversationService.getConversationHistory();
        
        let messages = this.messageFormatter.formatMessages(
          withProjectPathSystemPrompt, 
          conversationHistory, 
          lastError
        );
        
        const shouldSummarize = this.messageFormatter.shouldSummarizeHistory(
          conversationHistory,
          this.MAX_PAYLOAD_SIZE,
          this.MAX_MESSAGES
        );
        
        if (shouldSummarize && conversationHistory.length > 2) {
          console.log('Payload size too large, summarizing conversation history');
          
          // Keep last 4 messages and summarize the rest
          const latestMessages = conversationHistory.slice(-4);
          const olderMessages = conversationHistory.slice(0, -4);
          
          if (olderMessages.length > 0) {
            const originalHistory = [...this.conversationService.getConversationHistory()];
            
            this.conversationService.clearConversationHistory();
            olderMessages.forEach(msg => this.conversationService.addToConversationHistory(msg));
            
            const summary = await this.conversationService.summarizeConversationHistory(2000);

            this.conversationService.clearConversationHistory();
            originalHistory.forEach(msg => this.conversationService.addToConversationHistory(msg));
            
            messages = [
              { role: 'system', content: withProjectPathSystemPrompt },
              { role: 'assistant', content: typeof summary === 'string' ? summary : (summary as any).content || JSON.stringify(summary) },
              ...latestMessages
            ];
            
            console.log('Conversation history summarized successfully');
          }
        }
        
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
          
          if (apiError instanceof Error && (
            apiError.message.includes('400 Invalid parameter') ||
            apiError.message.includes('messages with role \'tool\' must be a response') ||
            apiError.message.includes('invalid_request_error')
          )) {
            console.error('Detected OpenAI API validation error, breaking loop immediately');
            
            console.log('Sanitizing conversation history to remove invalid tool messages');
            this.conversationService.sanitizeToolMessages();
            
            this.conversationService.clearConversationHistory();
            console.log('Cleared conversation history due to OpenAI API validation error');
            
            forceExitLoop = true;
            loopComplete = true;
            finalResponse = `I encountered an API error while processing your request. The conversation has been reset. Please try your question again with simpler instructions.`;
            
            break;
          }
          
          throw apiError;
        }
        
        this.conversationService.addToConversationHistory(assistantMessage as any);
        
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          console.log('No tool calls, completing agentic loop');
          finalResponse = this.responseGenerator.generateFinalResponse(assistantMessage);
          loopComplete = true;
          continue;
        }
        
        console.log(`Processing ${assistantMessage.tool_calls.length} tool calls`);
        
        const doneToolCall = assistantMessage.tool_calls.find((toolCall: { function: { name: string } }) => 
          toolCall.function.name === 'done'
        );
        
        if (doneToolCall) {
          console.log('Done tool detected, breaking the agentic loop');
          
          try {
            const { results } = await this.toolCallProcessor.processToolCalls([doneToolCall], []);
            
            results.forEach(result => {
              this.conversationService.addToConversationHistory({
                role: 'tool',
                tool_call_id: result.tool_call_id,
                content: result.output
              });
            });
            
            finalResponse = results[0]?.output || this.responseGenerator.generateFinalResponse(assistantMessage);
            loopComplete = true;
          } catch (error) {
            console.error('Error processing done tool:', error);
            lastError = error instanceof Error ? error : new Error(String(error));
          }
          
          continue;
        }

        const { requiresUserConfirmation, results } = await this.toolCallProcessor.processToolCalls(
          assistantMessage.tool_calls,
          this.BREAKING_CHANGE_TOOLS
        );
        
        if (requiresUserConfirmation) {
          const response = await vscode.window.showWarningMessage(
            'The AI assistant is requesting permission to make changes to your workspace. Approve?',
            'Approve', 'Deny'
          );
          
          if (response !== 'Approve') {
            throw new Error('User denied permission for the assistant to make changes');
          }
        }
        
        results.forEach(result => {
          this.conversationService.addToConversationHistory({
            role: 'tool',
            tool_call_id: result.tool_call_id,
            content: result.output
          });
        });
        
        const failedToolCall = results.find(result => !result.success);
        if (failedToolCall) {
          lastError = new Error(`Tool execution failed: ${failedToolCall.output}`);
        }
        
      } catch (error) {
        console.error(`Error in agentic iteration #${iterations}:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
        
        await this.sleep(500);
      }
    }
    
    if (!loopComplete) {
      console.warn('Agentic loop exceeded maximum iterations without completion');
      finalResponse = `I'm sorry, but I encountered an issue while processing your request. ${
        lastError ? `Error: ${lastError.message}` : 'Please try again with a clearer or simpler query.'
      }`;
    }
    
    return finalResponse;
    } catch (error) {
      console.error('Critical error in executeAgentLoop:', error);
      
      const isOpenAIError = error instanceof Error && (
        error.message.includes('OPENAI_API_ERROR') || 
        error.message.includes('400 Invalid parameter') ||
        error.message.includes('messages with role \'tool\' must be a response') ||
        error.message.includes('invalid_request_error') ||
        (error.name === 'OpenAIApiValidationError')
      );
      
      if (isOpenAIError) {
        console.error('Detected OpenAI API validation error, returning friendly error message');

        try {

          const conversationHistory = this.conversationService.getConversationHistory();
          console.log(`Current conversation history has ${conversationHistory.length} messages`);
          
          console.log('Sanitizing conversation history to remove invalid tool messages');
          const sanitizedCount = this.conversationService.sanitizeToolMessages();
          console.log(`Sanitized ${sanitizedCount} tool messages from conversation history`);
          
          this.conversationService.clearConversationHistory();
          console.log('Cleared conversation history due to OpenAI API validation error');
          
          this.conversationService.addToConversationHistory({
            role: 'system',
            content: 'The conversation has been reset due to an API error.'
          });
        } catch (clearError) {
          console.error('Error while trying to clear conversation history:', clearError);
        }
        
        return `I encountered an issue while processing your request. The conversation has been reset to prevent further errors. Please try your question again.`;
      }
      
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
      const conversationHistory = this.conversationService.validateAndSanitizeConversationHistory();
      
      let messages = this.messageFormatter.formatMessages(
        systemPrompt, 
        conversationHistory, 
        lastError
      );
      
      const shouldSummarize = this.messageFormatter.shouldSummarizeHistory(
        conversationHistory,
        this.MAX_PAYLOAD_SIZE,
        this.MAX_MESSAGES
      );
      
      if (shouldSummarize && conversationHistory.length > 2) {
        console.log('Payload size too large, summarizing conversation history');
        
        const latestMessages = conversationHistory.slice(-2);  
        const olderMessages = conversationHistory.slice(0, -2);
        
        if (olderMessages.length > 0) {
          const originalHistory = [...this.conversationService.getConversationHistory()];
          
          this.conversationService.clearConversationHistory();
          olderMessages.forEach(msg => this.conversationService.addToConversationHistory(msg));
          
          const summary = await this.conversationService.summarizeConversationHistory(2000);
          
          this.conversationService.clearConversationHistory();
          originalHistory.forEach((msg: ConversationMessage) => this.conversationService.addToConversationHistory(msg));
          
          messages = [
            { role: 'system', content: systemPrompt },
            { role: 'assistant', content: typeof summary === 'string' ? summary : (summary as any).content || JSON.stringify(summary) },
            ...latestMessages
          ];
          
          console.log('Conversation history summarized successfully');
        }
      }
      
      console.log('Before validation - Messages to be sent to OpenAI:', JSON.stringify(messages, null, 2));
      
      messages = messages.map((msg, index) => {
        let updatedMsg = { ...msg };
        
        if (!updatedMsg.role) {
          console.error(`Message at index ${index} is missing the required 'role' property:`, updatedMsg);
          
          let inferredRole = 'user';
          
          if (updatedMsg.tool_call_id) {
            inferredRole = 'tool';
          }
          else if (updatedMsg.tool_calls) {
            inferredRole = 'assistant';
          }
          else if (updatedMsg.content && typeof updatedMsg.content === 'string' && 
                  (updatedMsg.content.startsWith('You are') || updatedMsg.content.includes('system instructions'))) {
            inferredRole = 'system';
          }
          
          console.log(`Fixed missing role for message ${index} - assigned role: '${inferredRole}'`);
          updatedMsg.role = inferredRole;
        }
        
        if (updatedMsg.tool_calls && Array.isArray(updatedMsg.tool_calls) && updatedMsg.tool_calls.length === 0) {
          console.log(`Removing empty tool_calls array from message at index ${index}`);
          delete updatedMsg.tool_calls;
        }
        
        return updatedMsg;
      });
      
      console.log('After validation - Messages being sent to OpenAI:', JSON.stringify(messages, null, 2));
      
      await this.openAIClient.createStreamingChatCompletion(
        messages as any,
        tools,
        'gpt-4o',
        0.8,
        (chunk) => {
          if (chunk.choices && chunk.choices[0]) {
            const delta = chunk.choices[0].delta;
            
            if (delta.content) {
              console.log('[AgentLoopService] Received content delta:', delta.content);
              streamedContent += delta.content;
              assistantMessageBuffer.content += delta.content;

              console.log('[AgentLoopService] Sending chunk to callback');
              onChunk(delta.content);
            } else {
              console.log('[AgentLoopService] Received delta without content:', JSON.stringify(delta));
            }
            
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              this.processToolCallChunk(delta.tool_calls, assistantMessageBuffer);
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
        console.log('[AgentLoopService] Adding assistant message to conversation history');
        this.conversationService.addToConversationHistory(assistantMessageBuffer as any);
      }
      
      if (hasCompletedToolCalls) {
        const doneToolCall = assistantMessageBuffer.tool_calls.find(
          (toolCall: { function: { name: string } }) => toolCall.function.name === 'done'
        );
        
        if (doneToolCall) {
          console.log('Done tool detected, completing the streaming loop');
          
          try {

            console.log('[AgentLoopService] Adding assistant message with tool_calls to conversation history');
            this.conversationService.addToConversationHistory(assistantMessageBuffer as any);
            
            const { results } = await this.toolCallProcessor.processToolCalls([doneToolCall], []);
            
            console.log('[AgentLoopService] Adding tool responses to conversation history');
            results.forEach(result => {
              this.conversationService.addToConversationHistory({
                role: 'tool',
                tool_call_id: result.tool_call_id,
                content: result.output
              });
            });
            
            finalResponse = results[0]?.output || this.responseGenerator.generateFinalResponse(assistantMessageBuffer);
          } catch (error) {
            console.error('Error processing done tool:', error);
            throw error;
          }
        } else {
          const { requiresUserConfirmation, results } = await this.toolCallProcessor.processToolCalls(
            assistantMessageBuffer.tool_calls,
            this.BREAKING_CHANGE_TOOLS
          );
          
          if (requiresUserConfirmation) {
            const response = await vscode.window.showWarningMessage(
              'The AI assistant is requesting permission to make changes to your workspace. Approve?',
              'Approve', 'Deny'
            );
            
            if (response !== 'Approve') {
              throw new Error('User denied permission for the assistant to make changes');
            }
          }
          
          console.log('[AgentLoopService] Adding assistant message with tool_calls to conversation history');
          this.conversationService.addToConversationHistory(assistantMessageBuffer as any);
          
          console.log('[AgentLoopService] Adding tool responses to conversation history');
          results.forEach(result => {
            this.conversationService.addToConversationHistory({
              role: 'tool',
              tool_call_id: result.tool_call_id,
              content: result.output
            });
          });
          
          finalResponse = streamedContent;
        }
      } else {
        finalResponse = this.responseGenerator.generateFinalResponse(assistantMessageBuffer);
      }
      
      return finalResponse;
    } catch (error) {
      console.error('Error in streaming agent loop:', error);
      
      if (error instanceof Error && (
        error.message.includes('400 Invalid parameter') ||
        error.message.includes('messages with role \'tool\' must be a response to a preceeding message') ||
        error.message.includes('invalid_request_error')
      )) {
        console.error('Detected OpenAI API validation error, aborting agent loop');
        
        try {
          const conversationHistory = this.conversationService.getConversationHistory();
          console.log(`Current conversation history has ${conversationHistory.length} messages`);
          
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
    if (!assistantMessageBuffer.tool_calls) {
      assistantMessageBuffer.tool_calls = [];
    }
    
    for (const chunk of toolCallChunks) {
      let toolCall = assistantMessageBuffer.tool_calls.find(
        (tc: any) => tc.index === chunk.index
      );
      
      if (!toolCall) {
        toolCall = {
          id: chunk.id || `call_${assistantMessageBuffer.tool_calls.length}`,
          type: 'function',
          function: { name: '', arguments: '' },
          index: chunk.index
        };
        assistantMessageBuffer.tool_calls.push(toolCall);
      }
      
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
