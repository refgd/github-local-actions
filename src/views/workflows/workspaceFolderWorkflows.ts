import {
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState,
    WorkspaceFolder,
} from "vscode";
import { ConfigurationManager } from "../../configurationManager";
import { GithubLocalActionsTreeItem } from "../githubLocalActionsTreeItem";
import ProjectDirectoryWorkflowsTreeItem from "./projectDirectoryWorkflows";

export default class WorkspaceFolderWorkflowsTreeItem
    extends TreeItem
    implements GithubLocalActionsTreeItem
{
    static contextValue = "githubLocalActions.workspaceFolderWorkflows";

    constructor(public workspaceFolder: WorkspaceFolder) {
        super(workspaceFolder.name, TreeItemCollapsibleState.Collapsed);

        this.contextValue = WorkspaceFolderWorkflowsTreeItem.contextValue;
        this.iconPath = new ThemeIcon("root-folder");
        this.description = workspaceFolder.uri.fsPath;
        this.tooltip =
            `Workspace: ${workspaceFolder.name}\n` +
            `Path: ${workspaceFolder.uri.fsPath}`;
    }

    async getChildren(): Promise<GithubLocalActionsTreeItem[]> {
        return ConfigurationManager.getResolvedProjectDirectories(
            this.workspaceFolder,
        ).map(
            projectDirectory =>
                new ProjectDirectoryWorkflowsTreeItem(
                    projectDirectory.workspaceFolder,
                    projectDirectory.projectDirectory,
                    projectDirectory.projectPath,
                ),
        );
    }
}