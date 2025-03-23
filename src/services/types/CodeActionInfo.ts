import * as vscode from 'vscode';

/**
 * Information about a code action provided by the language server
 */
export interface CodeActionInfo {
  title: string;
  kind: string;
  edit?: {
    changes: Record<string, {
      range: {
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
      };
      newText: string;
    }[]>;
  };
  isPreferred: boolean;
  source?: string;
}
