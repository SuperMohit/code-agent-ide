import * as vscode from 'vscode';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { ChatViewProvider } from './views/ChatViewProvider';
import { ChatView } from './views/ChatView';
import { ProjectPathService } from './services/ProjectPathService';
import { OpenAIService } from './openai-service';
import { ServiceFactory } from './services/ServiceFactory';
import { DiagnosticInfo } from './services/DiagnosticsService';


let worker: Worker | undefined

/**
 * Group diagnostics by file path
 */
function groupDiagnosticsByFile(diagnostics: DiagnosticInfo[]): Record<string, DiagnosticInfo[]> {
  const result: Record<string, DiagnosticInfo[]> = {};

  for (const diagnostic of diagnostics) {
    if (!result[diagnostic.filePath]) {
      result[diagnostic.filePath] = [];
    }
    result[diagnostic.filePath].push(diagnostic);
  }

  return result;
}

/**
 * Create a markdown report from diagnostics
 */
function createDiagnosticsReport(errorsByFile: Record<string, DiagnosticInfo[]>): string {
  let report = '# TypeScript Diagnostics Report\n\n';

  // Add summary
  const totalErrors = Object.values(errorsByFile).reduce((sum, errors) => sum + errors.length, 0);
  const totalFiles = Object.keys(errorsByFile).length;
  report += `Found **${totalErrors}** errors across **${totalFiles}** files.\n\n`;

  // Add details for each file
  for (const [filePath, errors] of Object.entries(errorsByFile)) {
    const fileName = filePath.split('/').pop() || filePath;
    report += `## ${fileName}\n\n`;

    errors.forEach((error, index) => {
      const location = `Line ${error.range.startLine + 1}, Column ${error.range.startCharacter + 1}`;
      const codeId = error.code ? ` (${error.code})` : '';

      report += `### Error ${index + 1}${codeId}\n\n`;
      report += `**Location:** ${location}\n\n`;
      report += `**Message:** ${error.message}\n\n`;

      if (error.relatedInformation && error.relatedInformation.length > 0) {
        report += `**Related Information:**\n\n`;
        error.relatedInformation.forEach(info => {
          const relatedFile = info.filePath.split('/').pop() || info.filePath;
          const relatedLocation = `Line ${info.range.startLine + 1}, Column ${info.range.startCharacter + 1}`;
          report += `- ${info.message} (${relatedFile}, ${relatedLocation})\n`;
        });
        report += '\n';
      }
    });

    report += '---\n\n';
  }

  return report;
}



async function startWorker(directoryPath: string) {
  if (worker) {
    worker.terminate();
  }

  try {
    // Get the API key from VS Code settings
    const apiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey');
    if (!apiKey) {
      vscode.window.showErrorMessage('OpenAI API key is not configured. Please set it in VS Code settings.');
      return;
    }

    // Create the worker first
    worker = new Worker(path.join(__dirname, 'worker.js'));

    // Set up message handler
    if (worker) {
      worker.on('message', (event: { success: boolean; error?: string }) => {
        if (event.success) {
          // Now send the directory path
          worker?.postMessage({ type: 'process', data: directoryPath });
        } else {
          vscode.window.showErrorMessage(`Error in worker initialization: ${event.error}`);
        }
      });

      // Set up error handlers
      worker.on('error', (error: unknown) => {
        const errorMessage = error instanceof Error
          ? error.message
          : String(error);
        vscode.window.showErrorMessage(`Worker error: ${errorMessage}`);
      });

      worker.on('exit', (code: number) => {
        if (code !== 0) {
          vscode.window.showErrorMessage(`Worker stopped with exit code ${code}`);
        }
      });

      // Initialize the worker with the API key
      worker.postMessage({ type: 'initialize', data: apiKey });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error
      ? error.message
      : String(error);
    vscode.window.showErrorMessage(`Failed to start worker: ${errorMessage}`);
  }
}



export async function activate(context: vscode.ExtensionContext) {
  console.log('Activating Quest1 Code Assistant extension');

  // Initialize ProjectPathService first
  // This ensures the current project path is available before other services
  const projectPathService = ProjectPathService.getInstance();
  context.subscriptions.push({
    dispose: () => projectPathService.dispose()
  });
  console.log('ProjectPathService initialized');

  // Initialize OpenAI service
  const openAIService = new OpenAIService(projectPathService.getCurrentProjectPath() || '');

  // Register the ChatViewProvider for the sidebar
  const chatViewProvider = new ChatViewProvider(context.extensionUri, openAIService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('quest1ChatView', chatViewProvider)
  );
  console.log('WebviewViewProvider registered successfully');

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('quest1CodeAssistant.open', () => {
      console.log('Command executed: quest1CodeAssistant.open');
      ChatView.createOrShow(context.extensionUri, openAIService);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('quest1CodeAssistant.refresh', () => {
      console.log('Command executed: quest1CodeAssistant.refresh');
      if (ChatView.currentPanel) {
        ChatView.currentPanel.dispose();
      }
      ChatView.createOrShow(context.extensionUri, openAIService);
    })
  );

  // Register command to analyze diagnostics
  context.subscriptions.push(
    vscode.commands.registerCommand('quest1CodeAssistant.analyzeDiagnostics', async () => {
      console.log('Command executed: quest1CodeAssistant.analyzeDiagnostics');

      // Get the diagnostics service
      const diagnosticsService = ServiceFactory.getDiagnosticsService();

      // Get all TypeScript errors
      const tsErrors = diagnosticsService.getTypeScriptDiagnostics()
        .filter(d => d.severity === vscode.DiagnosticSeverity.Error);

      if (tsErrors.length === 0) {
        vscode.window.showInformationMessage('No TypeScript errors found in the workspace.');
        return;
      }

      // Group errors by file
      const errorsByFile = groupDiagnosticsByFile(tsErrors);

      // Create a report
      const report = createDiagnosticsReport(errorsByFile);

      // Show the report in a new untitled document
      const document = await vscode.workspace.openTextDocument({
        content: report,
        language: 'markdown'
      });

      await vscode.window.showTextDocument(document);
    })
  );


  // Start the worker automatically when the extension activates
  const directoryPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.';
  await startWorker(directoryPath);

  console.log('Extension activation complete');
}

export function deactivate() {
  // Clean up resources
  if (ChatView.currentPanel) {
    ChatView.currentPanel.dispose();
  }
}
