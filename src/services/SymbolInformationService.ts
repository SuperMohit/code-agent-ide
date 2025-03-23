import * as vscode from 'vscode';
import { ISymbolInformationService } from './interfaces';
import { SymbolInfo } from './types/SymbolInfo';

/**
 * Service for extracting symbol information from code using the language server
 */
export class SymbolInformationService implements ISymbolInformationService {
  /**
   * Get all symbols in a file
   * @param filePath Path to the file
   * @returns Array of symbols in the file
   */
  public async getSymbolsInFile(filePath: string): Promise<SymbolInfo[]> {
    const uri = vscode.Uri.file(filePath);
    
    // Get document symbols from the language server
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      uri
    );
    
    if (!symbols || symbols.length === 0) {
      return [];
    }
    
    // Convert to our format
    return this.convertDocumentSymbols(symbols, filePath);
  }
  
  /**
   * Get symbol information at a specific position
   * @param filePath Path to the file
   * @param line Line number (0-based)
   * @param character Character position (0-based)
   * @returns Symbol information if found
   */
  public async getSymbolAtPosition(
    filePath: string,
    line: number,
    character: number
  ): Promise<SymbolInfo | undefined> {
    const uri = vscode.Uri.file(filePath);
    const position = new vscode.Position(line, character);
    
    // Get hover information which includes symbol details
    const hoverResults = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      uri,
      position
    );
    
    if (!hoverResults || hoverResults.length === 0) {
      return undefined;
    }
    
    // Try to get symbol at position
    const symbols = await this.getSymbolsInFile(filePath);
    const symbolAtPosition = this.findSymbolAtPosition(symbols, line, character);
    
    if (symbolAtPosition) {
      // Enrich with hover information
      const hoverContent = hoverResults[0].contents
        .map(content => {
          if (content instanceof vscode.MarkdownString) {
            return content.value;
          }
          return content.toString();
        })
        .join('\\n');
      
      return {
        ...symbolAtPosition,
        detail: hoverContent
      };
    }
    
    return undefined;
  }
  
  /**
   * Find all references to a symbol
   * @param filePath Path to the file
   * @param line Line number (0-based)
   * @param character Character position (0-based)
   * @returns Array of references
   */
  public async findReferences(
    filePath: string,
    line: number,
    character: number
  ): Promise<SymbolInfo[]> {
    const uri = vscode.Uri.file(filePath);
    const position = new vscode.Position(line, character);
    
    // Get references from the language server
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      uri,
      position
    );
    
    if (!locations || locations.length === 0) {
      return [];
    }
    
    // Convert to our format
    return locations.map(location => ({
      name: 'Reference',
      kind: vscode.SymbolKind.Variable, // Use Variable instead of Reference which doesn't exist
      filePath: location.uri.fsPath,
      range: {
        startLine: location.range.start.line,
        startCharacter: location.range.start.character,
        endLine: location.range.end.line,
        endCharacter: location.range.end.character
      }
    }));
  }
  
  /**
   * Find the definition of a symbol
   * @param filePath Path to the file
   * @param line Line number (0-based)
   * @param character Character position (0-based)
   * @returns Definition information if found
   */
  public async getDefinition(
    filePath: string,
    line: number,
    character: number
  ): Promise<SymbolInfo | undefined> {
    const uri = vscode.Uri.file(filePath);
    const position = new vscode.Position(line, character);
    
    // Get definition from the language server
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      uri,
      position
    );
    
    if (!locations || locations.length === 0) {
      return undefined;
    }
    
    // Use the first definition
    const definition = locations[0];
    
    // If definition is in a different file, try to get more information
    if (definition.uri.fsPath !== filePath) {
      const definitionSymbols = await this.getSymbolsInFile(definition.uri.fsPath);
      const definitionSymbol = this.findSymbolAtPosition(
        definitionSymbols,
        definition.range.start.line,
        definition.range.start.character
      );
      
      if (definitionSymbol) {
        return definitionSymbol;
      }
    }
    
    // Basic definition information
    return {
      name: 'Definition',
      kind: vscode.SymbolKind.Class, // Default kind
      filePath: definition.uri.fsPath,
      range: {
        startLine: definition.range.start.line,
        startCharacter: definition.range.start.character,
        endLine: definition.range.end.line,
        endCharacter: definition.range.end.character
      }
    };
  }
  
  /**
   * Get a formatted hierarchy of symbols in a document
   * @param filePath Path to the file
   * @returns Formatted string representation of the symbol hierarchy
   */
  public async getDocumentSymbolHierarchy(filePath: string): Promise<string> {
    const symbols = await this.getSymbolsInFile(filePath);
    
    if (symbols.length === 0) {
      return 'No symbols found in the document.';
    }
    
    let result = `Symbol hierarchy for ${filePath}:\\n`;
    for (const symbol of symbols) {
      result += this.formatSymbolHierarchy(symbol, 0);
    }
    
    return result;
  }
  
  /**
   * Convert VS Code document symbols to our format
   * @param symbols Document symbols from VS Code
   * @param filePath File path
   * @returns Converted symbols
   */
  private convertDocumentSymbols(symbols: vscode.DocumentSymbol[], filePath: string): SymbolInfo[] {
    return symbols.map(symbol => this.convertSymbol(symbol, filePath));
  }
  
  /**
   * Convert a single VS Code document symbol to our format
   * @param symbol Document symbol from VS Code
   * @param filePath File path
   * @returns Converted symbol
   */
  private convertSymbol(symbol: vscode.DocumentSymbol, filePath: string): SymbolInfo {
    return {
      name: symbol.name,
      kind: symbol.kind,
      detail: symbol.detail,
      filePath,
      range: {
        startLine: symbol.range.start.line,
        startCharacter: symbol.range.start.character,
        endLine: symbol.range.end.line,
        endCharacter: symbol.range.end.character
      },
      children: symbol.children && symbol.children.length > 0
        ? symbol.children.map(child => this.convertSymbol(child, filePath))
        : undefined
    };
  }
  
  /**
   * Find a symbol at a specific position
   * @param symbols Array of symbols to search
   * @param line Line number
   * @param character Character position
   * @returns Symbol at position if found
   */
  private findSymbolAtPosition(
    symbols: SymbolInfo[],
    line: number,
    character: number
  ): SymbolInfo | undefined {
    for (const symbol of symbols) {
      // Check if position is inside this symbol
      if (
        line >= symbol.range.startLine &&
        line <= symbol.range.endLine &&
        (line !== symbol.range.startLine || character >= symbol.range.startCharacter) &&
        (line !== symbol.range.endLine || character <= symbol.range.endCharacter)
      ) {
        // Check children first for more specific match
        if (symbol.children && symbol.children.length > 0) {
          const childMatch = this.findSymbolAtPosition(symbol.children, line, character);
          if (childMatch) {
            return childMatch;
          }
        }
        
        // Return this symbol if no children match
        return symbol;
      }
    }
    
    return undefined;
  }
  
  /**
   * Format a symbol hierarchy for display
   * @param symbol Symbol to format
   * @param indent Indentation level
   * @returns Formatted string
   */
  private formatSymbolHierarchy(symbol: SymbolInfo, indent: number): string {
    const indentStr = '  '.repeat(indent);
    const kind = vscode.SymbolKind[symbol.kind] || 'Unknown';
    let result = `${indentStr}- ${symbol.name} (${kind})`;
    
    if (symbol.detail) {
      result += `: ${symbol.detail.split('\\n')[0]}`; // Just the first line of detail
    }
    
    result += '\\n';
    
    if (symbol.children && symbol.children.length > 0) {
      for (const child of symbol.children) {
        result += this.formatSymbolHierarchy(child, indent + 1);
      }
    }
    
    return result;
  }
}
