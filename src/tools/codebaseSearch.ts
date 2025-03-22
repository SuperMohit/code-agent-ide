import * as fs from 'fs';
import * as path from 'path';

export async function codebaseSearch(query: string, targetDirectories: string[]): Promise<string> {
  const results: string[] = [];
  
  for (const dir of targetDirectories) {
    await searchDirectoryForCode(dir, query, results);
  }
  
  return results.length > 0 ? results.join('\n\n') : 'No results found.';
}

async function searchDirectoryForCode(directory: string, query: string, results: string[]): Promise<void> {
  try {
    const files = fs.readdirSync(directory);
    
    for (const file of files) {
      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git') {
          await searchDirectoryForCode(filePath, query, results);
        }
      } else if (stats.isFile()) {
        const ext = path.extname(file).toLowerCase();
        if (['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs'].includes(ext)) {
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            if (content.toLowerCase().includes(query.toLowerCase())) {
              results.push(`File: ${filePath}\n\`\`\`\n${content.slice(0, 500)}${content.length > 500 ? '...' : ''}\n\`\`\``);
            }
          } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error searching directory ${directory}:`, error);
  }
}
