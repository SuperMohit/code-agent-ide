import * as vscode from 'vscode';
import { OpenAIService } from '../openai-service';
import * as MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

export class ChatView {
  public static currentPanel: ChatView | undefined;
  
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly openAIService: OpenAIService;
  private disposables: vscode.Disposable[] = [];
  private messageHistory: { role: string, content: string, id?: string }[] = [];
  private contextFiles: string[] = []; // Track files used for context

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

    // Subscribe to context file updates
    this.openAIService.onDidUpdateContextFiles(files => {
      this.contextFiles = files;
      this.updateContextFilesView();
    });

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
      
      try {
        // Process with OpenAI (non-streaming only)
        console.log('Sending query to OpenAI service:', text.substring(0, 30) + '...');
        
        // Show the loading indicator
        this.panel.webview.postMessage({ command: 'showProcessing' });
        
        // Always use non-streaming approach
        const response = await this.openAIService.processQuery(text);
        console.log('Received response from OpenAI service');
        
        // Add assistant response to history
        this.messageHistory.push({ role: 'assistant', content: response });
        
        // Hide the loading indicator
        this.panel.webview.postMessage({ command: 'hideProcessing' });
      } catch (error) {
        // Hide any indicators
        this.panel.webview.postMessage({ command: 'hideProcessing' });
        this.panel.webview.postMessage({ command: 'endStreaming' });
        throw error; // Rethrow to be caught by outer catch block
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
  
  /**
   * Update the context files view in the webview
   */
  private updateContextFilesView() {
    // Send the updated context files to the webview
    this.panel.webview.postMessage({
      command: 'updateContextFiles',
      files: this.contextFiles
    });
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
      
      // Include data-id attribute if the message has an ID (for streaming)
      const dataIdAttr = msg.id ? ` data-id="${msg.id}"` : '';
      
      return `
        <div class="message ${messageClass}"${dataIdAttr}>
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
          
          /* Context files panel */
          .context-files {
            padding: 8px 16px;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 12px;
          }
          
          /* Collapsible panel styles */
          .context-files-content {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.2s ease-out;
          }
          
          .context-files-content.expanded {
            max-height: 200px;
          }
          
          .context-files-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: bold;
            color: var(--vscode-foreground);
            cursor: pointer;
          }
          
          .context-files-header:hover {
            color: var(--vscode-textLink-foreground);
          }
          
          .context-files-toggle {
            margin-right: 4px;
          }
          
          .context-files-list {
            max-height: 100px;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family);
          }
          
          .context-file-item {
            display: flex;
            align-items: center;
            padding: 2px 0;
          }
          
          .context-file-icon {
            margin-right: 5px;
          }
          
          .context-file-path {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          
          .context-files-empty {
            font-style: italic;
            color: var(--vscode-disabledForeground);
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
            margin: 8px 0;
          }
          
          /* Tree view styling */
          pre.tree-view {
            font-family: monospace;
            white-space: pre;
            line-height: 1.3;
            overflow-x: auto;
          }
          
          pre.tree-view strong {
            color: var(--vscode-textLink-foreground);
            font-weight: bold;
          }
          
          /* Markdown styling */
          h1, h2, h3, h4, h5, h6 {
            margin-top: 16px;
            margin-bottom: 8px;
            color: var(--vscode-editor-foreground);
          }
          
          p {
            margin-top: 8px;
            margin-bottom: 8px;
          }
          
          ul, ol {
            margin-top: 8px;
            margin-bottom: 8px;
            padding-left: 20px;
          }
          
          blockquote {
            border-left: 3px solid var(--vscode-activityBarBadge-background);
            margin: 8px 0;
            padding-left: 16px;
            color: var(--vscode-descriptionForeground);
          }
          
          a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
          }
          
          a:hover {
            text-decoration: underline;
          }
          
          /* Streaming cursor styles */
          .streaming-cursor {
            display: inline-block;
            animation: blink 1s infinite;
            margin-left: 2px;
            color: var(--vscode-editor-foreground);
          }
          
          @keyframes blink {
            0% { opacity: 1; }
            50% { opacity: 0; }
            100% { opacity: 1; }
          }
          
          /* Syntax highlighting styles */
          .hljs {
            display: block;
            overflow-x: auto;
            color: var(--vscode-editor-foreground);
          }
          
          .hljs-keyword,
          .hljs-selector-tag,
          .hljs-literal,
          .hljs-section,
          .hljs-link {
            color: #569CD6;
          }
          
          .hljs-function {
            color: #DCDCAA;
          }
          
          .hljs-string,
          .hljs-attr,
          .hljs-regexp,
          .hljs-number {
            color: #CE9178;
          }
          
          .hljs-built_in,
          .hljs-builtin-name {
            color: #4EC9B0;
          }
          
          .hljs-comment,
          .hljs-quote {
            color: #6A9955;
            font-style: italic;
          }
          
          .hljs-variable,
          .hljs-template-variable {
            color: #9CDCFE;
          }
          
          .hljs-title,
          .hljs-name,
          .hljs-type {
            color: #4EC9B0;
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
          <div class="context-files" id="contextFiles">
            <div class="context-files-header" id="contextFilesHeader">
              <div>
                <span class="context-files-toggle">▶</span>
                <span>Context Files</span>
              </div>
              <span id="contextFileCount">(0)</span>
            </div>
            <div class="context-files-content" id="contextFilesContent">
              <div class="context-files-list" id="contextFilesList">
                <div class="context-files-empty">No files used for context yet</div>
              </div>
            </div>
          </div>
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
          
          // Toggle context files panel
          document.getElementById('contextFilesHeader').addEventListener('click', function() {
            const content = document.getElementById('contextFilesContent');
            const toggle = this.querySelector('.context-files-toggle');
            
            if (content.classList.contains('expanded')) {
              content.classList.remove('expanded');
              toggle.textContent = '▶';
            } else {
              content.classList.add('expanded');
              toggle.textContent = '▼';
            }
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
              
              case 'startStreaming':
                // Start a streaming assistant message, creating an element with the specified ID
                userInput.disabled = true;
                sendButton.disabled = true;
                
                // We don't need to create a new element here as the message is already created
                // in the HTML by the server-side code, but we need to identify it
                if (message.id) {
                  // Find the last assistant message which should have the ID
                  const streamingMessage = document.querySelector('.message[data-id="' + message.id + '"] .content');
                  if (streamingMessage) {
                    // Create and append a cursor to indicate streaming
                    const cursor = document.createElement('span');
                    cursor.className = 'streaming-cursor';
                    cursor.textContent = '▌';
                    streamingMessage.appendChild(cursor);
                  }
                }
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                break;
                
              case 'updateStreamingContent':
                // Update the content of a streaming message
                console.log('%c[WebView] updateStreamingContent received', 'color: green; font-weight: bold');
                console.log('Message ID:', message.id, 'Content length:', message.content ? message.content.length : 0);
                console.log('Content preview:', message.content ? message.content.substring(0, 50) + '...' : 'none');
                
                if (message.id && message.content) {
                  // Dump all messages for debugging
                  console.log('All message elements:');
                  document.querySelectorAll('.message').forEach(function(el, idx) {
                    console.log('- Message ' + idx + ':', el.getAttribute('data-id') || 'no data-id');
                  });
                  
                  // Find the streaming message element
                  const streamingMessage = document.querySelector('.message[data-id="' + message.id + '"] .content');
                  console.log('Found streaming message element:', streamingMessage ? 'YES' : 'NO');
                  
                  if (streamingMessage) {
                    // Enhanced approach for handling streaming content
                    console.log('[STREAMING] Received chunk, content length:', message.content.length);
                    
                    // Special handling for tree_view content
                    const plainContent = message.content;
                    let isTreeViewContent = false;
                    
                    // Check if content appears to be a tree structure (contains directory tree formatting)
                    if (plainContent.includes('───') || 
                        plainContent.includes('└──') || 
                        plainContent.includes('├──') || 
                        (plainContent.includes('/') && plainContent.includes('directories') && plainContent.includes('files'))) {
                      isTreeViewContent = true;
                      console.log('[STREAMING] Detected tree view content');
                    }
                    
                    // Configure markdown-it with appropriate options
                    const md = new markdownit({
                      highlight: highlightCode,
                      breaks: true,
                      linkify: true,
                      html: true
                    });
                    
                    // Add special handlers for markdown-it
                    md.use((md) => {
                      // Store the original code block renderer
                      const defaultRender = md.renderer.rules.code_block || function(tokens, idx, options, env, self) {
                        return self.renderToken(tokens, idx, options);
                      };
                      
                      // Enhanced code block rendering
                      md.renderer.rules.code_block = function(tokens, idx, options, env, self) {
                        console.log('[MARKDOWN] Processing code block');
                        return defaultRender(tokens, idx, options, env, self);
                      };
                    });
                    
                    // Process content based on its type
                    let htmlContent = '';
                    
                    if (isTreeViewContent) {
                      // Special handling for tree view content
                      console.log('[STREAMING] Processing tree view content specially');
                      
                      // Wrap the tree view in a pre tag for proper formatting
                      htmlContent = '<pre class="tree-view">' + 
                        plainContent
                          .replace(/&/g, '&amp;')
                          .replace(/</g, '&lt;')
                          .replace(/>/g, '&gt;')
                          .replace(/"/g, '&quot;')
                          .replace(/'/g, '&#039;')
                          // Optional: highlight directory names
                          .replace(/([^\s]+)\//g, '<strong>$1/</strong>')
                        + '</pre>';
                    } else {
                      // Standard markdown rendering for non-tree content
                      htmlContent = md.render(plainContent);
                    }
                    
                    console.log('[STREAMING] Rendered HTML content length:', htmlContent.length);
                    
                    // Update the content but keep the cursor
                    streamingMessage.innerHTML = htmlContent;
                    console.log('innerHTML updated with new content');
                    
                    // Re-add the cursor
                    const cursor = document.createElement('span');
                    cursor.className = 'streaming-cursor';
                    cursor.textContent = '▌';
                    streamingMessage.appendChild(cursor);
                    console.log('Cursor added to content');
                    
                    // Scroll to the bottom to follow the new content
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                  } else {
                    console.error('%c[ERROR] Could not find streaming message element with ID: ' + message.id, 'color: red; font-weight: bold');
                    console.log('DOM structure:');
                    console.log(document.body.innerHTML);
                    
                    // Try a more general selector to see if the element exists but with different attributes
                    const allMessages = document.querySelectorAll('.message');
                    console.log('Found ' + allMessages.length + ' message elements:');
                    allMessages.forEach(function(el, idx) {
                      console.log('Message ' + idx + ':', {
                        'data-id': el.getAttribute('data-id'),
                        'class': el.className,
                        'innerHTML': el.innerHTML.substring(0, 50) + '...'
                      });
                    });
                  }
                } else {
                  console.error('Missing required data in updateStreamingContent:', { id: message.id, hasContent: !!message.content });
                }
                break;
                
              case 'endStreaming':
                // End streaming and finalize the message
                userInput.disabled = false;
                sendButton.disabled = false;
                
                // Remove any streaming cursors
                const cursors = document.querySelectorAll('.streaming-cursor');
                cursors.forEach(cursor => cursor.remove());
                
                // If we have a specific message ID, make sure that one is cleaned up
                if (message.id) {
                  const streamingMessage = document.querySelector('.message[data-id="' + message.id + '"] .content');
                  if (streamingMessage) {
                    // Remove any cursors from this specific message
                    const messageCursors = streamingMessage.querySelectorAll('.streaming-cursor');
                    messageCursors.forEach(cursor => cursor.remove());
                  }
                }
                break;
                
              case 'updateContextFiles':
                updateContextFiles(message.files);
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
          
          // Update the context files panel
          function updateContextFiles(files) {
            const contextFilesList = document.getElementById('contextFilesList');
            const contextFileCount = document.getElementById('contextFileCount');
            
            // Update the file count
            contextFileCount.textContent = '(' + files.length + ')';
            
            // If no files, show empty message
            if (files.length === 0) {
              contextFilesList.innerHTML = '<div class="context-files-empty">No files used for context yet</div>';
              return;
            }
            
            // Build the list of files
            let html = '';
            files.forEach(function(file) {
              // Get just the filename from the path
              const fileName = file.split('/').pop();
              html += '\
                <div class="context-file-item">\
                  <span class="context-file-icon">📄</span>\
                  <span class="context-file-path" title="' + file + '">' + fileName + '</span>\
                </div>\
              ';
            });
            
            contextFilesList.innerHTML = html;
          }
        </script>
      </body>
      </html>
    `;
  }

  private formatMessageContent(content: string): string {
    // Initialize markdown-it with highlight.js for syntax highlighting
    const md = new MarkdownIt({
      html: false,         // Disable HTML tags in source
      xhtmlOut: false,    // Use '/' to close single tags (<br />)
      breaks: true,       // Convert '\n' in paragraphs into <br>
      linkify: true,      // Auto-convert URLs to links
      typographer: true,  // Enable smartypants and other substitutions
      highlight: (str, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return '<pre class="hljs"><code>' + 
                   hljs.highlight(str, { language: lang, ignoreIllegals: true }).value + 
                   '</code></pre>';
          } catch (error) {
            console.error('Error highlighting code:', error);
          }
        }
        // Use generic highlighter if language isn't specified or found
        return '<pre class="hljs"><code>' + 
               hljs.highlightAuto(str).value + 
               '</code></pre>';
      }
    });
    
    return md.render(content);
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
