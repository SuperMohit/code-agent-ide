import * as vscode from 'vscode';
import { ServiceFactory } from '../services/ServiceFactory';

/**
 * Check for diagnostic issues in a specific file
 * @param filePath Path to the file to check for issues
 * @returns String with diagnostic information
 */
export async function checkDiagnostics(args: any): Promise<string> {
  const { filePath } = args;
  
  if (!filePath) {
    return 'Error: No file path provided for diagnostic check.';
  }
  
  try {
    // Get the diagnostics service
    const diagnosticsService = ServiceFactory.getDiagnosticsService();
    
    // Wait a short time for the language server to update diagnostics
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Get focused diagnostics for the specified file
    const diagnosticsReport = diagnosticsService.getFocusedDiagnosticsForFile(filePath);
    
    return diagnosticsReport;
  } catch (error) {
    console.error('Error checking diagnostics:', error);
    return `Error checking diagnostics: ${error}`;
  }
}
