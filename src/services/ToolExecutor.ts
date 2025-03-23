import * as vscode from 'vscode';
import * as path from 'path';
import { ContextFilesManager } from './ContextFilesManager';

// Import tool implementations
import { createFile } from '../tools/createFile';
import { updateFile } from '../tools/updateFile';
import { createDirectory } from '../tools/createDirectory';
import { findByName } from '../tools/findByName';
import { listDirectory } from '../tools/listDirectory';
import { viewFile } from '../tools/viewFile';
import { grepSearch } from '../tools/grepSearch';
import { codebaseSearch } from '../tools/codebaseSearch';
import { viewCodeItem } from '../tools/viewCodeItem';
import { readUrlContent } from '../tools/readUrlContent';
import { searchWeb } from '../tools/searchWeb';
import { runCommand } from '../tools/runCommand';
import { executeDone } from '../tools/done';
import { treeView } from '../tools/treeView';

/**
 * Handles the execution of tools used by the AI assistant
 */
export class ToolExecutor {
  constructor(private contextFilesManager: ContextFilesManager) {}

  /**
   * Execute a tool with timeout protection
   */
  public async executeToolWithTimeout(
    functionName: string, 
    functionArgs: any,
    timeoutMs: number = 30000
  ): Promise<string> {
    console.log(`Executing tool ${functionName} with args:`, functionArgs);
    
    try {
      // Create a promise with timeout
      const result = await this.executeWithTimeout(
        () => this.executeTool(functionName, functionArgs),
        timeoutMs
      );
      
      console.log(`Tool ${functionName} completed successfully.`);
      return result;
    } catch (error) {
      console.error(`Error executing tool ${functionName}:`, error);
      return `Error executing tool: ${error}`;
    }
  }

  /**
   * Execute the appropriate tool based on function name
   */
  private async executeTool(functionName: string, functionArgs: any): Promise<string> {
    switch (functionName) {
      case 'done':
        return this.executeDone(functionArgs);
        
      case 'create_file':
        return this.executeCreateFile(functionArgs);
        
      case 'update_file':
        return this.executeUpdateFile(functionArgs);
        
      case 'create_directory':
        return this.executeCreateDirectory(functionArgs);
      
      case 'find_by_name':
        return this.executeFindByName(functionArgs);
        
      case 'list_dir':
        return this.executeListDir(functionArgs);
        
      case 'tree_view':
        return this.executeTreeView(functionArgs);
        
      case 'view_file':
        return this.executeViewFile(functionArgs);
        
      case 'grep_search':
        return this.executeGrepSearch(functionArgs);
        
      case 'codebase_search':
        return this.executeCodebaseSearch(functionArgs);
        
      case 'view_code_item':
        return this.executeViewCodeItem(functionArgs);
        
      case 'read_url_content':
        return this.executeReadUrlContent(functionArgs);
        
      case 'search_web':
        return this.executeSearchWeb(functionArgs);
        
      case 'run_command':
        return this.executeRunCommand(functionArgs);
      
      default:
        return `Tool ${functionName} is not implemented yet.`;
    }
  }

  /**
   * Create a promise with timeout
   */
  private async executeWithTimeout(fn: () => Promise<string>, timeoutMs: number): Promise<string> {
    return new Promise(async (resolve) => {
      // Set a timeout to resolve after specified time
      const timeoutId = setTimeout(() => {
        resolve(`Tool execution timed out after ${timeoutMs/1000} seconds`);
      }, timeoutMs);
      
      try {
        // Try to execute the function
        const result = await fn();
        clearTimeout(timeoutId); // Clear timeout if successful
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId); // Clear timeout on error
        resolve(`Error executing tool: ${error}`);
      }
    });
  }

  /**
   * Execute the create_file tool
   */
  private async executeCreateFile(args: any): Promise<string> {
    const result = await createFile(args.FilePath, args.Content);
    // Add to context files if successful
    if (result.includes('successfully')) {
      this.contextFilesManager.addContextFile(args.FilePath);
    }
    return result;
  }

  /**
   * Execute the update_file tool
   */
  private async executeUpdateFile(args: any): Promise<string> {
    const result = await updateFile(
      args.FilePath, 
      args.Content, 
      args.InsertAtLine, 
      args.InsertAtColumn
    );
    // Add to context files if successful
    if (result.includes('successfully')) {
      this.contextFilesManager.addContextFile(args.FilePath);
    }
    return result;
  }

  /**
   * Execute the create_directory tool
   */
  private async executeCreateDirectory(args: any): Promise<string> {
    return createDirectory(args.DirectoryPath);
  }

  /**
   * Execute the find_by_name tool
   */
  private async executeFindByName(args: any): Promise<string> {
    try {
      console.log('Executing find_by_name with args:', JSON.stringify(args, null, 2));
      
      // Get current workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        return 'Error: No workspace folder is open';
      }
      
      // Use workspace folder if SearchDirectory is not provided or is invalid
      const searchDir = args.SearchDirectory || workspaceFolder;
      console.log(`Using search directory: ${searchDir}`);
      
      try {
        // Simple implementation to list files
        const files = await vscode.workspace.findFiles(
          args.Pattern ? `**/${args.Pattern}` : '**/*', 
          undefined,
          args.MaxDepth || undefined
        );
        
        const results = files.map(file => ({
          path: vscode.workspace.asRelativePath(file),
          name: path.basename(file.fsPath),
          isDirectory: false,
          type: 'file'
        }));
        
        console.log('Find by name results:', results.length);
        return JSON.stringify(results, null, 2);
      } catch (err) {
        console.error('VS Code find files error:', err);
        return `Error finding files: ${err}`;
      }
    } catch (error) {
      console.error('Error executing find_by_name:', error);
      return `Error: ${error}`;
    }
  }

  /**
   * Execute the list_dir tool
   */
  private async executeListDir(args: any): Promise<string> {
    try {
      console.log('Executing list_dir with args:', JSON.stringify(args, null, 2));
      
      // Get current workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        return 'Error: No workspace folder is open';
      }
      
      let directoryPath = args.DirectoryPath;
      if (!path.isAbsolute(directoryPath)) {
        directoryPath = path.join(workspaceFolder, directoryPath);
      }
      
      try {
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(directoryPath, '*'),
          undefined
        );
        
        const results = files.map(file => ({
          path: vscode.workspace.asRelativePath(file),
          name: path.basename(file.fsPath),
          isDirectory: false, // We can't easily determine this without additional fs calls
          type: 'file'
        }));
        
        return JSON.stringify(results, null, 2);
      } catch (err) {
        console.error('VS Code list dir error:', err);
        return `Error listing directory: ${err}`;
      }
    } catch (error) {
      console.error('Error executing list_dir:', error);
      return `Error: ${error}`;
    }
  }

  /**
   * Execute the view_file tool
   */
  private async executeViewFile(args: any): Promise<string> {
    try {
      console.log('Executing view_file with args:', JSON.stringify(args, null, 2));
      
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        return 'Error: No workspace folder is open';
      }
      
      let filePath = args.AbsolutePath;
      if (!path.isAbsolute(filePath)) {
        filePath = path.join(workspaceFolder, filePath);
      }
      
      // Add this file to our context files list
      this.contextFilesManager.addContextFile(filePath);
      
      try {
        const document = await vscode.workspace.openTextDocument(filePath);
        const content = document.getText();
        const lines = content.split('\n');
        
        const startLine = Math.max(0, args.StartLine || 0);
        const endLine = Math.min(lines.length - 1, args.EndLine || lines.length - 1);
        
        const selectedContent = lines.slice(startLine, endLine + 1).join('\n');
        return selectedContent;
      } catch (err) {
        console.error('VS Code view file error:', err);
        return `Error viewing file: ${err}`;
      }
    } catch (error) {
      console.error('Error executing view_file:', error);
      return `Error: ${error}`;
    }
  }

  /**
   * Execute the grep_search tool
   */
  private async executeGrepSearch(args: any): Promise<string> {
    try {
      console.log('Executing grep_search with args:', JSON.stringify(args, null, 2));
      
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        return 'Error: No workspace folder is open';
      }
      
      // Add search directory to context if specified
      if (args.SearchDirectory) {
        this.contextFilesManager.addContextFile(args.SearchDirectory);
      }
      
      try {
        // Use VS Code search API
        const searchResults = await vscode.workspace.findFiles(
          args.Includes?.length ? `**/{${args.Includes.join(',')}}` : '**/*',
          undefined
        );
        
        let allResults: string[] = [];
        
        for (const file of searchResults) {
          try {
            const document = await vscode.workspace.openTextDocument(file);
            const content = document.getText();
            
            if (content.includes(args.Query)) {
              if (args.MatchPerLine) {
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].includes(args.Query)) {
                    allResults.push(`${vscode.workspace.asRelativePath(file)}:${i+1}: ${lines[i]}`);
                  }
                }
              } else {
                allResults.push(vscode.workspace.asRelativePath(file));
              }
            }
          } catch (err) {
            console.error(`Error searching file ${file.fsPath}:`, err);
          }
        }
        
        return allResults.join('\n');
      } catch (err) {
        console.error('VS Code grep search error:', err);
        return `Error searching: ${err}`;
      }
    } catch (error) {
      console.error('Error executing grep_search:', error);
      return `Error: ${error}`;
    }
  }

  /**
   * Execute the codebase_search tool
   */
  private async executeCodebaseSearch(args: any): Promise<string> {
    try {
      console.log('Executing codebase_search with args:', JSON.stringify(args, null, 2));
      
      // Add target directories to context files
      if (args.TargetDirectories && Array.isArray(args.TargetDirectories)) {
        for (const dir of args.TargetDirectories) {
          this.contextFilesManager.addContextFile(dir);
        }
      }
      
      return await codebaseSearch(args.Query, args.TargetDirectories);
    } catch (error) {
      console.error('Error executing codebase_search:', error);
      return `Error: ${error}`;
    }
  }
  
  /**
   * Execute the view_code_item tool
   */
  private async executeViewCodeItem(args: any): Promise<string> {
    try {
      console.log('Executing view_code_item with args:', JSON.stringify(args, null, 2));
      
      // Add the file to context files
      if (args.File) {
        this.contextFilesManager.addContextFile(args.File);
      }
      
      return await viewCodeItem(args.File, args.NodePath);
    } catch (error) {
      console.error('Error executing view_code_item:', error);
      return `Error: ${error}`;
    }
  }
  
  /**
   * Execute the read_url_content tool
   */
  private async executeReadUrlContent(args: any): Promise<string> {
    try {
      console.log('Executing read_url_content with args:', JSON.stringify(args, null, 2));
      
      return await readUrlContent(args.Url);
    } catch (error) {
      console.error('Error executing read_url_content:', error);
      return `Error: ${error}`;
    }
  }
  
  /**
   * Execute the search_web tool
   */
  private async executeSearchWeb(args: any): Promise<string> {
    try {
      console.log('Executing search_web with args:', JSON.stringify(args, null, 2));
      
      return await searchWeb(args.query, args.domain);
    } catch (error) {
      console.error('Error executing search_web:', error);
      return `Error: ${error}`;
    }
  }
  
  /**
   * Execute the run_command tool
   */
  private async executeRunCommand(args: any): Promise<string> {
    try {
      console.log('Executing run_command with args:', JSON.stringify(args, null, 2));
      
      return await runCommand(args.CommandLine, args.Cwd);
    } catch (error) {
      console.error('Error executing run_command:', error);
      return `Error: ${error}`;
    }
  }
  
  /**
   * Execute the 'done' tool which signals task completion
   */
  private async executeDone(args: any): Promise<string> {
    try {
      console.log('Done tool called with summary:', args.summary);
      return await executeDone(args);
    } catch (error) {
      console.error('Error executing done tool:', error);
      return `Error executing done: ${error}`;
    }
  }

  /**
   * Execute the tree_view tool to display a directory tree
   */
  private async executeTreeView(args: any): Promise<string> {
    try {
      console.log('Executing tree_view with args:', JSON.stringify(args, null, 2));
      
      // Add the root directory to context files
      if (args.RootPath) {
        this.contextFilesManager.addContextFile(args.RootPath);
      }
      
      // Call the treeView function with the provided arguments
      return await treeView(
        args.RootPath,
        args.MaxDepth || 3,
        args.ShowHidden || false
      );
    } catch (error) {
      console.error('Error executing tree_view:', error);
      return `Error executing tree_view: ${error}`;
    }
  }
}
