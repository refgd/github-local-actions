import {
    commands,
    Disposable,
    env,
    ExtensionContext,
    FileSystemWatcher,
    RelativePattern,
    TreeCheckboxChangeEvent,
    Uri,
    window,
    workspace,
    WorkspaceFolder,
} from "vscode";
import { Act } from "./act";
import {
    ConfigurationManager,
    ResolvedProjectDirectory,
    Section,
} from "./configurationManager";
import ComponentsTreeDataProvider from "./views/components/componentsTreeDataProvider";
import { DecorationProvider } from "./views/decorationProvider";
import HistoryTreeDataProvider from "./views/history/historyTreeDataProvider";
import SettingsTreeDataProvider from "./views/settings/settingsTreeDataProvider";
import WorkflowsTreeDataProvider from "./views/workflows/workflowsTreeDataProvider";
import { WorkflowsManager } from "./workflowsManager";

export let act: Act;
export let componentsTreeDataProvider: ComponentsTreeDataProvider;
export let workflowsTreeDataProvider: WorkflowsTreeDataProvider;
export let historyTreeDataProvider: HistoryTreeDataProvider;
export let settingsTreeDataProvider: SettingsTreeDataProvider;

export function activate(context: ExtensionContext) {
    console.log(
        'Congratulations, your extension "github-local-actions" is now active!',
    );

    act = new Act(context);

    const decorationProvider = new DecorationProvider();

    componentsTreeDataProvider = new ComponentsTreeDataProvider(context);
    const componentsTreeView = window.createTreeView(
        ComponentsTreeDataProvider.VIEW_ID,
        {
            treeDataProvider: componentsTreeDataProvider,
            showCollapseAll: true,
        },
    );

    workflowsTreeDataProvider = new WorkflowsTreeDataProvider(context);
    const workflowsTreeView = window.createTreeView(
        WorkflowsTreeDataProvider.VIEW_ID,
        {
            treeDataProvider: workflowsTreeDataProvider,
            showCollapseAll: true,
        },
    );

    historyTreeDataProvider = new HistoryTreeDataProvider(context);
    const historyTreeView = window.createTreeView(
        HistoryTreeDataProvider.VIEW_ID,
        {
            treeDataProvider: historyTreeDataProvider,
            showCollapseAll: true,
        },
    );

    settingsTreeDataProvider = new SettingsTreeDataProvider(context);
    const settingsTreeView = window.createTreeView(
        SettingsTreeDataProvider.VIEW_ID,
        {
            treeDataProvider: settingsTreeDataProvider,
            showCollapseAll: true,
        },
    );

    settingsTreeView.onDidChangeCheckboxState(
        async (event: TreeCheckboxChangeEvent<any>) => {
            await settingsTreeDataProvider.onDidChangeCheckboxState(event);
        },
    );

    let workflowsFileWatchers = setupFileWatchers();

    void ConfigurationManager.initialize();

    workspace.onDidChangeConfiguration(async event => {
        if (event.affectsConfiguration(ConfigurationManager.group)) {
            await ConfigurationManager.initialize();

            if (
                event.affectsConfiguration(
                    `${ConfigurationManager.group}.${Section.actCommand}`,
                ) ||
                event.affectsConfiguration(
                    `${ConfigurationManager.group}.${Section.dockerDesktopPath}`,
                )
            ) {
                componentsTreeDataProvider.refresh();
            }

            if (
                event.affectsConfiguration(
                    `${ConfigurationManager.group}.${Section.projectDirectory}`,
                )
            ) {
                workflowsTreeDataProvider.refresh();
                settingsTreeDataProvider.refresh();
                historyTreeDataProvider.refresh();

                workflowsFileWatchers.dispose();
                workflowsFileWatchers = setupFileWatchers();
                context.subscriptions.push(workflowsFileWatchers);
            }
        }
    });

    workspace.onDidChangeWorkspaceFolders(async () => {
        await ConfigurationManager.initialize();

        workflowsTreeDataProvider.refresh();
        settingsTreeDataProvider.refresh();
        historyTreeDataProvider.refresh();

        workflowsFileWatchers.dispose();
        workflowsFileWatchers = setupFileWatchers();
        context.subscriptions.push(workflowsFileWatchers);
    });

    context.subscriptions.push(
        componentsTreeView,
        workflowsTreeView,
        historyTreeView,
        settingsTreeView,
        window.registerFileDecorationProvider(decorationProvider),
        workflowsFileWatchers,

        commands.registerCommand(
            "githubLocalActions.addFolderToLocalProject",
            async (uri?: Uri) => {
                const folderUri = uri ?? (await pickFolderUri());

                if (!folderUri) {
                    return;
                }

                await ConfigurationManager.addProjectDirectory(folderUri);

                workflowsTreeDataProvider.refresh();
                settingsTreeDataProvider.refresh();
                historyTreeDataProvider.refresh();

                workflowsFileWatchers.dispose();
                workflowsFileWatchers = setupFileWatchers();
                context.subscriptions.push(workflowsFileWatchers);
            },
        ),

        commands.registerCommand(
            "githubLocalActions.removeFolderFromLocalProject",
            async (
                item?:
                    | Uri
                    | {
                          workspaceFolder: WorkspaceFolder;
                          projectDirectory: string;
                      },
            ) => {
                const targetProjectDirectory =
                    await resolveProjectDirectoryToRemove(item);

                if (!targetProjectDirectory) {
                    return;
                }

                await ConfigurationManager.removeProjectDirectory(
                    targetProjectDirectory.workspaceFolder,
                    targetProjectDirectory.projectDirectory,
                );

                workflowsTreeDataProvider.refresh();
                settingsTreeDataProvider.refresh();
                historyTreeDataProvider.refresh();

                workflowsFileWatchers.dispose();
                workflowsFileWatchers = setupFileWatchers();
                context.subscriptions.push(workflowsFileWatchers);
            },
        ),

        commands.registerCommand("githubLocalActions.viewDocumentation", async () => {
            await env.openExternal(
                Uri.parse(
                    "https://sanjulaganepola.github.io/github-local-actions-docs",
                ),
            );
        }),
    );
}

function setupFileWatchers(): Disposable {
    const watchers: FileSystemWatcher[] = [];

    const refresh = () => {
        workflowsTreeDataProvider.refresh();
        settingsTreeDataProvider.refresh();
    };

    for (const projectDirectory of ConfigurationManager.getAllResolvedProjectDirectories()) {
        const projectDirectoryPrefix =
            projectDirectory.projectDirectory === "."
                ? ""
                : `${projectDirectory.projectDirectory}/`;

        const pattern = new RelativePattern(
            projectDirectory.workspaceFolder,
            `${projectDirectoryPrefix}${WorkflowsManager.defaultWorkflowsDirectory}/*.{${WorkflowsManager.ymlExtension},${WorkflowsManager.yamlExtension}}`,
        );

        const watcher = workspace.createFileSystemWatcher(pattern);

        watcher.onDidCreate(refresh);
        watcher.onDidChange(refresh);
        watcher.onDidDelete(refresh);

        watchers.push(watcher);
    }

    return Disposable.from(...watchers);
}

async function pickFolderUri(): Promise<Uri | undefined> {
    const selected = await window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Add to Local Project",
    });

    return selected?.[0];
}

async function resolveProjectDirectoryToRemove(
    item?:
        | Uri
        | {
              workspaceFolder: WorkspaceFolder;
              projectDirectory: string;
          },
): Promise<ResolvedProjectDirectory | undefined> {
    if (item instanceof Uri) {
        const workspaceFolder = ConfigurationManager.getWorkspaceFolderForUri(item);

        if (!workspaceFolder) {
            window.showErrorMessage(
                "Project folder must be inside one of the opened workspace folders.",
            );
            return undefined;
        }

        const projectDirectory = ConfigurationManager.toRelativeProjectDirectory(
            workspaceFolder,
            item,
        );

        if (!projectDirectory) {
            return undefined;
        }

        return {
            workspaceFolder,
            projectDirectory,
            projectPath: ConfigurationManager.resolveProjectDirectory(
                workspaceFolder,
                projectDirectory,
            ),
        };
    }

    if (
        item &&
        "workspaceFolder" in item &&
        "projectDirectory" in item &&
        item.workspaceFolder &&
        item.projectDirectory
    ) {
        return {
            workspaceFolder: item.workspaceFolder,
            projectDirectory: item.projectDirectory,
            projectPath: ConfigurationManager.resolveProjectDirectory(
                item.workspaceFolder,
                item.projectDirectory,
            ),
        };
    }

    const projectDirectories =
        ConfigurationManager.getAllResolvedProjectDirectories();

    if (projectDirectories.length === 0) {
        window.showInformationMessage("No project directories configured.");
        return undefined;
    }

    const selected = await window.showQuickPick(
        projectDirectories.map(projectDirectory => ({
            label: projectDirectory.projectDirectory,
            description: projectDirectory.workspaceFolder.name,
            detail: projectDirectory.projectPath,
            projectDirectory,
        })),
        {
            title: "Remove from Local Project",
            placeHolder: "Project Directory",
        },
    );

    return selected?.projectDirectory;
}

export function deactivate() {}