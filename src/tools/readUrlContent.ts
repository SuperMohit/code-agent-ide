import axios from 'axios';

export async function readUrlContent(url: string): Promise<string> {
  try {
    const response = await axios.get(url);
    return response.data.slice(0, 1000) + (response.data.length > 1000 ? '...' : '');
  } catch (error) {
    console.error(`Error reading URL \${url}:`, error);
    return `Error: \${error instanceof Error ? error.message : String(error)}`;
  }
}
