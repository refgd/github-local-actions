import * as path from "path";
import {
    CancellationToken,
    commands,
    EventEmitter,
    ExtensionContext,
    TreeDataProvider,
    TreeItem,
    window,
    workspace,
} from "vscode";
import { Event } from "../../act";
import { ConfigurationManager, Section } from "../../configurationManager";
import { act } from "../../extension";
import { Utils } from "../../utils";
import { WorkflowsManager } from "../../workflowsManager";
import { GithubLocalActionsTreeItem } from "../githubLocalActionsTreeItem";
import JobTreeItem from "./job";
import ProjectDirectoryWorkflowsTreeItem from "./projectDirectoryWorkflows";
import WorkflowTreeItem from "./workflow";
import WorkspaceFolderWorkflowsTreeItem from "./workspaceFolderWorkflows";

export default class WorkflowsTreeDataProvider
    implements TreeDataProvider<GithubLocalActionsTreeItem>
{
    private _onDidChangeTreeData =
        new EventEmitter<GithubLocalActionsTreeItem | undefined>();

    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    static VIEW_ID = "workflows";

    constructor(context: ExtensionContext) {
        context.subscriptions.push(
            commands.registerCommand(
                "githubLocalActions.runAllWorkflows",
                async (
                    treeItem?:
                        | WorkspaceFolderWorkflowsTreeItem
                        | ProjectDirectoryWorkflowsTreeItem,
                ) => {
                    if (treeItem instanceof ProjectDirectoryWorkflowsTreeItem) {
                        const workflows =
                            await act.workflowsManager.getWorkflowsForProjectDirectory(
                                treeItem.workspaceFolder,
                                treeItem.projectDirectory,
                            );

                        if (workflows.length === 0) {
                            window.showErrorMessage("No workflows found.");
                            return;
                        }

                        for (const workflow of workflows) {
                            await act.runWorkflow(
                                treeItem.workspaceFolder,
                                workflow,
                            );
                        }

                        return;
                    }

                    const workspaceFolder = await Utils.getWorkspaceFolder(
                        treeItem?.workspaceFolder,
                    );

                    if (workspaceFolder) {
                        await act.runAllWorkflows(workspaceFolder);
                    }
                },
            ),

            commands.registerCommand(
                "githubLocalActions.runEvent",
                async (
                    treeItem?:
                        | WorkspaceFolderWorkflowsTreeItem
                        | ProjectDirectoryWorkflowsTreeItem,
                ) => {
                    const workspaceFolder = await Utils.getWorkspaceFolder(
                        treeItem?.workspaceFolder,
                    );

                    if (!workspaceFolder) {
                        return;
                    }

                    const event = await window.showQuickPick(
                        Object.values(Event),
                        {
                            title: "Select the event to run",
                            placeHolder: "Event",
                        },
                    );

                    if (!event) {
                        return;
                    }

                    if (treeItem instanceof ProjectDirectoryWorkflowsTreeItem) {
                        const workflows =
                            await act.workflowsManager.getWorkflowsForProjectDirectory(
                                treeItem.workspaceFolder,
                                treeItem.projectDirectory,
                            );

                        let eventExists = false;

                        for (const workflow of workflows) {
                            if (workflow.yaml?.on && event in workflow.yaml.on) {
                                eventExists = true;

                                await act.runEvent(
                                    treeItem.workspaceFolder,
                                    event as Event,
                                    { workflow },
                                );
                            }
                        }

                        if (!eventExists) {
                            window.showErrorMessage(
                                `No workflows triggered by the "${event}" event.`,
                            );
                        }

                        return;
                    }

                    await act.runEvent(workspaceFolder, event as Event);
                },
            ),

            commands.registerCommand(
                "githubLocalActions.refreshWorkflows",
                async () => {
                    this.refresh();
                },
            ),

            commands.registerCommand(
                "githubLocalActions.openWorkflow",
                async (workflowTreeItem: WorkflowTreeItem) => {
                    try {
                        const document = await workspace.openTextDocument(
                            workflowTreeItem.workflow.uri,
                        );
                        await window.showTextDocument(document);
                    } catch (error: any) {
                        try {
                            await workspace.fs.stat(
                                workflowTreeItem.workflow.uri,
                            );

                            window.showErrorMessage(
                                `Failed to open workflow.\nError: ${error}`,
                            );
                        } catch {
                            window.showErrorMessage(
                                `Workflow ${
                                    path.parse(
                                        workflowTreeItem.workflow.uri.fsPath,
                                    ).base
                                } not found.`,
                            );
                        }
                    }
                },
            ),

            commands.registerCommand(
                "githubLocalActions.runWorkflow",
                async (workflowTreeItem?: WorkflowTreeItem) => {
                    if (workflowTreeItem) {
                        await act.runWorkflow(
                            workflowTreeItem.workspaceFolder,
                            workflowTreeItem.workflow,
                        );
                        return;
                    }

                    let errorMessage: string | undefined;
                    const activeTextEditor = window.activeTextEditor;

                    if (activeTextEditor) {
                        const uri = activeTextEditor.document.uri;
                        const fileName = path.parse(uri.fsPath).base;

                        if (
                            uri.path.match(
                                `.*/${WorkflowsManager.defaultWorkflowsDirectory}/.*\\.(${WorkflowsManager.yamlExtension}|${WorkflowsManager.ymlExtension})`,
                            )
                        ) {
                            const workflowMatch =
                                await act.workflowsManager.findWorkflowByUri(
                                    uri,
                                );

                            if (workflowMatch) {
                                await act.runWorkflow(
                                    workflowMatch.workspaceFolder,
                                    workflowMatch.workflow,
                                );
                            } else {
                                errorMessage =
                                    `Workflow not found in configured project directories. ` +
                                    `Make sure its project folder is listed in ${ConfigurationManager.group}.${Section.projectDirectory}.`;
                            }
                        } else {
                            errorMessage = `${fileName} is not a workflow that can be executed locally.`;
                        }
                    } else {
                        errorMessage = "No workflow opened to execute locally.";
                    }

                    if (errorMessage) {
                        window
                            .showErrorMessage(errorMessage, "View Workflows")
                            .then(async value => {
                                if (value === "View Workflows") {
                                    await commands.executeCommand(
                                        "workflows.focus",
                                    );
                                }
                            });
                    }
                },
            ),

            commands.registerCommand(
                "githubLocalActions.runJob",
                async (jobTreeItem: JobTreeItem) => {
                    await act.runJob(
                        jobTreeItem.workspaceFolder,
                        jobTreeItem.workflow,
                        jobTreeItem.job,
                    );
                },
            ),

            commands.registerCommand(
                "githubLocalActions.runWorkflowEvent",
                async (workflowTreeItem: WorkflowTreeItem) => {
                    const registeredEventsOnWorkflow = Object.keys(
                        workflowTreeItem.workflow.yaml?.on ?? {},
                    );

                    if (registeredEventsOnWorkflow.length === 0) {
                        window.showErrorMessage(
                            `No events registered on the workflow (${workflowTreeItem.workflow.name}).\n` +
                                "Add an event to the `on` section of the workflow to trigger it.",
                        );
                        return;
                    }

                    const event = await window.showQuickPick(
                        registeredEventsOnWorkflow,
                        {
                            title: "Select the event to run",
                            placeHolder: "Event",
                        },
                    );

                    if (event) {
                        await act.runEvent(
                            workflowTreeItem.workspaceFolder,
                            event as Event,
                            { workflow: workflowTreeItem.workflow },
                        );
                    }
                },
            ),

            commands.registerCommand(
                "githubLocalActions.runJobEvent",
                async (jobTreeItem: JobTreeItem) => {
                    const registeredEventsOnJobParentWorkflow = Object.keys(
                        jobTreeItem.workflow.yaml?.on ?? {},
                    );

                    if (registeredEventsOnJobParentWorkflow.length === 0) {
                        window.showErrorMessage(
                            `No events registered on the workflow (${jobTreeItem.workflow.name}).\n` +
                                "Add an event to the `on` section of the workflow to trigger it.",
                        );
                        return;
                    }

                    const event = await window.showQuickPick(
                        registeredEventsOnJobParentWorkflow,
                        {
                            title: "Select the event to run",
                            placeHolder: "Event",
                        },
                    );

                    if (event) {
                        await act.runEvent(
                            jobTreeItem.workspaceFolder,
                            event as Event,
                            {
                                workflow: jobTreeItem.workflow,
                                job: jobTreeItem.job,
                            },
                        );
                    }
                },
            ),
        );
    }

    refresh(element?: GithubLocalActionsTreeItem) {
        this._onDidChangeTreeData.fire(element);
    }

    getTreeItem(
        element: GithubLocalActionsTreeItem,
    ): GithubLocalActionsTreeItem | Thenable<GithubLocalActionsTreeItem> {
        return element;
    }

    async resolveTreeItem(
        item: TreeItem,
        element: GithubLocalActionsTreeItem,
        token: CancellationToken,
    ): Promise<TreeItem> {
        if (element.getToolTip) {
            element.tooltip = await element.getToolTip();
        }

        return element;
    }

    async getChildren(
        element?: GithubLocalActionsTreeItem,
    ): Promise<GithubLocalActionsTreeItem[]> {
        if (element) {
            return element.getChildren();
        }

        const items: GithubLocalActionsTreeItem[] = [];
        let noWorkflows = true;

        const workspaceFolders = workspace.workspaceFolders;

        if (workspaceFolders) {
            const workflows = await act.workflowsManager.getAllWorkflows();
            noWorkflows = workflows.length === 0;

            if (workspaceFolders.length === 1) {
                const projectDirectories =
                    ConfigurationManager.getResolvedProjectDirectories(
                        workspaceFolders[0],
                    );

                items.push(
                    ...projectDirectories.map(
                        projectDirectory =>
                            new ProjectDirectoryWorkflowsTreeItem(
                                projectDirectory.workspaceFolder,
                                projectDirectory.projectDirectory,
                                projectDirectory.projectPath,
                            ),
                    ),
                );
            } else {
                for (const workspaceFolder of workspaceFolders) {
                    items.push(
                        new WorkspaceFolderWorkflowsTreeItem(workspaceFolder),
                    );
                }
            }
        }

        await commands.executeCommand(
            "setContext",
            "githubLocalActions:noWorkflows",
            noWorkflows,
        );

        return items;
    }
}