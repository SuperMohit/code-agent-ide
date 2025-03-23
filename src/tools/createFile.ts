import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function createFile(filePath: string, content: string): Promise<string> {
  try {
    // Check if file already exists
    if (fs.existsSync(filePath)) {
      return `Error: File already exists at ${filePath}. Use updateFile to modify existing files.`;
    }
    
    // Make sure the directory exists
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Create the file
    fs.writeFileSync(filePath, content, 'utf8');
    
    console.log(`Successfully created file: ${filePath}`);
    return `File created successfully: ${filePath}`;
  } catch (error: any) {
    console.error(`Error creating file ${filePath}:`, error);
    return `Error: ${error.message}`;
  }
}
