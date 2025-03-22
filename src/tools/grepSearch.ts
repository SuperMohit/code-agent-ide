import * as fs from 'fs';
import * as path from 'path';

export async function grepSearch(
  query: string, 
  searchDirectory: string, 
  includes?: string[], 
  matchPerLine?: boolean, 
  caseInsensitive?: boolean
): Promise<string> {
  const results: string[] = [];
  
  try {
    const files = fs.readdirSync(searchDirectory);
    
    for (const file of files) {
      const filePath = path.join(searchDirectory, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        // Skip node_modules and .git directories
        if (file !== 'node_modules' && file !== '.git') {
          const subResults = await grepSearch(query, filePath, includes, matchPerLine, caseInsensitive);
          if (subResults && subResults !== 'No results found.') {
            results.push(subResults);
          }
        }
      } else if (stats.isFile()) {
        // Check if file matches includes pattern
        if (includes && includes.length > 0) {
          const matchesPattern = includes.some(pattern => {
            if (pattern.includes('*')) {
              // Simple glob pattern matching
              const regex = new RegExp('^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
              return regex.test(file);
            }
            return file === pattern;
          });
          
          if (!matchesPattern) {
            continue;
          }
        }
        
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const queryRegex = new RegExp(query, caseInsensitive ? 'ig' : 'g');
          
          if (queryRegex.test(content)) {
            if (matchPerLine) {
              const lines = content.split('\n');
              lines.forEach((line, lineNumber) => {
                if (new RegExp(query, caseInsensitive ? 'i' : '').test(line)) {
                  results.push(`${filePath}:${lineNumber + 1}: ${line}`);
                }
              });
            } else {
              results.push(filePath);
            }
          }
        } catch (error) {
          console.error(`Error reading file ${filePath}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error searching directory ${searchDirectory}:`, error);
  }
  
  return results.length > 0 ? results.join('\n') : 'No results found.';
}
