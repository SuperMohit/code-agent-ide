import { IResponseGeneratorService } from './interfaces';

/**
 * Service responsible for generating the final response from the assistant message
 */
export class ResponseGeneratorService implements IResponseGeneratorService {
  /**
   * Generate a final response from the assistant message
   * @param assistantMessage The message from the assistant
   * @returns The final response string
   */
  public generateFinalResponse(assistantMessage: any): string {
    // If there's content in the message, return it
    if (assistantMessage.content) {
      return assistantMessage.content;
    }
    
    // If there's no content but there are tool calls, generate a fallback response
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      return "I'm working on your request. Let me analyze this further...";
    }
    
    // Default empty response
    return '';
  }
}
