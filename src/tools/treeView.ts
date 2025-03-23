import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../types/ToolDefinition';

/**
 * Definition for the 'tree_view' tool
 */
export const treeViewToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'tree_view',
    description: 'Display a recursive tree view of files and directories starting from the specified path',
    parameters: {
      type: 'object',
      properties: {
        RootPath: {
          type: 'string',
          description: 'The root directory path to start the tree view from'
        },
        MaxDepth: {
          type: 'integer',
          description: 'Maximum depth to traverse (default: 3)'
        },
        ShowHidden: {
          type: 'boolean',
          description: 'Whether to show hidden files and directories (default: false)'
        }
      },
      required: ['RootPath']
    }
  }
};

/**
 * Generate a tree view of a directory structure
 * @param rootPath The root directory to start from
 * @param maxDepth Maximum depth to traverse (default: 3)
 * @param showHidden Whether to show hidden files (default: false)
 * @returns A formatted string representation of the directory tree
 */
export async function treeView(
  rootPath: string, 
  maxDepth: number = 3, 
  showHidden: boolean = false
): Promise<string> {
  try {
    if (!fs.existsSync(rootPath)) {
      return `Error: Path does not exist: ${rootPath}`;
    }
    
    const stats = fs.statSync(rootPath);
    if (!stats.isDirectory()) {
      return `Error: Path is not a directory: ${rootPath}`;
    }
    
    // Generate the tree view
    const lines: string[] = [`${path.basename(rootPath)}/`];
    await generateTree(rootPath, '', 1, maxDepth, showHidden, lines);
    
    // Add summary stats
    const summary = countItems(rootPath, maxDepth, showHidden);
    lines.push('');
    lines.push(`${summary.directories} directories, ${summary.files} files`);
    
    return lines.join('\n');
  } catch (error) {
    console.error(`Error generating tree view for ${rootPath}:`, error);
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Helper function to generate the tree recursively
 */
async function generateTree(
  dirPath: string,
  prefix: string,
  currentDepth: number,
  maxDepth: number,
  showHidden: boolean,
  lines: string[]
): Promise<void> {
  if (currentDepth > maxDepth) {
    return;
  }
  
  try {
    const files = fs.readdirSync(dirPath);
    
    // Filter hidden files if needed
    const filteredFiles = showHidden 
      ? files 
      : files.filter(file => !file.startsWith('.'));
    
    // Sort directories first, then files
    const sortedFiles = filteredFiles.sort((a, b) => {
      const aPath = path.join(dirPath, a);
      const bPath = path.join(dirPath, b);
      const aIsDir = fs.statSync(aPath).isDirectory();
      const bIsDir = fs.statSync(bPath).isDirectory();
      
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });
    
    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      const filePath = path.join(dirPath, file);
      const isLast = i === sortedFiles.length - 1;
      
      try {
        const stats = fs.statSync(filePath);
        
        // Choose the appropriate branch characters
        const branchChar = isLast ? '└── ' : '├── ';
        const nextPrefix = isLast ? prefix + '    ' : prefix + '│   ';
        
        // Add the current file/directory to the output
        if (stats.isDirectory()) {
          lines.push(`${prefix}${branchChar}${file}/`);
          
          // Recursively process subdirectories
          await generateTree(filePath, nextPrefix, currentDepth + 1, maxDepth, showHidden, lines);
        } else {
          const sizeStr = formatSize(stats.size);
          lines.push(`${prefix}${branchChar}${file} (${sizeStr})`);
        }
      } catch (error) {
        // Define branchChar here in case the stats call failed
        const errorBranchChar = isLast ? '└── ' : '├── ';
        lines.push(`${prefix}${errorBranchChar}${file} [Error: ${error instanceof Error ? error.message : String(error)}]`);
      }
    }
  } catch (error) {
    lines.push(`${prefix}[Error reading directory: ${error instanceof Error ? error.message : String(error)}]`);
  }
}

/**
 * Count the number of files and directories
 */
function countItems(
  dirPath: string, 
  maxDepth: number, 
  showHidden: boolean
): { files: number; directories: number } {
  const result = { files: 0, directories: 0 };
  
  function count(path: string, depth: number) {
    if (depth > maxDepth) return;
    
    try {
      const files = fs.readdirSync(path);
      const filteredFiles = showHidden ? files : files.filter(f => !f.startsWith('.'));
      
      for (const file of filteredFiles) {
        const filePath = path + '/' + file;
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            result.directories++;
            count(filePath, depth + 1);
          } else {
            result.files++;
          }
        } catch (error) {
          // Skip files with permission errors
        }
      }
    } catch (error) {
      // Skip directories with permission errors
    }
  }
  
  count(dirPath, 1);
  return result;
}

/**
 * Format file size in a human-readable format
 */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return unitIndex === 0 
    ? `${size} ${units[unitIndex]}` 
    : `${size.toFixed(1)} ${units[unitIndex]}`;
}
