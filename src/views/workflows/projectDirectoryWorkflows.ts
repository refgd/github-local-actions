import * as path from "path";
import {
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState,
    WorkspaceFolder,
} from "vscode";
import { act } from "../../extension";
import { GithubLocalActionsTreeItem } from "../githubLocalActionsTreeItem";
import WorkflowTreeItem from "./workflow";

export default class ProjectDirectoryWorkflowsTreeItem
    extends TreeItem
    implements GithubLocalActionsTreeItem
{
    static contextValue = "githubLocalActions.projectDirectoryWorkflows";

    constructor(
        public workspaceFolder: WorkspaceFolder,
        public projectDirectory: string,
        public projectPath: string,
    ) {
        super(
            projectDirectory === "."
                ? workspaceFolder.name
                : path.basename(projectPath),
            TreeItemCollapsibleState.Collapsed,
        );

        this.contextValue = ProjectDirectoryWorkflowsTreeItem.contextValue;
        this.iconPath = new ThemeIcon("repo");
        this.description =
            projectDirectory === "." ? "." : projectDirectory;
        this.tooltip =
            `Workspace: ${workspaceFolder.name}\n` +
            `Project Directory: ${projectDirectory}\n` +
            `Path: ${projectPath}`;
    }

    async getChildren(): Promise<GithubLocalActionsTreeItem[]> {
        const workflows =
            await act.workflowsManager.getWorkflowsForProjectDirectory(
                this.workspaceFolder,
                this.projectDirectory,
            );

        return workflows.map(
            workflow => new WorkflowTreeItem(this.workspaceFolder, workflow),
        );
    }
}