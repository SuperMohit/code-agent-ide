import * as vscode from 'vscode';
import * as fs from 'fs';

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
        return `File updated successfully: ${filePath} (inserted content at line ${insertAtLine}, column ${column})`;
      } catch (err: any) {
        console.error('Error updating file at specific position:', err);
        return `Error updating file at position: ${err.message}`;
      }
    } else {
      // Replace the entire file content
      fs.writeFileSync(filePath, content, 'utf8');
      
      console.log(`Successfully updated file: ${filePath}`);
      return `File updated successfully: ${filePath}`;
    }
  } catch (error: any) {
    console.error(`Error updating file ${filePath}:`, error);
    return `Error: ${error.message}`;
  }
}
