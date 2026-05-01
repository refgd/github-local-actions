import * as path from "path";
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { act } from "../../extension";
import { GithubLocalActionsTreeItem } from "../githubLocalActionsTreeItem";
import HistoryTreeItem from "./history";

export default class ProjectDirectoryHistoryTreeItem extends TreeItem implements GithubLocalActionsTreeItem {
    static contextValue = 'githubLocalActions.projectDirectoryHistory';

    constructor(public projectPath: string) {
        super(ProjectDirectoryHistoryTreeItem.getLabel(projectPath), TreeItemCollapsibleState.Collapsed);
        this.contextValue = ProjectDirectoryHistoryTreeItem.contextValue;
        this.iconPath = new ThemeIcon('folder');
        this.description = projectPath;
        this.tooltip = `Project Path: ${projectPath}`;
    }

    async getChildren(): Promise<GithubLocalActionsTreeItem[]> {
        const workspaceHistory = await act.historyManager.getWorkspaceHistory();
        const projectHistory = workspaceHistory[this.projectPath] ?? [];

        return projectHistory
            .slice()
            .reverse()
            .map(history => new HistoryTreeItem(history.commandArgs.workflow.workspaceFolder, history));
    }

    private static getLabel(projectPath: string): string {
        return path.basename(projectPath) || projectPath;
    }
}
