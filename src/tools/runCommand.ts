import * as vscode from 'vscode';

export async function runCommand(commandLine: string, cwd: string): Promise<string> {
  // Create a new terminal with the specified working directory
  const terminal = vscode.window.createTerminal({
    name: 'Command Runner',
    cwd: cwd
  });
  // Show the terminal to the user
  terminal.show();
  // Send the command to the terminal for execution
  terminal.sendText(commandLine);

  // Return an immediate message indicating that the command has been sent.
  // Note: The actual execution output is not captured via this API.
  return `Started execution of "${commandLine}" in terminal with working directory "${cwd}"`;
}
