import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Manages context files used during AI conversations
 */
export class ContextFilesManager {
  private contextFiles: Set<string> = new Set<string>();
  private _onDidUpdateContextFiles = new vscode.EventEmitter<string[]>();
  public readonly onDidUpdateContextFiles = this._onDidUpdateContextFiles.event;

  /**
   * Add a file to the context files list
   * @param filePath The path to the file that was accessed
   */
  public addContextFile(filePath: string): void {
    // Only add if it's a file that actually exists
    try {
      const normalizedPath = path.normalize(filePath);
      
      this.contextFiles.add(normalizedPath);
      
      this._onDidUpdateContextFiles.fire(this.getContextFiles());
      console.log(`Added ${normalizedPath} to context files`);
    } catch (error) {
      console.error(`Error adding context file ${filePath}:`, error);
    }
  }
  
  /**
   * Get the list of context files
   * @returns Array of file paths that have been used for context
   */
  public getContextFiles(): string[] {
    return Array.from(this.contextFiles);
  }
  
  /**
   * Clear the list of context files
   */
  public clearContextFiles(): void {
    this.contextFiles.clear();
    this._onDidUpdateContextFiles.fire([]);
    console.log('Context files have been cleared');
  }
}
