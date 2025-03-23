import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Service to track and provide the current project path
 */
export class ProjectPathService {
  private static instance: ProjectPathService;
  private currentProjectPath: string | undefined;
  private disposables: vscode.Disposable[] = [];
  
  private constructor() {
    // Initialize with the current active editor's path
    this.updateProjectPath();
    
    // Set up listeners for window state changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.updateProjectPath()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.updateProjectPath())
    );
  }
  
  /**
   * Get the singleton instance
   */
  public static getInstance(): ProjectPathService {
    if (!ProjectPathService.instance) {
      ProjectPathService.instance = new ProjectPathService();
    }
    return ProjectPathService.instance;
  }
  
  /**
   * Get the current project path
   * - If there's an active editor, returns the workspace folder containing that file
   * - Otherwise returns the first workspace folder
   * - If no workspace folders are open, returns undefined
   */
  public getCurrentProjectPath(): string | undefined {
    return this.currentProjectPath;
  }
  
  /**
   * Update the current project path based on the active editor
   */
  private updateProjectPath(): void {
    const activeEditor = vscode.window.activeTextEditor;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.currentProjectPath = undefined;
      return;
    }
    
    // If there's an active editor, find the workspace folder containing that file
    if (activeEditor) {
      const activeDocumentUri = activeEditor.document.uri;
      
      // Skip non-file URIs
      if (activeDocumentUri.scheme === 'file') {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeDocumentUri);
        
        if (workspaceFolder) {
          this.currentProjectPath = workspaceFolder.uri.fsPath;
          console.log(`Project path updated to: ${this.currentProjectPath}`);
          return;
        }
      }
    }
    
    // Fall back to the first workspace folder if no active editor or the active editor
    // is not in any workspace folder
    this.currentProjectPath = workspaceFolders[0].uri.fsPath;
    console.log(`Project path set to first workspace folder: ${this.currentProjectPath}`);
  }
  
  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
