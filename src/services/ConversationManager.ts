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
    
    // Format conversation for sending to OpenAI
    const formattedConversation = this.conversationHistory.map(message => {
      // Handle different message roles and formats
      if (message.role === 'tool') {
        return {
          role: 'assistant',
          content: `[Tool Response]: ${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`
        };
      } else if (message.tool_calls) {
        return {
          role: message.role,
          content: `[Tool Call]: ${JSON.stringify(message.tool_calls.map(tc => tc.function.name))}`
        };
      } else {
        return {
          role: message.role,
          content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
        };
      }
    });
    
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
