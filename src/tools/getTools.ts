import { ToolDefinition } from '../types/ToolDefinition';
import { treeViewToolDefinition } from './treeView';

export function getToolDefinitions(): ToolDefinition[] {
  return [
    treeViewToolDefinition,
    {
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
    },
    {
      type: 'function',
      function: {
        name: 'create_file',
        description: 'Create a new file with the specified content.',
        parameters: {
          type: 'object',
          properties: {
            FilePath: {
              type: 'string',
              description: 'The absolute path where the file should be created'
            },
            Content: {
              type: 'string',
              description: 'The content to write to the file'
            }
          },
          required: ['FilePath', 'Content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_file',
        description: 'Update an existing file with new content.',
        parameters: {
          type: 'object',
          properties: {
            FilePath: {
              type: 'string',
              description: 'The absolute path of the file to update'
            },
            Content: {
              type: 'string',
              description: 'The new content for the file'
            },
            InsertAtLine: {
              type: 'integer',
              description: 'Optional line number to insert content at. If not provided, the entire file will be replaced.'
            },
            InsertAtColumn: {
              type: 'integer',
              description: 'Optional column number to insert content at (only used if InsertAtLine is provided)'
            }
          },
          required: ['FilePath', 'Content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_directory',
        description: 'Create a new directory at the specified path.',
        parameters: {
          type: 'object',
          properties: {
            DirectoryPath: {
              type: 'string',
              description: 'The absolute path of the directory to create'
            }
          },
          required: ['DirectoryPath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'codebase_search',
        description: 'Find snippets of code from the codebase most relevant to the search query.',
        parameters: {
          type: 'object',
          properties: {
            Query: {
              type: 'string',
              description: 'Search query'
            },
            TargetDirectories: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'List of absolute paths to directories to search over'
            }
          },
          required: ['Query', 'TargetDirectories']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'grep_search',
        description: 'Fast text-based search that finds exact pattern matches within files or directories.',
        parameters: {
          type: 'object',
          properties: {
            Query: {
              type: 'string',
              description: 'The search term or pattern to look for within files.'
            },
            SearchDirectory: {
              type: 'string',
              description: 'The directory from which to run the search command.'
            },
            Includes: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'The files or directories to search within.'
            },
            MatchPerLine: {
              type: 'boolean',
              description: 'If true, returns each line that matches the query, including line numbers and snippets.'
            },
            CaseInsensitive: {
              type: 'boolean',
              description: 'If true, performs a case-insensitive search.'
            }
          },
          required: ['Query', 'SearchDirectory']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'find_by_name',
        description: 'Search for files and subdirectories within a specified directory.',
        parameters: {
          type: 'object',
          properties: {
            SearchDirectory: {
              type: 'string',
              description: 'The directory to search within'
            },
            Pattern: {
              type: 'string',
              description: 'Optional, Pattern to search for, supports glob format'
            },
            Extensions: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Optional, file extensions to include (without leading .)'
            }
          },
          required: ['SearchDirectory']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List the contents of a directory.',
        parameters: {
          type: 'object',
          properties: {
            DirectoryPath: {
              type: 'string',
              description: 'Path to list contents of, should be absolute path to a directory'
            }
          },
          required: ['DirectoryPath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'view_file',
        description: 'View the contents of a file.',
        parameters: {
          type: 'object',
          properties: {
            AbsolutePath: {
              type: 'string',
              description: 'Path to file to view. Must be an absolute path.'
            },
            StartLine: {
              type: 'integer',
              description: 'Startline to view'
            },
            EndLine: {
              type: 'integer',
              description: 'Endline to view, inclusive.'
            }
          },
          required: ['AbsolutePath', 'StartLine', 'EndLine']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'view_code_item',
        description: 'View the content of a code item node, such as a class or a function in a file.',
        parameters: {
          type: 'object',
          properties: {
            File: {
              type: 'string',
              description: 'Absolute path to the node to edit, e.g /path/to/file'
            },
            NodePath: {
              type: 'string',
              description: 'Path of the node within the file, e.g package.class.FunctionName'
            }
          },
          required: ['File', 'NodePath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_url_content',
        description: 'Read content from a URL.',
        parameters: {
          type: 'object',
          properties: {
            Url: {
              type: 'string',
              description: 'URL to read content from'
            }
          },
          required: ['Url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Performs a web search to get a list of relevant web documents for the given query.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
            },
            domain: {
              type: 'string',
              description: 'Optional domain to recommend the search prioritize'
            }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute a shell command with specified arguments.',
        parameters: {
          type: 'object',
          properties: {
            CommandLine: {
              type: 'string',
              description: 'The exact command line string to execute.'
            },
            Cwd: {
              type: 'string',
              description: 'The current working directory for the command'
            }
          },
          required: ['CommandLine', 'Cwd']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'checkDiagnostics',
        description: 'Fetch all the problems and warnings for the current workspace. Check this after every edit to ensure no errors are introduced.'
      }
    }
  ];
}
