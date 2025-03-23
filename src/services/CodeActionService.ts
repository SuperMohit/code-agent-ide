import * as vscode from 'vscode';
import { ICodeActionService } from './interfaces';
import { DiagnosticInfo } from './DiagnosticsService';
import { CodeActionInfo } from './types/CodeActionInfo';

/**
 * Service for getting and applying code actions from the language server
 */
export class CodeActionService implements ICodeActionService {
  /**
   * Get code actions available for a specific range in a file
   * @param filePath Path to the file
   * @param startLine Start line of the range (0-based)
   * @param startCharacter Start character of the range (0-based)
   * @param endLine End line of the range (0-based)
   * @param endCharacter End character of the range (0-based)
   * @returns Available code actions
   */
  public async getCodeActionsForRange(
    filePath: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number
  ): Promise<CodeActionInfo[]> {
    const uri = vscode.Uri.file(filePath);
    const range = new vscode.Range(
      startLine,
      startCharacter,
      endLine,
      endCharacter
    );
    
    // Get code actions from the language server
    const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      uri,
      range
    );
    
    if (!codeActions || codeActions.length === 0) {
      return [];
    }
    
    // Convert to our format
    return this.convertCodeActions(codeActions);
  }
  
  /**
   * Get code actions available for a specific diagnostic
   * @param filePath Path to the file
   * @param diagnostic Diagnostic information
   * @returns Available code actions
   */
  public async getCodeActionsForDiagnostic(
    filePath: string,
    diagnostic: DiagnosticInfo
  ): Promise<CodeActionInfo[]> {
    // Convert diagnostic range to VS Code range
    const range = new vscode.Range(
      diagnostic.range.startLine,
      diagnostic.range.startCharacter,
      diagnostic.range.endLine,
      diagnostic.range.endCharacter
    );
    
    // Create a VS Code diagnostic to get accurate code actions
    const vscodeDiagnostic = new vscode.Diagnostic(
      range,
      diagnostic.message,
      diagnostic.severity // Already a vscode.DiagnosticSeverity
    );
    
    // Add the diagnostic code if available
    if (diagnostic.code) {
      vscodeDiagnostic.code = diagnostic.code;
    }
    
    const uri = vscode.Uri.file(filePath);
    
    // Get code actions from the language server, specifically for fixing this diagnostic
    const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      uri,
      range,
      vscode.CodeActionKind.QuickFix
    );
    
    if (!codeActions || codeActions.length === 0) {
      return [];
    }
    
    // Filter actions that specifically fix this diagnostic
    const relevantActions = codeActions.filter(action => {
      if (!action.diagnostics) return false;
      
      return action.diagnostics.some(d => 
        d.message === diagnostic.message &&
        d.range.isEqual(range) &&
        d.severity === diagnostic.severity // Already a vscode.DiagnosticSeverity
      );
    });
    
    // Convert to our format
    return this.convertCodeActions(relevantActions);
  }
  
  /**
   * Apply a code action to a file
   * @param filePath Path to the file
   * @param codeAction Code action to apply
   * @returns True if applied successfully
   */
  public async applyCodeAction(
    _filePath: string, // Prefix with underscore to indicate it's intentionally unused
    codeAction: CodeActionInfo
  ): Promise<boolean> {
    if (!codeAction.edit || !codeAction.edit.changes) {
      console.warn('Code action does not have an edit:', codeAction);
      return false;
    }
    
    try {
      // Create a workspace edit to apply the changes
      const workspaceEdit = new vscode.WorkspaceEdit();
      
      // Add each change to the edit
      Object.entries(codeAction.edit.changes).forEach(([fileUri, edits]) => {
        const uri = vscode.Uri.parse(fileUri);
        
        edits.forEach(edit => {
          const range = new vscode.Range(
            edit.range.startLine,
            edit.range.startCharacter,
            edit.range.endLine,
            edit.range.endCharacter
          );
          
          workspaceEdit.replace(uri, range, edit.newText);
        });
      });
      
      // Apply the edit
      const success = await vscode.workspace.applyEdit(workspaceEdit);
      
      if (success) {
        console.log(`Successfully applied code action: ${codeAction.title}`);
      } else {
        console.warn(`Failed to apply code action: ${codeAction.title}`);
      }
      
      return success;
    } catch (error) {
      console.error('Error applying code action:', error);
      return false;
    }
  }
  
  /**
   * Get a formatted list of all quick fixes available for a file
   * @param filePath Path to the file
   * @returns Formatted string with all quick fixes
   */
  public async getQuickFixesForFile(filePath: string): Promise<string> {
    try {
      const uri = vscode.Uri.file(filePath);
      
      // Get the document
      const document = await vscode.workspace.openTextDocument(uri);
      
      // Get all diagnostics for the file
      const diagnostics = vscode.languages.getDiagnostics(uri);
      
      if (diagnostics.length === 0) {
        return `No issues found in ${filePath}, so no quick fixes are available.`;
      }
      
      // Get quick fixes for each diagnostic
      let result = `Quick fixes available for ${filePath}:\\n`;
      
      for (let i = 0; i < diagnostics.length; i++) {
        const diagnostic = diagnostics[i];
        const lineText = document.lineAt(diagnostic.range.start.line).text.trim();
        
        // Convert diagnostic to our format for code action lookup
        const diagnosticInfo: DiagnosticInfo = {
          message: diagnostic.message,
          severity: diagnostic.severity, // Keep as vscode.DiagnosticSeverity
          source: diagnostic.source || '',
          code: diagnostic.code?.toString() || '',
          filePath: uri.fsPath, // Add missing filePath property
          range: {
            startLine: diagnostic.range.start.line,
            startCharacter: diagnostic.range.start.character,
            endLine: diagnostic.range.end.line,
            endCharacter: diagnostic.range.end.character
          }
        };
        
        // Get code actions for this diagnostic
        const codeActions = await this.getCodeActionsForDiagnostic(filePath, diagnosticInfo);
        
        if (codeActions.length > 0) {
          result += `\\n${i + 1}. Line ${diagnostic.range.start.line + 1}: ${diagnostic.message}\\n`;
          result += `   Code: ${lineText}\\n`;
          result += '   Available fixes:\\n';
          
          codeActions.forEach((action, index) => {
            result += `   ${String.fromCharCode(97 + index)}. ${action.title}\\n`;
          });
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error getting quick fixes for file:', error);
      return `Error getting quick fixes for ${filePath}: ${error}`;
    }
  }
  
  /**
   * Convert VS Code code actions to our format
   * @param codeActions VS Code code actions
   * @returns Converted code actions
   */
  private convertCodeActions(codeActions: vscode.CodeAction[]): CodeActionInfo[] {
    return codeActions.map(action => {
      const result: CodeActionInfo = {
        title: action.title,
        kind: action.kind?.value || '',
        isPreferred: !!action.isPreferred
      };
      
      // Include edit information if available
      if (action.edit) {
        result.edit = {
          changes: {}
        };
        
        action.edit.entries().forEach(([uri, edits]) => {
          const key = uri.toString();
          result.edit!.changes[key] = edits.map(edit => ({
            range: {
              startLine: edit.range.start.line,
              startCharacter: edit.range.start.character,
              endLine: edit.range.end.line,
              endCharacter: edit.range.end.character
            },
            newText: edit.newText
          }));
        });
      }
      
      if (action.diagnostics && action.diagnostics.length > 0) {
        result.source = action.diagnostics[0].source || undefined;
      }
      
      return result;
    });
  }
  
  /**
   * Get a user-friendly string representation of a diagnostic severity
   * @param severity The diagnostic severity
   * @returns A human-readable string representation
   */
  private getSeverityLabel(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return 'Error';
      case vscode.DiagnosticSeverity.Warning:
        return 'Warning';
      case vscode.DiagnosticSeverity.Information:
        return 'Information';
      case vscode.DiagnosticSeverity.Hint:
        return 'Hint';
      default:
        return 'Unknown';
    }
  }
}
