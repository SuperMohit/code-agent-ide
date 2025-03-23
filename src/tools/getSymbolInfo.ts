import * as path from 'path';
import { ServiceFactory } from '../services/ServiceFactory';

/**
 * Get symbol information from a file at a specific position
 * 
 * @param args Object containing the file path and optional position
 * @returns Symbol information or hierarchy
 */
export async function getSymbolInfo(args: {
  FilePath: string;
  Line?: number;
  Character?: number;
  GetHierarchy?: boolean;
  FindReferences?: boolean;
  GetDefinition?: boolean;
}): Promise<string> {
  try {
    // Validate file path
    if (!args.FilePath) {
      return 'Error: File path is required';
    }
    
    // Get the symbol information service
    const symbolService = ServiceFactory.getSymbolInformationService();
    
    // If no position is provided, get the symbol hierarchy
    if (args.GetHierarchy || (!args.Line && !args.Character)) {
      const symbolHierarchy = await symbolService.getDocumentSymbolHierarchy(args.FilePath);
      return symbolHierarchy;
    }
    
    // Position must be provided for other operations
    if (args.Line === undefined || args.Character === undefined) {
      return 'Error: Line and Character position are required for symbol lookup';
    }
    
    // If FindReferences is true, find all references to the symbol
    if (args.FindReferences) {
      const references = await symbolService.findReferences(
        args.FilePath,
        args.Line,
        args.Character
      );
      
      if (references.length === 0) {
        return 'No references found for symbol at the specified position.';
      }
      
      let result = `Found ${references.length} references:\n\n`;
      references.forEach((ref, index) => {
        const relativePath = path.basename(ref.filePath);
        result += `${index + 1}. ${relativePath}:${ref.range.startLine + 1}:${ref.range.startCharacter + 1}\n`;
      });
      
      return result;
    }
    
    // If GetDefinition is true, find the definition of the symbol
    if (args.GetDefinition) {
      const definition = await symbolService.getDefinition(
        args.FilePath,
        args.Line,
        args.Character
      );
      
      if (!definition) {
        return 'Could not find the definition for the symbol at the specified position.';
      }
      
      const relativePath = path.basename(definition.filePath);
      const symbolKind = definition.kind ? ` (${definition.kind})` : '';
      
      let result = `Definition found: ${definition.name}${symbolKind}\n`;
      result += `Location: ${relativePath}:${definition.range.startLine + 1}:${definition.range.startCharacter + 1}\n`;
      
      if (definition.detail) {
        result += `\nDetails:\n${definition.detail}\n`;
      }
      
      return result;
    }
    
    // Default: get symbol information at position
    const symbol = await symbolService.getSymbolAtPosition(
      args.FilePath,
      args.Line,
      args.Character
    );
    
    if (!symbol) {
      return 'No symbol found at the specified position.';
    }
    
    let result = `Symbol: ${symbol.name} (${symbol.kind})\n`;
    result += `Location: ${path.basename(symbol.filePath)}:${symbol.range.startLine + 1}:${symbol.range.startCharacter + 1}\n`;
    
    if (symbol.detail) {
      result += `\nDetails:\n${symbol.detail}\n`;
    }
    
    return result;
  } catch (error) {
    console.error('Error getting symbol information:', error);
    return `Error getting symbol information: ${error}`;
  }
}
