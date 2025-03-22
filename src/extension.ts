import * as vscode from 'vscode';
import { ChatViewProvider } from './views/ChatViewProvider';
import { ChatView } from './views/ChatView';
import { OpenAIService } from './openai-service';

export function activate(context: vscode.ExtensionContext) {
  console.log('Activating Quest1 Code Assistant extension');
  
  // Initialize OpenAI service
  const openAIService = new OpenAIService();
  
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
  
  console.log('Extension activation complete');
}

export function deactivate() {
  // Clean up resources
  if (ChatView.currentPanel) {
    ChatView.currentPanel.dispose();
  }
}
