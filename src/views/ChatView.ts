import * as vscode from 'vscode';
import { OpenAIService } from '../openai-service';

export class ChatView {
  public static currentPanel: ChatView | undefined;
  
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly openAIService: OpenAIService;
  private disposables: vscode.Disposable[] = [];
  private messageHistory: { role: string, content: string }[] = [];

  public static createOrShow(extensionUri: vscode.Uri, openAIService: OpenAIService) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (ChatView.currentPanel) {
      ChatView.currentPanel.panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'quest1ChatPanel',
      'Quest1 Code Assistant',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    ChatView.currentPanel = new ChatView(panel, extensionUri, openAIService);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, openAIService: OpenAIService) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.openAIService = openAIService;

    // Set the webview's initial html content
    this.updateWebview();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        console.log('Received message from webview:', message);
        
        switch (message.command) {
          case 'sendMessage':
            await this.handleUserMessage(message.text);
            break;
            
          case 'clearChat':
            this.messageHistory = [];
            this.updateWebview();
            break;
        }
      },
      null,
      this.disposables
    );
  }

  private async handleUserMessage(text: string) {
    try {
      // Verify API key before processing
      const apiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey');
      if (!apiKey || apiKey.trim() === '') {
        throw new Error('OpenAI API key not configured. Please set it in the extension settings.');
      }
      
      // Add user message to history
      this.messageHistory.push({ role: 'user', content: text });
      this.updateWebview();
      
      // Show the loading indicator
      this.panel.webview.postMessage({ command: 'showProcessing' });

      try {
        // Process with OpenAI
        console.log('Sending query to OpenAI service:', text.substring(0, 30) + '...');
        const response = await this.openAIService.processQuery(text);
        console.log('Received response from OpenAI service');
        
        // Add assistant response to history
        this.messageHistory.push({ role: 'assistant', content: response });
      } finally {
        // Hide the loading indicator regardless of success or failure
        this.panel.webview.postMessage({ command: 'hideProcessing' });
      }
      
      // Update the webview with the new message history
      this.updateWebview();
    } catch (error) {
      console.error('Error processing user message:', error);
      
      // Create a more specific error message
      let errorMessage = 'Sorry, I encountered an error while processing your request.';
      
      if (error instanceof Error) {
        // Check for common API errors
        if (error.message.includes('API key')) {
          errorMessage = 'Error: OpenAI API key is invalid or not configured properly. Please update your API key in VS Code settings (Extensions → Quest1 Code Assistant → OpenAI API Key).';
        } else if (error.message.includes('rate limit')) {
          errorMessage = 'Error: OpenAI API rate limit exceeded. Please try again in a few moments.';
        } else if (error.message.includes('timeout') || error.message.includes('network')) {
          errorMessage = 'Error: Connection to OpenAI API timed out. Please check your internet connection and try again.';
        } else {
          // Include the actual error message for better debugging
          errorMessage = `Error: ${error.message}`;
        }
      }
      
      // Add error message to history
      this.messageHistory.push({ 
        role: 'assistant', 
        content: errorMessage
      });
      this.updateWebview();
    }
  }

  private updateWebview() {
    this.panel.webview.html = this.getHtmlForWebview();
  }

  private getHtmlForWebview() {
    // Generate a nonce to use in the CSP
    const nonce = this.getNonce();

    // Convert message history to HTML
    const messageHtml = this.messageHistory.map(msg => {
      const isUser = msg.role === 'user';
      const messageClass = isUser ? 'user-message' : 'assistant-message';
      const avatarLabel = isUser ? 'You' : 'AI';
      const formattedContent = this.formatMessageContent(msg.content);
      
      return `
        <div class="message ${messageClass}">
          <div class="avatar">${avatarLabel}</div>
          <div class="content">${formattedContent}</div>
        </div>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <title>Quest1 Code Assistant</title>
        <style>
          body {
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
          }
          
          .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
          }
          
          .header {
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          
          .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
          }
          
          .message {
            display: flex;
            margin-bottom: 12px;
            max-width: 90%;
          }
          
          .user-message {
            margin-left: auto;
            flex-direction: row-reverse;
          }
          
          .avatar {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 8px;
            flex-shrink: 0;
            font-size: 10px;
          }
          
          .content {
            padding: 8px 12px;
            border-radius: 8px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            overflow-wrap: break-word;
          }
          
          .user-message .content {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          
          .input-container {
            display: flex;
            padding: 10px;
            border-top: 1px solid var(--vscode-panel-border);
          }
          
          textarea {
            flex: 1;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            resize: none;
            outline: none;
            min-height: 60px;
            font-family: var(--vscode-font-family);
          }
          
          button {
            margin-left: 8px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 0 16px;
            border-radius: 2px;
            cursor: pointer;
          }
          
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          
          .actions {
            display: flex;
            justify-content: flex-end;
            padding: 8px;
          }
          
          code {
            font-family: var(--vscode-editor-font-family);
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
          }
          
          pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
          }
          
          /* Processing indicator styles */
          .processing-indicator {
            display: none;
            margin: 10px 0;
            text-align: center;
            padding: 10px;
            background: var(--vscode-editor-background);
            border-radius: 8px;
            border: 1px solid var(--vscode-panel-border);
          }
          
          .processing-indicator.active {
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .spinner {
            width: 24px;
            height: 24px;
            border: 3px solid var(--vscode-button-background);
            border-radius: 50%;
            border-top-color: transparent;
            animation: spin 1s linear infinite;
            margin-right: 10px;
          }
          
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Quest1 Code Assistant</h2>
            <div class="actions">
              <button id="clearChat">Clear Chat</button>
            </div>
          </div>
          
          <div class="messages-container" id="messages">
            ${messageHtml.length ? messageHtml : '<div class="welcome-message">Start a conversation by typing your coding question below.</div>'}
            
            <!-- Processing indicator -->
            <div class="processing-indicator" id="processingIndicator">
              <div class="spinner"></div>
              <div>Processing your request...</div>
            </div>
          </div>
          
          <div class="input-container">
            <textarea id="userInput" placeholder="Type your message here..." rows="3"></textarea>
            <button id="sendButton">Send</button>
          </div>
        </div>
        
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const messagesContainer = document.getElementById('messages');
          const userInput = document.getElementById('userInput');
          const sendButton = document.getElementById('sendButton');
          const clearButton = document.getElementById('clearChat');
          
          // Scroll to bottom of messages
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
          
          // Send message when Send button is clicked
          sendButton.addEventListener('click', sendMessage);
          
          // Send message when Enter key is pressed (without Shift)
          userInput.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          });
          
          // Clear chat history
          clearButton.addEventListener('click', () => {
            vscode.postMessage({
              command: 'clearChat'
            });
          });
          
          // Handle messages from extension
          window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
              case 'showProcessing':
                document.getElementById('processingIndicator').classList.add('active');
                // Scroll to show the processing indicator
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                // Disable the input and send button during processing
                userInput.disabled = true;
                sendButton.disabled = true;
                break;
                
              case 'hideProcessing':
                document.getElementById('processingIndicator').classList.remove('active');
                // Re-enable the input and send button
                userInput.disabled = false;
                sendButton.disabled = false;
                break;
            }
          });
          
          function sendMessage() {
            const text = userInput.value.trim();
            if (text) {
              vscode.postMessage({
                command: 'sendMessage',
                text: text
              });
              userInput.value = '';
            }
          }
        </script>
      </body>
      </html>
    `;
  }

  private formatMessageContent(content: string): string {
    // Replace newlines with <br>
    content = content.replace(/\n/g, '<br>');
    
    // Format code blocks with ```
    content = content.replace(/```([^`]*)```/g, (_unused, code) => {
      return `<pre>${this.escapeHtml(code.trim())}</pre>`;
    });
    
    // Format inline code with `
    content = content.replace(/`([^`]*)`/g, (_unused, code) => {
      return `<code>${this.escapeHtml(code)}</code>`;
    });
    
    return content;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  public dispose() {
    ChatView.currentPanel = undefined;

    // Clean up our resources
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
