// This defines the structure for OpenAI tools that match the OpenAI API expected format
export interface ToolDefinition {
  type: "function";  // Must be the string literal "function" to match OpenAI's API
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
    };
  };
}
