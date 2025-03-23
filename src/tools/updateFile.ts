import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ServiceFactory } from '../services/ServiceFactory';

/**
 * Check for diagnostics in the updated file
 * @param filePath Path to the file to check
 * @returns Diagnostic information as a string
 */
async function checkForDiagnostics(filePath: string): Promise<string> {
  // Only check diagnostics for code files
  const codeExtensions = ['.ts', '.js', '.tsx', '.jsx', '.json', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rb'];
  const fileExt = path.extname(filePath);
  
  if (!codeExtensions.includes(fileExt)) {
    return ''; // Not a code file, no diagnostics
  }
  
  try {
    // Wait a short time for language server to process the file
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get diagnostics service
    const diagnosticsService = ServiceFactory.getDiagnosticsService();
    
    // Get focused diagnostics for the file
    const diagnostics = diagnosticsService.getFocusedDiagnosticsForFile(filePath);
    
    // If there are no issues, return a simple message
    if (diagnostics.startsWith('No issues')) {
      return 'No diagnostic issues found.';
    }
    
    return `Diagnostic check results:\n${diagnostics}`;
  } catch (error) {
    console.error('Error checking diagnostics after file update:', error);
    return '';
  }
}

export async function updateFile(
  filePath: string, 
  content: string,
  insertAtLine?: number,
  insertAtColumn?: number
): Promise<string> {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return `Error: File does not exist at ${filePath}. Use createFile to create a new file.`;
    }
    
    if (insertAtLine !== undefined) {
      // Insert content at a specific line and column
      try {
        // Read the existing content
        const existingContent = fs.readFileSync(filePath, 'utf8');
        const lines = existingContent.split('\n');
        
        // Check if the line number is valid
        if (insertAtLine < 0 || insertAtLine >= lines.length) {
          return `Error: Line number ${insertAtLine} is out of range (file has ${lines.length} lines)`;
        }
        
        // Insert the content at the specified position
        const column = insertAtColumn || 0;
        const targetLine = lines[insertAtLine];
        
        if (column > targetLine.length) {
          return `Error: Column number ${column} is out of range (line has ${targetLine.length} characters)`;
        }
        
        const lineStart = targetLine.substring(0, column);
        const lineEnd = targetLine.substring(column);
        lines[insertAtLine] = lineStart + content + lineEnd;
        
        // Write the updated content back to the file
        const updatedContent = lines.join('\n');
        fs.writeFileSync(filePath, updatedContent, 'utf8');
        
        console.log(`Successfully updated file: ${filePath} at line ${insertAtLine}, column ${column}`);
        
        // Check for diagnostics if it's a code file
        const diagnosticsResult = await checkForDiagnostics(filePath);
        
        return `File updated successfully: ${filePath} (inserted content at line ${insertAtLine}, column ${column})\n\n${diagnosticsResult}`;
      } catch (err: any) {
        console.error('Error updating file at specific position:', err);
        return `Error updating file at position: ${err.message}`;
      }
    } else {
      // Replace the entire file content
      fs.writeFileSync(filePath, content, 'utf8');
      
      console.log(`Successfully updated file: ${filePath}`);
      
      // Check for diagnostics if it's a code file
      const diagnosticsResult = await checkForDiagnostics(filePath);
      
      return `File updated successfully: ${filePath}\n\n${diagnosticsResult}`;
    }
  } catch (error: any) {
    console.error(`Error updating file ${filePath}:`, error);
    return `Error: ${error.message}`;
  }
}
