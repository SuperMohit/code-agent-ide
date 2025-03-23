import { ConversationMessage } from './types';

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
    
    // Find a safe truncation point: we need to keep tool calls with their responses
    // Start from earliest messages and remove whole exchanges
    let safeRemovalPoint = 0;
    
    // We assume that a well-formed exchange starts with user and is followed by assistant
    // We want to keep complete exchanges, so we look for points where the next message is from the user
    for (let i = 0; i < this.conversationHistory.length - minimumToKeep; i++) {
      if (i + 1 < this.conversationHistory.length && 
          this.conversationHistory[i + 1].role === 'user') {
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
   * Validates the conversation history to ensure all tool messages have valid preceding tool calls
   */
  public validateConversationHistory(): void {
    // Scan the conversation history to ensure tool responses have matching tool calls
    for (let i = 0; i < this.conversationHistory.length; i++) {
      const message = this.conversationHistory[i];
      
      // If this is a tool message, ensure it has a valid preceding assistant message with tool calls
      if (message.role === 'tool' && message.tool_call_id) {
        let foundMatchingToolCall = false;
        
        // Look back through previous messages to find a matching tool call
        for (let j = i - 1; j >= 0; j--) {
          const prevMessage = this.conversationHistory[j];
          
          if (prevMessage.role === 'assistant' && prevMessage.tool_calls) {
            // Check if any tool call in this message matches our tool message
            const matchingToolCall = prevMessage.tool_calls.find(
              (tc: any) => tc.id === message.tool_call_id
            );
            
            if (matchingToolCall) {
              foundMatchingToolCall = true;
              break;
            }
          }
        }
        
        if (!foundMatchingToolCall) {
          console.warn(`Tool message with ID ${message.tool_call_id} has no matching tool call`);
          // We could choose to remove this message, but for now we'll just log a warning
        }
      }
    }
  }
}
