import {
    CancellationToken,
    commands,
    EventEmitter,
    ExtensionContext,
    extensions,
    TreeDataProvider,
    TreeItem,
    window
} from "vscode";
import { act } from "../../extension";
import { HistoryStatus } from "../../historyManager";
import { GithubLocalActionsTreeItem } from "../githubLocalActionsTreeItem";
import HistoryTreeItem from "./history";
import ProjectDirectoryHistoryTreeItem from "./projectDirectoryHistory";

export default class HistoryTreeDataProvider implements TreeDataProvider<GithubLocalActionsTreeItem> {
    private _onDidChangeTreeData = new EventEmitter<GithubLocalActionsTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    static VIEW_ID = 'history';

    constructor(context: ExtensionContext) {
        extensions.onDidChange(() => {
            this.refresh();
        });

        context.subscriptions.push(
            commands.registerCommand('githubLocalActions.clearAll', async (projectDirectoryHistoryTreeItem?: ProjectDirectoryHistoryTreeItem) => {
                if (projectDirectoryHistoryTreeItem) {
                    await act.historyManager.clearAll(projectDirectoryHistoryTreeItem.projectPath);
                    this.refresh();
                    return;
                }

                const workspaceHistory = await act.historyManager.getWorkspaceHistory();
                const projectPaths = Object.keys(workspaceHistory).filter(projectPath => (workspaceHistory[projectPath] ?? []).length > 0);

                if (projectPaths.length === 0) {
                    window.showInformationMessage('No history to clear.');
                    return;
                }

                if (projectPaths.length === 1) {
                    await act.historyManager.clearAll(projectPaths[0]);
                    this.refresh();
                    return;
                }

                const selectedProjectPath = await window.showQuickPick(projectPaths, {
                    title: 'Clear History',
                    placeHolder: 'Select a project directory history to clear'
                });

                if (selectedProjectPath) {
                    await act.historyManager.clearAll(selectedProjectPath);
                    this.refresh();
                }
            }),
            commands.registerCommand('githubLocalActions.refreshHistory', async () => {
                this.refresh();
            }),
            commands.registerCommand('githubLocalActions.focusTask', async (historyTreeItem: HistoryTreeItem) => {
                const terminals = window.terminals;
                for (const terminal of terminals) {
                    if (terminal.creationOptions.name === `${historyTreeItem.history.name} #${historyTreeItem.history.count}`) {
                        terminal.show();
                        return;
                    }
                }

                window.showErrorMessage(`${historyTreeItem.history.name} #${historyTreeItem.history.count} task is no longer open.`, 'View Output').then(async value => {
                    if (value === 'View Output') {
                        await commands.executeCommand('githubLocalActions.viewOutput', historyTreeItem);
                    }
                });
            }),
            commands.registerCommand('githubLocalActions.viewOutput', async (historyTreeItem: HistoryTreeItem) => {
                await act.historyManager.viewOutput(historyTreeItem.history);
            }),
            commands.registerCommand('githubLocalActions.restart', async (historyTreeItem: HistoryTreeItem) => {
                await act.historyManager.restart(historyTreeItem.history);
            }),
            commands.registerCommand('githubLocalActions.stop', async (historyTreeItem: HistoryTreeItem) => {
                await act.historyManager.stop(historyTreeItem.history);
                this.refresh();
            }),
            commands.registerCommand('githubLocalActions.remove', async (historyTreeItem: HistoryTreeItem) => {
                await act.historyManager.remove(historyTreeItem.history);
                this.refresh();
            })
        );
    }

    refresh(element?: GithubLocalActionsTreeItem) {
        this._onDidChangeTreeData.fire(element);
    }

    getTreeItem(element: GithubLocalActionsTreeItem): GithubLocalActionsTreeItem | Thenable<GithubLocalActionsTreeItem> {
        return element;
    }

    async resolveTreeItem(item: TreeItem, element: GithubLocalActionsTreeItem, token: CancellationToken): Promise<GithubLocalActionsTreeItem> {
        if (element.getToolTip) {
            element.tooltip = await element.getToolTip();
        }

        return element;
    }

    async getChildren(element?: GithubLocalActionsTreeItem): Promise<GithubLocalActionsTreeItem[]> {
        if (element) {
            return element.getChildren();
        }

        const workspaceHistory = await act.historyManager.getWorkspaceHistory();
        const projectPaths = Object.keys(workspaceHistory)
            .filter(projectPath => (workspaceHistory[projectPath] ?? []).length > 0)
            .sort((a, b) => a.localeCompare(b));

        const isRunning = projectPaths.some(projectPath =>
            (workspaceHistory[projectPath] ?? []).some(history => history.status === HistoryStatus.Running)
        );
        const noHistory = projectPaths.length === 0;

        await commands.executeCommand('setContext', 'githubLocalActions:isRunning', isRunning);
        await commands.executeCommand('setContext', 'githubLocalActions:noHistory', noHistory);

        if (projectPaths.length === 1) {
            return this.getHistoryItemsForProjectPath(projectPaths[0]);
        }

        return projectPaths.map(projectPath => new ProjectDirectoryHistoryTreeItem(projectPath));
    }

    private async getHistoryItemsForProjectPath(projectPath: string): Promise<GithubLocalActionsTreeItem[]> {
        const workspaceHistory = await act.historyManager.getWorkspaceHistory();
        const projectHistory = workspaceHistory[projectPath] ?? [];

        return projectHistory
            .slice()
            .reverse()
            .map(history => new HistoryTreeItem(history.commandArgs.workflow.workspaceFolder, history));
    }
}
