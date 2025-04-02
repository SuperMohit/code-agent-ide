import { ConversationMessage, SummarizedHistoryMessage } from './types';
import { OpenAIClient } from './OpenAIClient';
import OpenAI from 'openai';

/**
 * Manages the conversation history with the AI assistant
 */
export class ConversationManager {
  private conversationHistory: ConversationMessage[] = [];
  private maxHistoryLength = 10; // Keep reasonable number of messages to maintain context

  /**
   * Add a message to the conversation history, maintaining the maximum history length
   */
  public addToConversationHistory(message: ConversationMessage): void {
    this.conversationHistory.push(message);
    this.safelyTruncateConversationHistory();
  }

  /**
   * Get the current conversation history
   */
  public getConversationHistory(): ConversationMessage[] {
    return this.conversationHistory;
  }

  /**
   * Clear the conversation history
   */
  public clearConversationHistory(): void {
    this.conversationHistory = [];
  }
  
  /**
   * Removes any invalid tool call pairings from the history
   * This should be used when OpenAI API errors are encountered to ensure both
   * the tool call and corresponding tool responses are removed together
   * @returns The number of message pairs removed
   */
  public sanitizeToolMessages(): number {
    if (this.conversationHistory.length === 0) {
      return 0;
    }
    
    console.log('Sanitizing conversation history to remove invalid tool call pairings');
    
    // Step 1: Identify all assistant messages with tool calls and all tool response messages
    const assistantToolCalls: Map<string, number> = new Map(); // tool_call_id -> index
    const toolResponses: Map<string, number[]> = new Map(); // tool_call_id -> indices
    
    // Collect all tool calls and responses
    for (let i = 0; i < this.conversationHistory.length; i++) {
      const message = this.conversationHistory[i];
      
      // Assistant messages with tool calls
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          assistantToolCalls.set(toolCall.id, i);
        }
      }
      
      // Tool response messages
      if (message.role === 'tool' && message.tool_call_id) {
        const indices = toolResponses.get(message.tool_call_id) || [];
        indices.push(i);
        toolResponses.set(message.tool_call_id, indices);
      }
    }
    
    // Step 2: Find orphaned tool responses (responses without matching tool calls)
    const orphanedToolResponses: number[] = [];
    toolResponses.forEach((indices, toolCallId) => {
      if (!assistantToolCalls.has(toolCallId)) {
        orphanedToolResponses.push(...indices);
      }
    });
    
    // Step 3: Find orphaned tool calls (tool calls without matching responses)
    const orphanedToolCalls: Set<number> = new Set();
    assistantToolCalls.forEach((index, toolCallId) => {
      if (!toolResponses.has(toolCallId)) {
        orphanedToolCalls.add(index);
      }
    });
    
    // If no orphaned messages, nothing to clean up
    if (orphanedToolResponses.length === 0 && orphanedToolCalls.size === 0) {
      console.log('No orphaned tool messages found');
      return 0;
    }
    
    console.log(`Found ${orphanedToolResponses.length} orphaned tool responses and ${orphanedToolCalls.size} orphaned tool calls`);
    
    // Step 4: Remove orphaned messages from history (in reverse order to avoid index shifting)
    const allOrphanedIndices = [...orphanedToolResponses, ...Array.from(orphanedToolCalls)];
    allOrphanedIndices.sort((a, b) => b - a); // Sort in descending order
    
    // Remove all orphaned messages
    for (const index of allOrphanedIndices) {
      this.conversationHistory.splice(index, 1);
    }
    
    console.log(`Removed ${allOrphanedIndices.length} orphaned tool messages`);
    
    return allOrphanedIndices.length;
  }

  /**
   * Safely truncates the conversation history while maintaining valid message pairings
   * This ensures that tool responses always have their matching tool calls
   */
  private safelyTruncateConversationHistory(): void {
    if (this.conversationHistory.length <= this.maxHistoryLength) {
      return; // No need to truncate
    }
    
    // Keep at least the last maxHistoryLength/2 exchanges (user+assistant pairs)
    const minimumToKeep = Math.floor(this.maxHistoryLength / 2) * 2;
    const excessMessages = this.conversationHistory.length - this.maxHistoryLength;
    
    if (excessMessages <= 0) {
      return;
    }
    
    // Step 1: Identify tool call messages and their corresponding tool responses
    const toolCallMap = new Map<string, number>(); // Map from tool_call_id to assistant message index
    const toolResponseMap = new Map<number, number[]>(); // Map from assistant message index to array of tool response indices
    
    // Build our maps
    for (let i = 0; i < this.conversationHistory.length; i++) {
      const message = this.conversationHistory[i];
      
      // If this is an assistant message with tool calls, map each tool call ID to this message index
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
        const responseIndices: number[] = [];
        toolResponseMap.set(i, responseIndices);
        
        for (const toolCall of message.tool_calls) {
          toolCallMap.set(toolCall.id, i);
        }
      }
      
      // If this is a tool response, find its corresponding tool call and add to responseIndices
      if (message.role === 'tool' && message.tool_call_id) {
        const assistantIndex = toolCallMap.get(message.tool_call_id);
        if (assistantIndex !== undefined) {
          const responseIndices = toolResponseMap.get(assistantIndex) || [];
          responseIndices.push(i);
          toolResponseMap.set(assistantIndex, responseIndices);
        }
      }
    }
    
    // Step 2: Find a safe truncation point where we don't break tool call-response pairs
    // Start from earliest messages and find a point where we won't split tool call/response pairs
    let safeRemovalPoint = 0;
    
    // Organize messages into complete exchanges (user->assistant[->tool responses] cycles)
    for (let i = 0; i < this.conversationHistory.length - minimumToKeep; i++) {
      const message = this.conversationHistory[i];
      
      // If this is a user message, check if removing up to this point would be safe
      if (message.role === 'user') {
        // Check if the next message is a tool-calling assistant message
        const nextIndex = i + 1;
        if (nextIndex < this.conversationHistory.length) {
          const nextMessage = this.conversationHistory[nextIndex];
          
          // If the next message is an assistant with tool calls, we need to be careful
          if (nextMessage.role === 'assistant' && nextMessage.tool_calls && nextMessage.tool_calls.length > 0) {
            // Get the indices of all tool responses for this tool call
            const responseIndices = toolResponseMap.get(nextIndex) || [];
            
            // If any tool response index is beyond our desired truncation point,
            // we can't safely remove this exchange
            const maxResponseIndex = Math.max(...responseIndices, nextIndex);
            if (maxResponseIndex >= this.conversationHistory.length - minimumToKeep) {
              // We can't safely remove this tool call and its responses
              break;
            }
          }
        }
        
        // If we get here, it's safe to remove up to and including this user message
        safeRemovalPoint = i + 1;
      }
      
      // If we've found enough messages to safely remove, stop
      if (safeRemovalPoint >= excessMessages) {
        break;
      }
    }
    
    // Remove messages from the beginning up to the safe point
    if (safeRemovalPoint > 0) {
      this.conversationHistory = this.conversationHistory.slice(safeRemovalPoint);
    }
  }

  /**
   * Validates and sanitizes the conversation history to ensure all tool messages have valid preceding tool calls
   * and all tool calls have corresponding tool messages
   * @returns The sanitized conversation history
   */
  public validateAndSanitizeConversationHistory(): ConversationMessage[] {
    console.log('[ConversationManager] Starting conversation history validation');
    console.log(`[ConversationManager] Initial history length: ${this.conversationHistory.length}`);
    
    // Create a copy of the conversation history to avoid modifying the original during validation
    let validatedHistory: ConversationMessage[] = [...this.conversationHistory];
    let messagesToRemove: number[] = [];
    
    // First pass: Identify all tool messages without matching tool calls
    for (let i = 0; i < validatedHistory.length; i++) {
      const message = validatedHistory[i];
      
      // If this is a tool message, ensure it has a valid preceding assistant message with tool calls
      if (message.role === 'tool' && message.tool_call_id) {
        let foundMatchingToolCall = false;
        let matchingAssistantIndex = -1;
        
        // Look back through previous messages to find a matching tool call
        for (let j = i - 1; j >= 0; j--) {
          const prevMessage = validatedHistory[j];
          
          if (prevMessage.role === 'assistant' && prevMessage.tool_calls) {
            // Check if any tool call in this message matches our tool message
            const matchingToolCall = prevMessage.tool_calls.find(
              (tc: any) => tc.id === message.tool_call_id
            );
            
            if (matchingToolCall) {
              foundMatchingToolCall = true;
              matchingAssistantIndex = j;
              break;
            }
          }
        }
        
        if (!foundMatchingToolCall) {
          console.warn(`[ConversationManager] Tool message at index ${i} with ID ${message.tool_call_id} has no matching tool call - marking for removal`);
          messagesToRemove.push(i);
        }
        // Ensure there are no other messages between the tool call and the tool response
        else if (matchingAssistantIndex >= 0) {
          // Check if there's any non-tool message between the assistant message and this tool message
          let hasInterveningMessages = false;
          for (let k = matchingAssistantIndex + 1; k < i; k++) {
            if (validatedHistory[k].role !== 'tool') {
              console.warn(`[ConversationManager] Found intervening non-tool message between tool call and response at index ${k} - removing tool response at ${i}`);
              hasInterveningMessages = true;
              break;
            }
          }
          
          if (hasInterveningMessages) {
            messagesToRemove.push(i);
          }
        }
      }
    }
    
    // Second pass: Identify all assistant messages with tool_calls that don't have corresponding tool messages
    // or have tool calls in invalid sequence
    let messagesToFix: {index: number, missingToolResponses: {id: string, response: string}[]}[] = [];
    let assistantToToolCallMap = new Map<number, string[]>(); // Map assistant index to array of tool call IDs
    
    for (let i = 0; i < validatedHistory.length; i++) {
      const message = validatedHistory[i];
      
      // If this is an assistant message with tool_calls
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
        const missingToolResponses: {id: string, response: string}[] = [];
        const toolCallIds: string[] = [];
        
        // For each tool call, check if there's a corresponding tool message
        for (const toolCall of message.tool_calls) {
          let foundToolResponse = false;
          toolCallIds.push(toolCall.id);
          
          // Look for matching tool response - they must be immediately after this message
          // and before any other non-tool messages
          for (let j = i + 1; j < validatedHistory.length; j++) {
            const nextMessage = validatedHistory[j];
            
            // If we hit a non-tool message, stop looking
            if (nextMessage.role !== 'tool') {
              break;
            }
            
            if (nextMessage.role === 'tool' && nextMessage.tool_call_id === toolCall.id) {
              foundToolResponse = true;
              break;
            }
          }
          
          if (!foundToolResponse) {
            console.warn(`[ConversationManager] Assistant message at index ${i} has a tool_call with ID ${toolCall.id} without a corresponding tool response - adding dummy response`);
            missingToolResponses.push({id: toolCall.id, response: 'Tool execution failed or timed out.'});
          }
        }
        
        assistantToToolCallMap.set(i, toolCallIds);
        
        if (missingToolResponses.length > 0) {
          messagesToFix.push({index: i, missingToolResponses});
        }
      }
    }
    
    // Special handling for streaming situations where we might have incomplete tool calls
    // Find incomplete streaming assistant messages with partial tool_calls without content
    for (let i = 0; i < validatedHistory.length; i++) {
      const message = validatedHistory[i];
      if (message.role === 'assistant' && 
          message.tool_calls && 
          message.tool_calls.length > 0 && 
          message.tool_calls.some(tc => !tc.function || !tc.function.name || !tc.function.arguments)) {
        
        console.warn(`[ConversationManager] Found incomplete tool call at index ${i} - removing to prevent API errors`);
        messagesToRemove.push(i);
        
        // Also remove any tool responses associated with this message
        const toolCallIds = assistantToToolCallMap.get(i) || [];
        for (let j = i + 1; j < validatedHistory.length; j++) {
          const nextMessage = validatedHistory[j];
          if (nextMessage.role === 'tool' && 
              nextMessage.tool_call_id && 
              toolCallIds.includes(nextMessage.tool_call_id)) {
            console.warn(`[ConversationManager] Removing associated tool response at index ${j}`);
            messagesToRemove.push(j);
          }
        }
      }
    }
    
    // Remove duplicated indices from messagesToRemove
    messagesToRemove = [...new Set(messagesToRemove)];
    
    // Third pass: Remove invalid messages (in reverse order to preserve indices)
    messagesToRemove.sort((a, b) => b - a); // Sort in descending order
    for (const indexToRemove of messagesToRemove) {
      validatedHistory.splice(indexToRemove, 1);
    }
    
    // Fourth pass: Add missing tool responses after each assistant message with tool_calls
    // We need to add them in reverse order to maintain the correct indices
    for (let i = messagesToFix.length - 1; i >= 0; i--) {
      const {index, missingToolResponses} = messagesToFix[i];
      
      // Check if this assistant message still exists after removals
      if (index < validatedHistory.length && 
          validatedHistory[index].role === 'assistant' && 
          validatedHistory[index].tool_calls) {
        
        // Insert missing tool responses right after the assistant message
        for (const missingResponse of missingToolResponses) {
          validatedHistory.splice(index + 1, 0, {
            role: 'tool',
            tool_call_id: missingResponse.id,
            content: missingResponse.response
          });
        }
      }
    }
    
    console.log(`[ConversationManager] Validation complete. Messages removed: ${messagesToRemove.length}, Messages fixed: ${messagesToFix.length}`);
    console.log(`[ConversationManager] Final history length: ${validatedHistory.length}`);
    
    // Update the actual conversation history with the validated version
    this.conversationHistory = validatedHistory;
    
    return validatedHistory;
  }
  
  /**
   * Validates the conversation history to ensure all tool messages have valid preceding tool calls
   * @deprecated Use validateAndSanitizeConversationHistory instead
   */
  public validateConversationHistory(): void {
    // This is kept for backward compatibility
    this.validateAndSanitizeConversationHistory();
  }
  
  /**
   * Summarizes the conversation history using OpenAI
   * @param maxTokens Maximum length of summarized content in tokens
   * @returns A summarized history message that can be sent to the AI
   */
  public async summarizeConversationHistory(maxTokens: number = 1000): Promise<SummarizedHistoryMessage> {
    if (this.conversationHistory.length === 0) {
      return {
        role: 'system',
        content: 'No conversation history yet.',
        summary_type: 'conversation_history',
        timestamp: Date.now()
      };
    }
    
    // Extract all file references from the conversation for preservation
    const fileReferences: Set<string> = new Set();
    
    // Identify patterns for file paths
    const filePathPattern = /(?:[a-zA-Z]:\[^\s:\*\?"<>|][^:\*\?"<>|]*)|(?:\/[^\s\/\*\?"<>|][^\/\*\?"<>|]*)+/g;
    
    // Scan conversation for file references
    for (const message of this.conversationHistory) {
      // Extract file paths from message content
      if (typeof message.content === 'string') {
        const matches = message.content.match(filePathPattern);
        if (matches) {
          matches.forEach(match => {
            if (match.includes('.') && !match.endsWith('/')) { // Likely a file path
              fileReferences.add(match);
            }
          });
        }
      }
      
      // Check tool calls for file references
      if (message.tool_calls) {
        message.tool_calls.forEach(toolCall => {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            // Look for file paths in common tool parameters
            ['FilePath', 'DirectoryPath', 'TargetFile', 'AbsolutePath'].forEach(param => {
              if (args[param] && typeof args[param] === 'string') {
                fileReferences.add(args[param]);
              }
            });
          } catch (e) {
            // Ignore parsing errors
          }
        });
      }
    }
    
    // Build a new conversation history that groups tool calls with their responses
    const formattedConversation: {role: string, content: string}[] = [];
    
    // Track which messages to skip (tool responses that have been grouped with their calls)
    const skipIndices = new Set<number>();
    
    // Process the conversation history
    for (let i = 0; i < this.conversationHistory.length; i++) {
      // Skip this message if it's already been processed as part of a tool call/response pair
      if (skipIndices.has(i)) {
        continue;
      }
      
      const message = this.conversationHistory[i];
      
      // If this is an assistant message with tool calls, find all corresponding tool responses
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
        // Skip tool call messages entirely when summarizing to avoid breaking the required sequence
        // We'll just include the regular content from this message if any
        if (message.content) {
          formattedConversation.push({
            role: message.role,
            content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
          });
        }
        
        // Mark all corresponding tool responses to be skipped
        for (const toolCall of message.tool_calls) {
          for (let j = i + 1; j < this.conversationHistory.length; j++) {
            const potentialResponse = this.conversationHistory[j];
            if (potentialResponse.role === 'tool' && potentialResponse.tool_call_id === toolCall.id) {
              skipIndices.add(j); // Mark this tool response to be skipped
              break;
            }
          }
        }
      } 
      // Skip individual tool responses if they weren't paired with a call
      else if (message.role === 'tool') {
        // Skip this message as it's a tool response without a call in our processing window
        continue;
      }
      // Regular message (user or assistant without tool calls)
      else {
        formattedConversation.push({
          role: message.role,
          content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
        });
      }
    }
    
    try {
      // Use OpenAI to generate a summary
      const openAIClient = new OpenAIClient().getClient();
      
      const response = await openAIClient.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system' as const,
            content: 'Your task is to summarize the following conversation between a user and an AI assistant. ' +
              'Focus on capturing the main topics discussed, key code snippets mentioned, important decisions made, ' +
              'and the overall context of the conversation. Keep the summary concise but informative. ' +
              'Make sure to preserve references to file paths and important code concepts.'
          },
          ...formattedConversation.map(msg => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content
          }))
        ],
        max_tokens: maxTokens
      });
      
      const summaryContent = response.choices[0]?.message?.content || 'Failed to generate conversation summary.';
      
      return {
        role: 'system',
        content: summaryContent,
        summary_type: 'conversation_history',
        file_references: Array.from(fileReferences),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error generating summary with OpenAI:', error);
      
      // Fall back to a basic summary if OpenAI fails
      const messages = this.conversationHistory;
      const userCount = messages.filter(m => m.role === 'user').length;
      const assistantCount = messages.filter(m => m.role === 'assistant').length;
      const toolCount = messages.filter(m => m.role === 'tool').length;
      
      const fallbackSummary = `Conversation summary (fallback): ${userCount} user messages, ${assistantCount} assistant messages, ${toolCount} tool interactions.`;
      
      return {
        role: 'system',
        content: fallbackSummary,
        summary_type: 'conversation_history',
        file_references: Array.from(fileReferences),
        timestamp: Date.now()
      };
    }
  }
}
