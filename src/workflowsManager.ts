import * as path from "path";
import { Uri, workspace, WorkspaceFolder } from "vscode";
import * as yaml from "yaml";
import {
    ConfigurationManager,
    ResolvedProjectDirectory,
} from "./configurationManager";

export interface Workflow {
    name: string;
    uri: Uri;
    projectPath: string;
    projectDirectory: string;
    workspaceFolder: WorkspaceFolder;
    fileContent?: string;
    yaml?: any;
    error?: string;
}

export interface Job {
    name: string;
    id: string;
}

export class WorkflowsManager {
    static defaultWorkflowsDirectory = ".github/workflows";
    static defaultProjectDirectories = ["."];
    static yamlExtension = "yaml";
    static ymlExtension = "yml";

    static getProjectDirectories(workspaceFolder: WorkspaceFolder): string[] {
        return ConfigurationManager.getProjectDirectories(workspaceFolder);
    }

    async getWorkflows(workspaceFolder: WorkspaceFolder): Promise<Workflow[]> {
        const projectDirectories =
            ConfigurationManager.getResolvedProjectDirectories(workspaceFolder);

        const workflowsByProjectDirectory = await Promise.all(
            projectDirectories.map(projectDirectory =>
                this.getWorkflowsForResolvedProjectDirectory(projectDirectory),
            ),
        );

        return workflowsByProjectDirectory.flat();
    }

    async getAllWorkflows(): Promise<Workflow[]> {
        const workspaceFolders = workspace.workspaceFolders ?? [];

        const workflowsByWorkspaceFolder = await Promise.all(
            workspaceFolders.map(workspaceFolder =>
                this.getWorkflows(workspaceFolder),
            ),
        );

        return workflowsByWorkspaceFolder.flat();
    }

    async getWorkflowsForProjectDirectory(
        workspaceFolder: WorkspaceFolder,
        projectDirectory: string,
    ): Promise<Workflow[]> {
        const normalizedProjectDirectory =
            ConfigurationManager.normalizeProjectDirectory(projectDirectory) ?? ".";

        return this.getWorkflowsForResolvedProjectDirectory({
            workspaceFolder,
            projectDirectory: normalizedProjectDirectory,
            projectPath: ConfigurationManager.resolveProjectDirectory(
                workspaceFolder,
                normalizedProjectDirectory,
            ),
        });
    }

    async findWorkflowByUri(
        uri: Uri,
    ): Promise<{ workspaceFolder: WorkspaceFolder; workflow: Workflow } | undefined> {
        const workspaceFolder = ConfigurationManager.getWorkspaceFolderForUri(uri);

        if (!workspaceFolder) {
            return undefined;
        }

        const workflows = await this.getWorkflows(workspaceFolder);
        const workflow = workflows.find(item => item.uri.fsPath === uri.fsPath);

        if (!workflow) {
            return undefined;
        }

        return {
            workspaceFolder,
            workflow,
        };
    }

    private async getWorkflowsForResolvedProjectDirectory(
        resolvedProjectDirectory: ResolvedProjectDirectory,
    ): Promise<Workflow[]> {
        const workflowsDirectoryUri = Uri.file(
            path.join(
                resolvedProjectDirectory.projectPath,
                WorkflowsManager.defaultWorkflowsDirectory,
            ),
        );

        let workflowFileNames: string[];

        try {
            const directoryEntries =
                await workspace.fs.readDirectory(workflowsDirectoryUri);

            workflowFileNames = directoryEntries
                .filter(([fileName, fileType]) => {
                    const extension = path
                        .extname(fileName)
                        .replace(".", "")
                        .toLowerCase();

                    return (
                        fileType === 1 &&
                        [
                            WorkflowsManager.yamlExtension,
                            WorkflowsManager.ymlExtension,
                        ].includes(extension)
                    );
                })
                .map(([fileName]) => fileName);
        } catch {
            return [];
        }

        const workflows = await Promise.all(
            workflowFileNames.map(fileName =>
                this.readWorkflowFile(resolvedProjectDirectory, fileName),
            ),
        );

        return workflows;
    }

    private async readWorkflowFile(
        resolvedProjectDirectory: ResolvedProjectDirectory,
        fileName: string,
    ): Promise<Workflow> {
        const workflowFileUri = Uri.file(
            path.join(
                resolvedProjectDirectory.projectPath,
                WorkflowsManager.defaultWorkflowsDirectory,
                fileName,
            ),
        );

        let fileContent: string | undefined;
        let parsedYaml: any | undefined;

        try {
            const bytes = await workspace.fs.readFile(workflowFileUri);
            fileContent = Buffer.from(bytes).toString("utf8");
            parsedYaml = yaml.parse(fileContent);

            return {
                name:
                    parsedYaml?.name ||
                    path.parse(workflowFileUri.fsPath).name,
                uri: workflowFileUri,
                projectPath: resolvedProjectDirectory.projectPath,
                projectDirectory: resolvedProjectDirectory.projectDirectory,
                workspaceFolder: resolvedProjectDirectory.workspaceFolder,
                fileContent,
                yaml: parsedYaml,
            };
        } catch {
            return {
                name:
                    parsedYaml?.name ||
                    path.parse(workflowFileUri.fsPath).name,
                uri: workflowFileUri,
                projectPath: resolvedProjectDirectory.projectPath,
                projectDirectory: resolvedProjectDirectory.projectDirectory,
                workspaceFolder: resolvedProjectDirectory.workspaceFolder,
                fileContent,
                yaml: parsedYaml,
                error: "Failed to parse workflow",
            };
        }
    }
}