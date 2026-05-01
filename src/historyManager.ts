import { TaskExecution, ThemeColor, ThemeIcon, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { CommandArgs } from "./act";
import { act, historyTreeDataProvider } from "./extension";
import { StorageKey, StorageManager } from "./storageManager";

export interface History {
    index: number,
    name: string,
    count: number,
    status: HistoryStatus,
    date: {
        start: string,
        end?: string,
    },
    commandArgs: CommandArgs,
    logPath: string,
    taskExecution?: TaskExecution,
    jobs?: Job[],
}

export interface Job {
    name: string,
    status: HistoryStatus,
    date: {
        start: string,
        end?: string,
    },
    steps?: Step[]
}

export interface Step {
    id: string,
    name: string,
    status: HistoryStatus,
    date: {
        start: string,
        end?: string,
    }
}

export enum HistoryStatus {
    Running = 'Running',
    Success = 'Success',
    Failed = 'Failed',
    Skipped = 'Skipped',
    Cancelled = 'Cancelled',
    Unknown = 'Unknown'
}

export class HistoryManager {
    storageManager: StorageManager;
    private workspaceHistory: { [path: string]: History[] } = {};
    private syncPromise?: Promise<void>;

    constructor(storageManager: StorageManager) {
        this.storageManager = storageManager;
    }

    async getWorkspaceHistory() {
        await this.ensureSynced();
        return this.workspaceHistory;
    }

    private async ensureSynced() {
        if (!this.syncPromise) {
            this.syncPromise = this.syncHistory();
        }

        await this.syncPromise;
    }

    async syncHistory() {
        const workspaceHistory =
            await this.storageManager.get<{ [path: string]: History[] }>(StorageKey.WorkspaceHistory) || {};

        let changed = false;

        for (const historyLogs of Object.values(workspaceHistory)) {
            for (const history of historyLogs) {
                if (history.jobs) {
                    for (const job of history.jobs) {
                        if (job.steps) {
                            for (const step of job.steps) {
                                if (step.status === HistoryStatus.Running) {
                                    step.status = HistoryStatus.Cancelled;
                                    changed = true;
                                }
                            }
                        }

                        if (job.status === HistoryStatus.Running) {
                            job.status = HistoryStatus.Cancelled;
                            changed = true;
                        }
                    }
                }

                if (history.status === HistoryStatus.Running) {
                    history.status = HistoryStatus.Cancelled;
                    changed = true;
                }
            }
        }

        this.workspaceHistory = workspaceHistory;

        if (changed) {
            await this.storageManager.update(StorageKey.WorkspaceHistory, this.workspaceHistory);
        }
    }

    async clearAll(target: WorkspaceFolder | string) {
        await this.ensureSynced();

        const projectPath = typeof target === 'string' ? target : target.uri.fsPath;
        const existingHistory = this.workspaceHistory[projectPath] ?? [];

        await Promise.allSettled(
            existingHistory.map(history => workspace.fs.delete(Uri.file(history.logPath)))
        );

        this.workspaceHistory[projectPath] = [];

        historyTreeDataProvider.refresh();
        await this.storageManager.update(StorageKey.WorkspaceHistory, this.workspaceHistory);
    }

    async viewOutput(history: History) {
        try {
            const document = await workspace.openTextDocument(history.logPath);
            await window.showTextDocument(document);
        } catch {
            window.showErrorMessage(`${history.name} #${history.count} log file not found`);
        }
    }

    async restart(history: History) {
        await act.runCommand(history.commandArgs);
    }

    async stop(history: History) {
        history.taskExecution?.terminate();
    }

    async remove(history: History) {
        await this.ensureSynced();

        const projectPath = history.commandArgs.path;
        const histories = this.workspaceHistory[projectPath] ?? [];
        const historyIndex = histories.findIndex(item => item.index === history.index);

        if (historyIndex === -1) {
            return;
        }

        histories.splice(historyIndex, 1);
        this.workspaceHistory[projectPath] = histories;

        await this.storageManager.update(StorageKey.WorkspaceHistory, this.workspaceHistory);

        try {
            await workspace.fs.delete(Uri.file(history.logPath));
        } catch {
            // Ignore missing log file.
        }

        historyTreeDataProvider.refresh();
    }

    static statusToIcon(status: HistoryStatus) {
        switch (status) {
            case HistoryStatus.Running:
                return new ThemeIcon('loading~spin');
            case HistoryStatus.Success:
                return new ThemeIcon('pass', new ThemeColor('GitHubLocalActions.green'));
            case HistoryStatus.Failed:
                return new ThemeIcon('error', new ThemeColor('GitHubLocalActions.red'));
            case HistoryStatus.Cancelled:
                return new ThemeIcon('circle-slash', new ThemeColor('GitHubLocalActions.yellow'));
            case HistoryStatus.Skipped:
                return new ThemeIcon('issues', new ThemeColor('GitHubLocalActions.grey'));
            case HistoryStatus.Unknown:
                return new ThemeIcon('question', new ThemeColor('GitHubLocalActions.purple'));
        }
    }

    static stepResultToHistoryStatus(stepResult: string) {
        switch (stepResult) {
            case 'success':
                return HistoryStatus.Success;
            case 'skipped':
                return HistoryStatus.Skipped;
            default:
                return HistoryStatus.Failed;
        }
    }
}
