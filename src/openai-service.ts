import * as vscode from 'vscode';
import * as path from 'path';
import OpenAI from 'openai';
import { getToolDefinitions } from './tools/getTools';

interface ToolCallResult {
  tool_call_id: string;
  output: string;
}

// Properly type the conversation messages to match OpenAI API types
type Role = 'user' | 'assistant' | 'system' | 'tool';

interface ConversationMessage {
  role: Role;
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export class OpenAIService {
  private client!: OpenAI;
  private conversationHistory: ConversationMessage[] = [];
  private maxHistoryLength = 10; // Keep 5 exchanges (5 user + 5 assistant messages)

  constructor() {
    this.initializeClient();
  }

  /**
   * Validates the OpenAI API key and returns an error message if invalid
   */
  public validateApiKey(): { valid: boolean; message?: string } {
    const apiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey');
    
    if (!apiKey || apiKey.trim() === '') {
      return {
        valid: false,
        message: 'OpenAI API key is not configured. Please set it in VS Code settings (File > Preferences > Settings > Extensions > Quest1 Code Assistant).'
      };
    }
    
    // Check if the API key has the correct format (sk-...)
    if (!apiKey.startsWith('sk-')) {
      return {
        valid: false,
        message: 'Invalid OpenAI API key format. API keys should start with "sk-"'
      };
    }
    
    // Check if it's likely a placeholder or demo key
    if (apiKey.includes('your-api-key') || apiKey.includes('example') || apiKey.includes('demo')) {
      return {
        valid: false,
        message: 'You appear to be using a placeholder API key. Please replace it with your actual OpenAI API key.'
      };
    }
    
    return { valid: true };
  }

  private initializeClient() {
    const apiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey');
    
    // Log key validation status (without exposing the key)
    const validation = this.validateApiKey();
    if (!validation.valid) {
      console.warn(`OpenAI API key validation failed: ${validation.message}`);
      // Still initialize with empty string to prevent errors in other methods
    }
    
    this.client = new OpenAI({
      apiKey: apiKey || '',
    });
  }

  /**
   * Add a message to the conversation history, maintaining the maximum history length
   */
  private addToConversationHistory(message: any): void {
    // Ensure the message has the correct structure
    const validMessage: ConversationMessage = {
      role: message.role as Role,
      content: message.content || '',
    };
    
    if (message.tool_calls) {
      validMessage.tool_calls = message.tool_calls;
    }
    
    if (message.tool_call_id) {
      validMessage.tool_call_id = message.tool_call_id;
    }
    
    this.conversationHistory.push(validMessage);
    
    // Ensure we don't exceed the maximum history length
    // We keep maxHistoryLength messages (which corresponds to 5 exchanges)
    if (this.conversationHistory.length > this.maxHistoryLength) {
      // Remove oldest messages to maintain the limit
      const excessMessages = this.conversationHistory.length - this.maxHistoryLength;
      this.conversationHistory = this.conversationHistory.slice(excessMessages);
    }
    
    console.log(`Conversation history updated, now has ${this.conversationHistory.length} messages`);
  }

  public async processQuery(query: string): Promise<string> {
    // Validate the API key
    const validation = this.validateApiKey();
    if (!validation.valid) {
      throw new Error(validation.message);
    }
    
    // Debug workspace access
    const workspaceFolders = vscode.workspace.workspaceFolders;
    console.log('Available workspace folders:', workspaceFolders);
    
    // Add user message to conversation history
    this.addToConversationHistory({ role: 'user', content: query });
    console.log(`Conversation history length: ${this.conversationHistory.length} messages`);
    
    try {
      // Verify the API key again just to be safe
      const validation = this.validateApiKey();
      if (!validation.valid) {
        throw new Error(validation.message || 'Invalid OpenAI API key. Please check your settings.');
      }
      
      // Display a helpful message in the console for debugging
      console.log('API key validation passed, proceeding with OpenAI request');
      
      // Get the current API key
      const currentApiKey = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('openaiApiKey') || '';
      
      // Get the configured model
      const modelName = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('model') || 'gpt-4o';
      console.log(`Using OpenAI model: ${modelName}`);
      
      try {
        // Test connection to OpenAI by making a simple request
        await this.client.models.list();
        console.log('Successfully connected to OpenAI API');
      } catch (testError) {
        console.error('Failed to connect to OpenAI API:', testError);
        if (testError instanceof Error) {
          throw new Error(`OpenAI connection test failed: ${testError.message}`);
        }
        throw new Error('Failed to establish connection with OpenAI');
      }

      // Reinitialize the client with the current API key
      this.client = new OpenAI({
        apiKey: currentApiKey,
      });
      
      console.log(`Processing query with model: ${modelName}`);
      
      // Debug tools being sent
      const toolDefinitions = getToolDefinitions();
      console.log('Sending tools to OpenAI:', JSON.stringify(toolDefinitions, null, 2));
      
      // Use conversation history instead of just the current message
      const messages = [...this.conversationHistory];
      
      // Send request to OpenAI
      console.log('Sending messages to OpenAI:', JSON.stringify(messages, null, 2));
      
      try {
        const response = await this.client.chat.completions.create({
          model: modelName,
          messages: messages as any, // Type assertion to satisfy the API
          tools: toolDefinitions as any,
          tool_choice: 'auto'
        });
        
        console.log('OpenAI response:', JSON.stringify(response.choices[0]?.message, null, 2));
      
      // Handle tool calls if present
      if (response.choices[0]?.message?.tool_calls?.length) {
        // Get tool calls from the response
        const toolCalls = response.choices[0].message.tool_calls;
        console.log(`Received ${toolCalls.length} tool calls`);
        
        // Add the assistant's response (with tool calls) to conversation history
        if (response.choices[0].message) {
          this.addToConversationHistory({
            role: 'assistant',
            content: response.choices[0].message.content || '',
            tool_calls: response.choices[0].message.tool_calls
          });
        }
        
        // Execute each tool and collect results
        const toolResults: ToolCallResult[] = [];
        
        for (const toolCall of toolCalls) {
          const toolCallId = toolCall.id;
          const functionName = toolCall.function.name;
          let functionArgs;
          
          try {
            functionArgs = JSON.parse(toolCall.function.arguments);
          } catch (error) {
            console.error(`Error parsing arguments for tool ${functionName}:`, error);
            toolResults.push({
              tool_call_id: toolCallId,
              output: `Error parsing arguments: ${error}`
            });
            continue;
          }
          
          let output: string;
          
          try {
            // Execute the tool based on function name
            switch (functionName) {
              case 'find_by_name':
                output = await this.executeFindByName(functionArgs);
                break;
                
              case 'list_dir':
                output = await this.executeListDir(functionArgs);
                break;
                
              case 'view_file':
                output = await this.executeViewFile(functionArgs);
                break;
                
              case 'grep_search':
                output = await this.executeGrepSearch(functionArgs);
                break;
                
              // Add other tool implementations here
              
              default:
                output = `Tool ${functionName} is not implemented yet.`;
                console.log(`Tool ${functionName} is not implemented yet.`);
                break;
            }
            
            toolResults.push({
              tool_call_id: toolCallId,
              output
            });
          } catch (error) {
            console.error(`Error executing tool ${functionName}:`, error);
            toolResults.push({
              tool_call_id: toolCallId,
              output: `Error executing tool: ${error}`
            });
          }
        }
        
        // Add tool results to messages and conversation history
        // Copy all messages up to and including the assistant message with tool calls
        const messagesWithTools = [...this.conversationHistory];
        
        // Verify that the last message has tool_calls before adding tool responses
        const lastMessage = messagesWithTools[messagesWithTools.length - 1];
        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.tool_calls) {
          // We have a valid tool call message, so we can add tool responses
          for (const result of toolResults) {
            const toolMessage = {
              role: 'tool' as Role,
              tool_call_id: result.tool_call_id,
              content: result.output
            };
            messagesWithTools.push(toolMessage);
            this.addToConversationHistory(toolMessage);
          }
        } else {
          // There is a mismatch in the message structure
          console.error('Cannot add tool messages because the last message does not contain tool_calls');
          
          // Create a fixed conversation without tools for recovery
          const userMessages = messages.filter(msg => msg.role === 'user');
          const lastUserMessage = userMessages[userMessages.length - 1];
          
          // Just use the last user message to avoid the broken state
          if (lastUserMessage) {
            // Reset to just the user's last question
            return await this.processQuerySimple(lastUserMessage.content || '');
          }
        }
        
        // Get final response with tool outputs
        const finalResponse = await this.client.chat.completions.create({
          model: modelName,
          messages: messagesWithTools as any
        });
        
        const finalContent = finalResponse.choices[0]?.message?.content || 'No response from assistant';
        
        // Add the final assistant response to conversation history
        this.addToConversationHistory({
          role: 'assistant',
          content: finalContent
        });
        
        return finalContent;
      } else {
        // No tool calls, just return the content directly
        const content = response.choices[0]?.message?.content || 'No response from assistant';
        
        // Add the assistant's response to conversation history
        this.addToConversationHistory({
          role: 'assistant',
          content: content
        });
        
        return content;
      }
      } catch (apiError) {
        console.error('OpenAI API call failed:', apiError);
        if (apiError instanceof Error) {
          // Check for common OpenAI API errors
          const errorMsg = apiError.message.toLowerCase();
          if (errorMsg.includes('authentication')) {
            throw new Error('Authentication failed. Please check your OpenAI API key.');
          } else if (errorMsg.includes('rate limit')) {
            throw new Error('OpenAI rate limit exceeded. Please try again later.');
          } else if (errorMsg.includes('invalid api key')) {
            throw new Error('Invalid API key provided. Please check your settings.');
          } else {
            throw new Error(`OpenAI API error: ${apiError.message}`);
          }
        } else {
          throw new Error('Unknown error occurred when calling OpenAI API');
        }
      }
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      
      // Provide more specific error messages based on common API issues
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('api key')) {
          throw new Error('Invalid OpenAI API key. Please update your API key in VS Code settings.');
        } else if (errorMessage.includes('rate limit')) {
          throw new Error('OpenAI API rate limit exceeded. Please try again in a few moments.');
        } else if (errorMessage.includes('timeout') || errorMessage.includes('econnreset')) {
          throw new Error('Connection to OpenAI API timed out. Please check your internet connection and try again.');
        } else if (errorMessage.includes('model') && errorMessage.includes('not found')) {
          throw new Error(`Model not found. Please check if '${vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('model') || 'gpt-4o'}' is available for your account.`);
        } else {
          throw new Error(`OpenAI API error: ${error.message}`);
        }
      } else {
        throw new Error('Unknown error when calling OpenAI API. Please check your connection and API key.');
      }
    }
  }
  
  /**
   * Simplified version of processQuery that doesn't use tools
   * This is used as a fallback when there's an issue with the tool-based flow
   */
  private async processQuerySimple(query: string): Promise<string> {
    try {
      // Get the model name
      const modelName = vscode.workspace.getConfiguration('quest1CodeAssistant').get<string>('model') || 'gpt-4o';
      console.log(`Using OpenAI model (simple mode): ${modelName}`);
      
      // Just create a simple message array with only the user's query
      const messages = [
        {
          role: 'user' as Role,
          content: query
        }
      ];
      
      // Send a basic request without tools
      const response = await this.client.chat.completions.create({
        model: modelName,
        messages: messages as any
      });
      
      // Get the response content
      const content = response.choices[0]?.message?.content || 'No response from assistant';
      return content;
    } catch (error) {
      console.error('Error in simplified query processing:', error);
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      } else {
        return 'Unknown error occurred';
      }
    }
  }
  
  private async executeFindByName(args: any): Promise<string> {
    try {
      console.log('Executing find_by_name with args:', JSON.stringify(args, null, 2));
      
      // Get current workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        return 'Error: No workspace folder is open';
      }
      
      // Use workspace folder if SearchDirectory is not provided or is invalid
      const searchDir = args.SearchDirectory || workspaceFolder;
      console.log(`Using search directory: ${searchDir}`);
      
      try {
        // Simple implementation to list files
        const files = await vscode.workspace.findFiles(
          args.Pattern ? `**/${args.Pattern}` : '**/*', 
          undefined,
          args.MaxDepth || undefined
        );
        
        const results = files.map(file => ({
          path: vscode.workspace.asRelativePath(file),
          name: path.basename(file.fsPath),
          isDirectory: false,
          type: 'file'
        }));
        
        console.log('Find by name results:', results.length);
        return JSON.stringify(results, null, 2);
      } catch (err) {
        console.error('VS Code find files error:', err);
        return `Error finding files: ${err}`;
      }
    } catch (error) {
      console.error('Error executing find_by_name:', error);
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      } else {
        return 'Unknown error occurred while executing find_by_name';
      }
    }
  }
  
  private async executeListDir(args: any): Promise<string> {
    try {
      console.log('Executing list_dir with args:', JSON.stringify(args, null, 2));
      
      // Get current workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        return 'Error: No workspace folder is open';
      }
      
      let directoryPath = args.DirectoryPath;
      if (!path.isAbsolute(directoryPath)) {
        directoryPath = path.join(workspaceFolder, directoryPath);
      }
      
      try {
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(directoryPath, '*'),
          undefined
        );
        
        const results = files.map(file => ({
          path: vscode.workspace.asRelativePath(file),
          name: path.basename(file.fsPath),
          isDirectory: false, // We can't easily determine this without additional fs calls
          type: 'file'
        }));
        
        return JSON.stringify(results, null, 2);
      } catch (err) {
        console.error('VS Code list dir error:', err);
        return `Error listing directory: ${err}`;
      }
    } catch (error) {
      console.error('Error executing list_dir:', error);
      return `Error: ${error}`;
    }
  }
  
  private async executeViewFile(args: any): Promise<string> {
    try {
      console.log('Executing view_file with args:', JSON.stringify(args, null, 2));
      
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        return 'Error: No workspace folder is open';
      }
      
      let filePath = args.AbsolutePath;
      if (!path.isAbsolute(filePath)) {
        filePath = path.join(workspaceFolder, filePath);
      }
      
      try {
        const document = await vscode.workspace.openTextDocument(filePath);
        const content = document.getText();
        const lines = content.split('\n');
        
        const startLine = Math.max(0, args.StartLine || 0);
        const endLine = Math.min(lines.length - 1, args.EndLine || lines.length - 1);
        
        const selectedContent = lines.slice(startLine, endLine + 1).join('\n');
        return selectedContent;
      } catch (err) {
        console.error('VS Code view file error:', err);
        return `Error viewing file: ${err}`;
      }
    } catch (error) {
      console.error('Error executing view_file:', error);
      return `Error: ${error}`;
    }
  }
  
  private async executeGrepSearch(args: any): Promise<string> {
    try {
      console.log('Executing grep_search with args:', JSON.stringify(args, null, 2));
      
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        return 'Error: No workspace folder is open';
      }
      
      try {
        // Use VS Code search API
        const searchResults = await vscode.workspace.findFiles(
          args.Includes?.length ? `**/{${args.Includes.join(',')}}` : '**/*',
          undefined
        );
        
        let allResults: string[] = [];
        
        for (const file of searchResults) {
          try {
            const document = await vscode.workspace.openTextDocument(file);
            const content = document.getText();
            
            if (content.includes(args.Query)) {
              if (args.MatchPerLine) {
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].includes(args.Query)) {
                    allResults.push(`${vscode.workspace.asRelativePath(file)}:${i+1}: ${lines[i]}`);
                  }
                }
              } else {
                allResults.push(vscode.workspace.asRelativePath(file));
              }
            }
          } catch (err) {
            console.error(`Error searching file ${file.fsPath}:`, err);
          }
        }
        
        return allResults.join('\n');
      } catch (err) {
        console.error('VS Code grep search error:', err);
        return `Error searching: ${err}`;
      }
    } catch (error) {
      console.error('Error executing grep_search:', error);
      return `Error: ${error}`;
    }
  }
}
