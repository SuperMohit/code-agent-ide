import { ServiceFactory } from '../services/ServiceFactory';
import { DiagnosticInfo } from '../services/DiagnosticsService';

/**
 * Get code actions (quick fixes) for a file or specific range
 * 
 * @param args Object containing the file path and optional range or diagnostic info
 * @returns Available code actions or quick fixes
 */
export async function getCodeActions(args: {
  FilePath: string;
  StartLine?: number;
  StartCharacter?: number;
  EndLine?: number;
  EndCharacter?: number;
  AllQuickFixes?: boolean;
  DiagnosticInfo?: DiagnosticInfo;
}): Promise<string> {
  try {
    // Validate file path
    if (!args.FilePath) {
      return 'Error: File path is required';
    }
    
    // Get the code action service
    const codeActionService = ServiceFactory.getCodeActionService();
    
    // If AllQuickFixes is true, get all quick fixes for the file
    if (args.AllQuickFixes) {
      const quickFixes = await codeActionService.getQuickFixesForFile(args.FilePath);
      return quickFixes;
    }
    
    // If a range is provided, get code actions for that range
    if (args.StartLine !== undefined && args.StartCharacter !== undefined && 
        args.EndLine !== undefined && args.EndCharacter !== undefined) {
      
      const codeActions = await codeActionService.getCodeActionsForRange(
        args.FilePath,
        args.StartLine,
        args.StartCharacter,
        args.EndLine,
        args.EndCharacter
      );
      
      if (codeActions.length === 0) {
        return 'No code actions available for the specified range.';
      }
      
      let result = `Available code actions for the specified range:\n\n`;
      codeActions.forEach((action, index) => {
        result += `${index + 1}. ${action.title}`;
        if (action.kind) {
          result += ` (${action.kind})`;
        }
        if (action.isPreferred) {
          result += ' [Preferred]';
        }
        result += '\n';
      });
      
      return result;
    }
    
    // If DiagnosticInfo is provided, get code actions for that diagnostic
    if (args.DiagnosticInfo) {
      const codeActions = await codeActionService.getCodeActionsForDiagnostic(
        args.FilePath,
        args.DiagnosticInfo
      );
      
      if (codeActions.length === 0) {
        return 'No code actions available for the specified diagnostic.';
      }
      
      let result = `Available code actions for diagnostic "${args.DiagnosticInfo.message}":\n\n`;
      codeActions.forEach((action, index) => {
        result += `${index + 1}. ${action.title}`;
        if (action.kind) {
          result += ` (${action.kind})`;
        }
        if (action.isPreferred) {
          result += ' [Preferred]';
        }
        result += '\n';
      });
      
      return result;
    }
    
    // If no specific options are provided, get all quick fixes for the file
    return await codeActionService.getQuickFixesForFile(args.FilePath);
  } catch (error) {
    console.error('Error getting code actions:', error);
    return `Error getting code actions: ${error}`;
  }
}
