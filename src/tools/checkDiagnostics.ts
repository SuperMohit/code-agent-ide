import * as vscode from 'vscode';

/**
 * Check for diagnostic issues in all files
 * @returns String with diagnostic information for the entire workspace.
 */
export async function checkDiagnostics(): Promise<string> {
  // Wait a short time for language servers to update diagnostics.
  await new Promise(resolve => setTimeout(resolve, 500));

  // Retrieve all diagnostic entries from VS Code.
  const allDiagnostics = vscode.languages.getDiagnostics();
  let diagnosticsReport = '';

  // Loop through each file's diagnostics.
  allDiagnostics.forEach(([uri, diagnostics]) => {
    if (diagnostics.length > 0) {
      diagnosticsReport += `File: ${uri.fsPath}\n`;
      diagnostics.forEach((diag) => {
        // Convert the severity enum to its string representation.
        const severity = vscode.DiagnosticSeverity[diag.severity];
        // Adjust line number to 1-based for human readability.
        diagnosticsReport += `  ${severity} (line ${diag.range.start.line + 1}): ${diag.message}\n`;
      });
      diagnosticsReport += '\n';
    }
  });

  return diagnosticsReport || 'No diagnostics found.';
}

