import * as vscode from "vscode";
import path = require("path");

let panel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "vssummary.showAgenda",
    async () => {
      const tasks = await readTasks();
      const sortedTasks = tasks.sort((a: Task, b: Task) => a.compareTo(b));
      if (!panel) {
        panel = vscode.window.createWebviewPanel(
          "MarkdownAgenda",
          "Agenda",
          vscode.ViewColumn.One,
          {
            enableScripts: true,
          }
        );
        panel.webview.onDidReceiveMessage(async (message) => {
          if (message.command === "open") {
            const uri = vscode.Uri.parse(message.link);
            const line = +uri.fragment.substring(1) - 1;
            const editor = await vscode.window.showTextDocument(uri);
            editor.revealRange(
              new vscode.Range(line, 0, line, 0),
              vscode.TextEditorRevealType.InCenterIfOutsideViewport
            );
          } else if (message.command === "filter-subtasks") {
            panel!.webview.html = getWebviewContent(sortedTasks, false);
          } else if (message.command === "show-subtasks") {
            panel!.webview.html = getWebviewContent(sortedTasks, true);
          }
        });

        panel.onDidDispose(
          () => {
            panel = null;
          },
          null,
          context.subscriptions
        );
      }
      panel.webview.html = getWebviewContent(sortedTasks, true);
    }
  );

  context.subscriptions.push(disposable);
}

async function readTasks(): Promise<Task[]> {
  const tasks: Task[] = [];
  const uriList = await vscode.workspace.findFiles("**/*.*");
  for (const uri of uriList) {
    const document = await vscode.workspace.openTextDocument(uri);
    let text = document.getText();
    const lines = text.split("\n");

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (Task.hasTask(line)) {
        const task = new Task(line, `${uri.toString()}#L${i}`);
        tasks.push(task);

        while (i + 1 < lines.length) {
          if (Task.isSubTask(lines[i + 1])) {
            task.subtasks.push(lines[i + 1]);
          } else if (lines[i + 1].trim().length !== 0) {
            break;
          }
          i += 1;
        }
      }
      i += 1;
    }
  }
  return tasks;
}

enum TaskStatus {
  todo = "@TODO",
  wait = "@WAIT",
  done = "@DONE",
  none = "--",
}

enum Priority {
  p0 = "@P0",
  p1 = "@P1",
  p2 = "@P2",
  none = "--",
}

class Task {
  status: TaskStatus;
  text: string = "";
  duration: string = "";
  deadline: string = "";
  priority: Priority;
  project: string = "";
  subtasks: string[] = [];

  private static readonly tokenRegex = new RegExp("@\\w+", "g");

  constructor(entry: string, public location: string) {
    const tokenSet = new Set<string>();
    const tokenArr = entry.match(Task.tokenRegex) ?? [];
    for (const token of tokenArr) {
      tokenSet.add(token.trim());
    }
    this.status = Task.extractStatus(tokenSet);
    this.priority = Task.extractPriority(tokenSet);
    this.text = entry.replace(Task.tokenRegex, " ");
  }

  static hasTask(entry: string) {
    const tokenSet = new Set<string>();
    const tokenArr = entry.match(this.tokenRegex) ?? [];
    for (const token of tokenArr) {
      tokenSet.add(token.trim());
    }
    const status = this.extractStatus(tokenSet);
    return status !== TaskStatus.none;
  }

  static isSubTask(line: string) {
    line = line.trim();
    return (
      line.startsWith("[ ]") || line.startsWith("[-]") || line.startsWith("[x]")
    );
  }

  compareTo(otherTask: Task) {
    const otherTaskPriorityIndex = Object.values(Priority).indexOf(
      otherTask.priority
    );
    const taskPriorityIndex = Object.values(Priority).indexOf(this.priority);
    const otherTaskStatusIndex = Object.values(TaskStatus).indexOf(
      otherTask.status
    );
    const taskStatusIndex = Object.values(TaskStatus).indexOf(otherTask.status);

    const taskScore = taskStatusIndex * 10 + taskPriorityIndex;
    const otheraskScore = otherTaskStatusIndex * 10 + otherTaskPriorityIndex;

    const diffScore = taskScore - otheraskScore;

    return diffScore;
  }

  generateHtml(showSubTasks: boolean) {
    let subtasks = `<td style="border: 1px solid gray;">
		hidden
	</td>`;
    if (showSubTasks) {
      subtasks = `<td style="border: 1px solid gray;">
		<div style="margin: 10px 20px;">${this.subtasks.join("<br>")}</div>
	</td>`;
    }
    return `
		<tr style="border: 1px solid gray;">
			<td style="border: 1px solid gray;">
				<div style="margin: 10px 10px;">
					<a href="${this.location}">link</a>
				</div>
			</td>
			<td style="border: 1px solid gray;">
				<div style="margin: 10px 20px;">${this.status}</div>
			</td>
			<td style="border: 1px solid gray;">
				<div style="margin: 10px 20px;">${this.priority}</div>
			</td>
			<td style="border: 1px solid gray;">
				<div style="margin: 10px 20px;">${this.project}</div>
			</td>
			<td style="border: 1px solid gray;">
				<div style="margin: 10px 20px;">${this.text}</div>
			</td>
			${subtasks}
		</tr>
	  `;
  }

  private static extractStatus(tokenSet: Set<string>) {
    if (tokenSet.has(TaskStatus.todo)) {
      return TaskStatus.todo;
    } else if (tokenSet.has(TaskStatus.done)) {
      return TaskStatus.done;
    } else if (tokenSet.has(TaskStatus.wait)) {
      return TaskStatus.wait;
    }
    return TaskStatus.none;
  }

  private static extractPriority(tokenSet: Set<string>) {
    if (tokenSet.has(Priority.p0)) {
      return Priority.p0;
    } else if (tokenSet.has(Priority.p1)) {
      return Priority.p1;
    } else if (tokenSet.has(Priority.p2)) {
      return Priority.p2;
    }
    return Priority.none;
  }

  private extractDuration(tokenSet: Set<string>) {
    for (const token of tokenSet) {
      if (token.startsWith("@duration=")) {
        return token;
      }
    }
    return "";
  }
}

function getWebviewContent(tasks: Task[], showSubTasks: boolean) {
  return `
	<!DOCTYPE html>
	<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Agenda</title>
		</head>

		
		<body>
			<div id="show-subtasks-button" style="border: 1px solid gray; padding: 5px;"> Show subtasks</div>
			<div id="hide-subtasks-button" style="border: 1px solid gray; padding: 5px;"> Hide subtasks</div>
			<table style="border: 1px solid gray; border-collapse: collapse;">
				<tr style="border: 1px solid gray;">
					<th style="border: 1px solid gray;">
						Link
					</th>
					<th style="border: 1px solid gray;">
						Status
					</th>
					<th style="border: 1px solid gray;">
						Priority
					</th>
					<th style="border: 1px solid gray;">
						Project
					</th>
					<th style="border: 1px solid gray;">
						Task
					</th>
					<th style="border: 1px solid gray;">
						Subtasks
					</th>
				</tr>
				${tasks.map((t) => t.generateHtml(showSubTasks)).join()}
			</table>
			<script>
				(function() {
					const vscode = acquireVsCodeApi();

					for (const link of document.querySelectorAll('a[href^="file:"]')) {
						link.addEventListener('click', () => {
							vscode.postMessage({
								command: "open",
								link: link.getAttribute('href'),
							});
						});
					}

					for (const link of document.querySelectorAll('#hide-subtasks-button')) {
						link.addEventListener('click', () => {
							vscode.postMessage({
								command: "filter-subtasks",
							});
						});
					}

					for (const link of document.querySelectorAll('#show-subtasks-button')) {
						link.addEventListener('click', () => {
							vscode.postMessage({
								command: "show-subtasks",
							});
						});
					}
				}())
			</script>
		</body>
	</html>`;
}

export function deactivate() {}
