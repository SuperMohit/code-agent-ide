import * as vscode from 'vscode';
import * as path from 'path';
import { IDiagnosticsService } from './interfaces';

/**
 * Interface for diagnostic information
 */
export interface DiagnosticInfo {
  message: string;
  severity: vscode.DiagnosticSeverity;
  source: string;
  code?: string | number;
  filePath: string;
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
  relatedInformation?: Array<{
    message: string;
    filePath: string;
    range: {
      startLine: number;
      startCharacter: number;
      endLine: number;
      endCharacter: number;
    };
  }>;
}

/**
 * Service for collecting and analyzing diagnostics (errors, warnings) from the editor
 */
export class DiagnosticsService implements IDiagnosticsService {
  private disposables: vscode.Disposable[] = [];
  private onDidChangeDiagnosticsEmitter = new vscode.EventEmitter<DiagnosticInfo[]>();
  
  /**
   * Event that fires when diagnostics change
   */
  public readonly onDidChangeDiagnostics = this.onDidChangeDiagnosticsEmitter.event;
  
  constructor() {
    // Subscribe to diagnostic changes
    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics(this.handleDiagnosticsChange.bind(this))
    );
  }
  
  /**
   * Handle changes in diagnostics
   */
  private handleDiagnosticsChange(event: vscode.DiagnosticChangeEvent): void {
    const allDiagnostics: DiagnosticInfo[] = [];
    
    // Process each URI that has diagnostic changes
    for (const uri of event.uris) {
      const diagnostics = vscode.languages.getDiagnostics(uri);
      if (diagnostics.length > 0) {
        // Convert VS Code diagnostics to our format
        const fileDiagnostics = diagnostics.map(diagnostic => this.convertDiagnostic(diagnostic, uri));
        allDiagnostics.push(...fileDiagnostics);
      }
    }
    
    // Emit the event with all collected diagnostics
    if (allDiagnostics.length > 0) {
      this.onDidChangeDiagnosticsEmitter.fire(allDiagnostics);
    }
  }
  
  /**
   * Convert VS Code diagnostic to our DiagnosticInfo format
   */
  private convertDiagnostic(diagnostic: vscode.Diagnostic, uri: vscode.Uri): DiagnosticInfo {
    const result: DiagnosticInfo = {
      message: diagnostic.message,
      severity: diagnostic.severity,
      source: diagnostic.source || 'unknown',
      code: typeof diagnostic.code === 'object' ? String(diagnostic.code.value) : diagnostic.code,
      filePath: uri.fsPath,
      range: {
        startLine: diagnostic.range.start.line,
        startCharacter: diagnostic.range.start.character,
        endLine: diagnostic.range.end.line,
        endCharacter: diagnostic.range.end.character
      }
    };
    
    // Add related information if present
    if (diagnostic.relatedInformation) {
      result.relatedInformation = diagnostic.relatedInformation.map(info => ({
        message: info.message,
        filePath: info.location.uri.fsPath,
        range: {
          startLine: info.location.range.start.line,
          startCharacter: info.location.range.start.character,
          endLine: info.location.range.end.line,
          endCharacter: info.location.range.end.character
        }
      }));
    }
    
    return result;
  }
  
  /**
   * Get all current diagnostics across the workspace
   * @returns Array of diagnostic information
   */
  public getAllDiagnostics(): DiagnosticInfo[] {
    const allDiagnostics: DiagnosticInfo[] = [];
    
    // Get diagnostics for all open documents
    for (const document of vscode.workspace.textDocuments) {
      const uri = document.uri;
      const diagnostics = vscode.languages.getDiagnostics(uri);
      
      if (diagnostics.length > 0) {
        const fileDiagnostics = diagnostics.map(diagnostic => 
          this.convertDiagnostic(diagnostic, uri)
        );
        allDiagnostics.push(...fileDiagnostics);
      }
    }
    
    return allDiagnostics;
  }
  
  /**
   * Get diagnostics for a specific file
   * @param filePath Path to the file
   * @returns Array of diagnostic information for the file
   */
  public getDiagnosticsForFile(filePath: string): DiagnosticInfo[] {
    const uri = vscode.Uri.file(filePath);
    const diagnostics = vscode.languages.getDiagnostics(uri);
    
    return diagnostics.map(diagnostic => this.convertDiagnostic(diagnostic, uri));
  }
  
  /**
   * Get only error diagnostics (filtering out warnings and info)
   * @returns Array of error diagnostic information
   */
  public getErrorDiagnostics(): DiagnosticInfo[] {
    return this.getAllDiagnostics().filter(
      diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error
    );
  }
  
  /**
   * Get only TypeScript/JavaScript related diagnostics
   * @returns Array of TypeScript/JavaScript diagnostic information
   */
  public getTypeScriptDiagnostics(): DiagnosticInfo[] {
    return this.getAllDiagnostics().filter(
      diagnostic => 
        diagnostic.source === 'ts' || 
        diagnostic.source === 'typescript' || 
        diagnostic.source === 'javascript'
    );
  }
  
  /**
   * Gets focused diagnostics for a specific file, with detailed explanation of the errors
   * @param filePath The file path to analyze
   * @returns A formatted string with diagnostics information and suggestions
   */
  public getFocusedDiagnosticsForFile(filePath: string): string {
    const diagnostics = this.getDiagnosticsForFile(filePath);
    
    if (diagnostics.length === 0) {
      return `No issues found in ${filePath}.`;
    }
    
    const errorCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warningCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;
    
    let result = `Found ${errorCount} errors and ${warningCount} warnings in ${path.basename(filePath)}:\n\n`;
    
    // Group by severity
    const byLevel = {
      [vscode.DiagnosticSeverity.Error]: 'Error',
      [vscode.DiagnosticSeverity.Warning]: 'Warning',
      [vscode.DiagnosticSeverity.Information]: 'Info',
      [vscode.DiagnosticSeverity.Hint]: 'Hint'
    };
    
    // Sort by severity (errors first) and then by line number
    const sortedDiagnostics = [...diagnostics].sort((a, b) => {
      if (a.severity !== b.severity) {
        return a.severity - b.severity;
      }
      return a.range.startLine - b.range.startLine;
    });
    
    // Format each diagnostic
    sortedDiagnostics.forEach((diag, i) => {
      const levelName = byLevel[diag.severity] || 'Unknown';
      const location = `Line ${diag.range.startLine + 1}, Col ${diag.range.startCharacter + 1}`;
      const codeInfo = diag.code ? ` [${diag.code}]` : '';
      
      result += `${i + 1}. ${levelName}${codeInfo}: ${diag.message}\n`;
      result += `   Location: ${location}\n`;
      
      // Add explanation for common TypeScript errors
      if (diag.source === 'ts' && diag.code) {
        const explanation = this.getTypeScriptErrorExplanation(String(diag.code), diag.message);
        if (explanation) {
          result += `   Explanation: ${explanation}\n`;
        }
      }
      
      result += '\n';
    });
    
    return result;
  }
  
  /**
   * Provides explanations for common TypeScript errors
   */
  private getTypeScriptErrorExplanation(code: string, _message: string): string | undefined {
    const explanations: Record<string, string> = {
      '2304': 'Cannot find name. This usually means the variable or type is not defined or imported.',
      '2322': 'Type mismatch. The assigned value does not match the expected type.',
      '2339': 'Property does not exist on type. Make sure the property exists on the object.',
      '2345': 'Argument mismatch. The provided argument doesn\'t match the parameter type.',
      '2307': 'Cannot find module. Ensure the module is installed and properly imported.',
      '2769': 'No overload matches this call. Check the function signature and arguments.',
      '1005': 'Expected a closing token like ) or }. Check for missing brackets or parentheses.',
      '1128': 'Declaration or statement expected. Check for syntax errors in your code.'
    };
    
    return explanations[code];
  }
  
  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.disposables.forEach(disposable => disposable.dispose());
    this.disposables = [];
    this.onDidChangeDiagnosticsEmitter.dispose();
  }
}
