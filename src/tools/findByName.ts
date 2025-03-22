import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);

interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  type: string;
}

/**
 * Find files and directories by name pattern
 * @param pattern Pattern to search for (glob-like)
 * @param dirPath Directory to search in
 * @param extensions File extensions to include (without leading .)
 * @param excludes Patterns to exclude
 * @param maxDepth Maximum depth to search
 * @param type Type of items to find ('file', 'directory', or 'any')
 * @param fullPath Whether to match against full path
 */
export async function findByName(
  pattern: string,
  dirPath: string,
  extensions: string[] = [],
  excludes: string[] = [],
  maxDepth?: number,
  type: 'file' | 'directory' | 'any' = 'any',
  fullPath: boolean = false
): Promise<FileInfo[]> {
  console.log(`findByName called with pattern=${pattern}, dirPath=${dirPath}`);

  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(regexPattern, 'i');

  // Convert extensions to lowercase
  const extensionsLower = extensions.map(ext => ext.toLowerCase());

  // Build exclude regexes
  const excludeRegexes = excludes.map(exclude => {
    const excludePattern = exclude
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(excludePattern, 'i');
  });

  const results: FileInfo[] = [];
  const currentDepth = 0;

  // Helper function to search directories recursively
  async function searchDir(currentPath: string, depth: number): Promise<void> {
    // Check depth limit
    if (maxDepth !== undefined && depth > maxDepth) {
      return;
    }

    try {
      const entries = await readdir(currentPath);

      for (const entry of entries) {
        const entryPath = path.join(currentPath, entry);
        
        try {
          const stats = await stat(entryPath);
          const isDir = stats.isDirectory();
          const relativePath = path.relative(dirPath, entryPath);
          
          // Check exclude patterns
          if (excludeRegexes.some(excludeRegex => 
            excludeRegex.test(fullPath ? entryPath : path.basename(entryPath)))) {
            continue;
          }

          // Match based on pattern and type
          const matchTarget = fullPath ? entryPath : path.basename(entryPath);
          const matchesPattern = regex.test(matchTarget);
          
          // Check extension if it's a file and extensions are specified
          const hasMatchingExtension = extensionsLower.length === 0 || 
            (isDir === false && extensionsLower.includes(path.extname(entryPath).substring(1).toLowerCase()));
          
          // Add to results if matches criteria
          if (matchesPattern && 
              (type === 'any' || (type === 'file' && !isDir) || (type === 'directory' && isDir)) &&
              (isDir || extensionsLower.length === 0 || hasMatchingExtension)) {
            results.push({
              path: relativePath,
              name: path.basename(entryPath),
              isDirectory: isDir,
              size: isDir ? undefined : stats.size,
              type: isDir ? 'directory' : 'file'
            });
          }

          // Recurse into directories
          if (isDir) {
            await searchDir(entryPath, depth + 1);
          }
        } catch (err) {
          console.error(`Error processing ${entryPath}:`, err);
          // Continue with other entries
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${currentPath}:`, err);
      // Let the error propagate
      throw err;
    }
  }

  try {
    await searchDir(dirPath, currentDepth);
    return results;
  } catch (error) {
    console.error('Error in findByName:', error);
    throw error;
  }
}
