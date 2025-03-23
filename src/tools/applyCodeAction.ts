import { ServiceFactory } from '../services/ServiceFactory';
import { CodeActionInfo } from '../services/types/CodeActionInfo';

/**
 * Apply a code action to fix an issue in a file
 * 
 * @param args Object containing the file path and code action to apply
 * @returns Result of applying the code action
 */
export async function applyCodeAction(args: {
  FilePath: string;
  CodeAction: CodeActionInfo;
}): Promise<string> {
  try {
    // Validate inputs
    if (!args.FilePath) {
      return 'Error: File path is required';
    }
    
    if (!args.CodeAction) {
      return 'Error: CodeAction is required';
    }
    
    // Get the code action service
    const codeActionService = ServiceFactory.getCodeActionService();
    
    // Apply the code action
    const success = await codeActionService.applyCodeAction(
      args.FilePath,
      args.CodeAction
    );
    
    if (success) {
      return `Successfully applied code action: ${args.CodeAction.title}`;
    } else {
      return `Failed to apply code action: ${args.CodeAction.title}`;
    }
  } catch (error) {
    console.error('Error applying code action:', error);
    return `Error applying code action: ${error}`;
  }
}
