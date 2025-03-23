import * as vscode from 'vscode';
import { ToolDefinition } from '../types/ToolDefinition';

/**
 * Definition for the 'done' tool that signals completion of a task
 */
export const doneToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'done',
    description: 'Signal that you have completed the task and want to exit the agentic loop',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'A brief summary of what was accomplished'
        }
      },
      required: ['summary']
    }
  }
};

/**
 * Execute the 'done' tool
 * @param args The arguments for the done tool
 * @returns A message indicating the task is complete
 */
export const executeDone = async (args: { summary: string }): Promise<string> => {
  console.log('Done tool called with summary:', args.summary);
  return `Task completed: ${args.summary}`;
};
