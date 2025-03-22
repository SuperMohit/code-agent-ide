import * as fs from 'fs';

export async function viewFile(absolutePath: string, startLine: number, endLine: number): Promise<string> {
  try {
    if (!fs.existsSync(absolutePath)) {
      return `File not found: ${absolutePath}`;
    }
    
    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split('\n');
    
    if (startLine < 0) startLine = 0;
    if (endLine >= lines.length) endLine = lines.length - 1;
    
    const selectedLines = lines.slice(startLine, endLine + 1);
    return `File: ${absolutePath} (Lines ${startLine}-${endLine})\n\`\`\`\n${selectedLines.join('\n')}\n\`\`\``;
  } catch (error: any) {
    console.error(`Error viewing file ${absolutePath}:`, error);
    return `Error: ${error.message}`;
  }
}
