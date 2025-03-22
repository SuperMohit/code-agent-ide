import * as fs from 'fs';

export async function viewCodeItem(file: string, nodePath: string): Promise<string> {
  try {
    if (!fs.existsSync(file)) {
      return `File not found: ${file}`;
    }
    
    const content = fs.readFileSync(file, 'utf8');
    
    // This is a very simplified implementation that just searches for function or class declarations
    // A real implementation would use a proper parser for the specific language
    const nodePathParts = nodePath.split('.');
    const nodeName = nodePathParts[nodePathParts.length - 1];
    
    // Look for common patterns like "function nodeName", "class nodeName", "const nodeName ="
    const patterns = [
      `function\\s+${nodeName}\\s*\\([^)]*\\)\\s*{[\\s\\S]*?}`,
      `class\\s+${nodeName}\\s*{[\\s\\S]*?}`,
      `class\\s+${nodeName}\\s+extends[\\s\\S]*?{[\\s\\S]*?}`,
      `const\\s+${nodeName}\\s*=[\\s\\S]*?;`,
      `let\\s+${nodeName}\\s*=[\\s\\S]*?;`,
      `var\\s+${nodeName}\\s*=[\\s\\S]*?;`,
      `${nodeName}\\s*:\\s*function[\\s\\S]*?`
    ];
    
    for (const pattern of patterns) {
      const regex = new RegExp(pattern, 'g');
      const match = regex.exec(content);
      if (match) {
        return `Code Item: ${nodePath} in ${file}\n\`\`\`\n${match[0]}\n\`\`\``;
      }
    }
    
    return `Code item ${nodePath} not found in ${file}`;
  } catch (error: any) {
    console.error(`Error viewing code item ${nodePath} in ${file}:`, error);
    return `Error: ${error.message}`;
  }
}
