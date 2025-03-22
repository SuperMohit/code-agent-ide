import * as fs from 'fs';
import * as path from 'path';

export async function listDirectory(directoryPath: string): Promise<string> {
  try {
    const files = fs.readdirSync(directoryPath);
    const results: string[] = [];
    
    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        let childCount = 0;
        try {
          const children = fs.readdirSync(filePath);
          childCount = children.length;
        } catch (error) {
          console.error(`Error counting children in \${filePath}:`, error);
        }
        
        results.push(`D \${file} (\${childCount} children)`);
      } else {
        results.push(`F \${file} (\${stats.size} bytes)`);
      }
    }
    
    return results.length > 0 ? results.join('\n') : 'Directory is empty.';
  } catch (error) {
    console.error(`Error listing directory \${directoryPath}:`, error);
    return `Error: \${error instanceof Error ? error.message : String(error)}`;
  }
}
