import { ConversationMessage } from './types';
import { IMessageFormatterService } from './interfaces';

/**
 * Service responsible for formatting and preparing messages for OpenAI API
 */
export class MessageFormatterService implements IMessageFormatterService {
  /**
   * Format conversation messages with system prompt and error messages
   */
  public formatMessages(systemPrompt: string, conversationHistory: ConversationMessage[], lastError: Error | null): any[] {
    let messages = [
      { role: 'system', content: systemPrompt }
    ];
    
    // If there was an error in the previous iteration, add a special message about it
    if (lastError) {
      messages.push({
        role: 'user',
        content: `There was an error in the previous step: ${lastError.message}. Please handle this gracefully and adjust your approach.`
      });
    }
    
    // Add conversation history
    messages = [...messages, ...conversationHistory];
    
    return messages;
  }

  /**
   * Determine if conversation history should be summarized based on size thresholds
   */
  public shouldSummarizeHistory(
    conversationHistory: ConversationMessage[], 
    maxPayloadSize: number, 
    maxMessages: number
  ): boolean {
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
    return totalPayloadSize > maxPayloadSize || conversationHistory.length > maxMessages;
  }
}
