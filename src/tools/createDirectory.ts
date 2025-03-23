import * as vscode from 'vscode';
import * as fs from 'fs';

export async function createDirectory(directoryPath: string): Promise<string> {
  try {
    // Validate the path
    if (!directoryPath) {
      return 'Error: DirectoryPath is required';
    }
    
    try {
      // Use the VS Code workspace FileSystem API to create the directory
      const directoryUri = vscode.Uri.file(directoryPath);
      await vscode.workspace.fs.createDirectory(directoryUri);
      
      console.log(`Successfully created directory: ${directoryPath}`);
      return `Directory created successfully: ${directoryPath}`;
    } catch (err: any) {
      console.error('Error creating directory:', err);
      return `Error creating directory: ${err.message}`;
    }
  } catch (error: any) {
    console.error('Error executing create_directory:', error);
    return `Error: ${error.message}`;
  }
}
