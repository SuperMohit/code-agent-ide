import * as vscode from 'vscode';

/**
 * Type information for a symbol
 */
export interface SymbolInfo {
  name: string;
  kind: vscode.SymbolKind;
  detail?: string;
  filePath: string;
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
  children?: SymbolInfo[];
}
