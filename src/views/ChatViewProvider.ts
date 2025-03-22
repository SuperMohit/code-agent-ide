import * as vscode from 'vscode';
import { OpenAIService } from '../openai-service';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly openAIService: OpenAIService
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    console.log('Resolving webview view for quest1ChatView');
    
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      console.log('Received message from webview:', message);
      
      switch (message.command) {
        case 'openChatPanel':
          // Open main chat panel when user clicks button in sidebar
          vscode.commands.executeCommand('quest1CodeAssistant.open');
          break;
          
        case 'sendMessage':
          try {
            // Check API key configuration
            const apiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey');
            console.log('Using API key (first few chars):', apiKey?.substring(0, 5) + '...');
            
            if (!apiKey || apiKey.trim() === '') {
              throw new Error('OpenAI API key not configured. Please set it in extension settings.');
            }
            
            // Forward user message to OpenAI service
            console.log('Sending message to OpenAI service:', message.text);
            const response = await this.openAIService.processQuery(message.text);
            console.log('Received response from OpenAI service');
            
            // Send response back to webview
            webviewView.webview.postMessage({ 
              command: 'receiveMessage', 
              text: response 
            });
          } catch (error) {
            console.error('Error processing message:', error);
            let errorMessage = 'An error occurred while processing your request.';
            
            if (error instanceof Error) {
              errorMessage = error.message;
              // Check for common API issues
              if (error.message.includes('API key')) {
                errorMessage = 'Invalid OpenAI API key. Please check your settings in VS Code.';
              } else if (error.message.includes('rate limit')) {
                errorMessage = 'OpenAI API rate limit exceeded. Please try again later.';
              }
            }
            
            webviewView.webview.postMessage({ 
              command: 'error', 
              text: errorMessage
            });
          }
          break;
      }
    });
  }

  private getHtmlForWebview(): string {
    const nonce = this.getNonce();

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <title>Quest1 Chat</title>
        <style>
          body {
            padding: 10px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            display: flex;
            flex-direction: column;
            height: 100vh;
            margin: 0;
          }
          .container {
            display: flex;
            flex-direction: column;
            flex: 1;
            overflow: hidden;
          }
          button {
            margin-top: 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 2px;
            cursor: pointer;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h3>Quest1 Code Assistant</h3>
          <p>AI-powered coding assistant to help with your development tasks.</p>
          <button id="open-chat-button">Open Chat Panel</button>
        </div>
        
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          
          document.getElementById('open-chat-button').addEventListener('click', () => {
            vscode.postMessage({ 
              command: 'openChatPanel'
            });
          });
          
          // Listen for messages from the extension
          window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
              case 'receiveMessage':
                // Handle received message
                console.log('Received response:', message.text);
                break;
                
              case 'error':
                // Handle error
                console.error('Error:', message.text);
                break;
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  private getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
