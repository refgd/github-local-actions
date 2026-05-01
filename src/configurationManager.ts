import * as path from "path";
import {
    ConfigurationTarget,
    FileType,
    Uri,
    window,
    workspace,
    WorkspaceFolder,
} from "vscode";
import { Act } from "./act";
import { WorkflowsManager } from "./workflowsManager";

export enum Platform {
    windows = "win32",
    mac = "darwin",
    linux = "linux",
}

export enum Section {
    actCommand = "actCommand",
    projectDirectory = "projectDirectory",
    dockerDesktopPath = "dockerDesktopPath",
}

export interface ResolvedProjectDirectory {
    workspaceFolder: WorkspaceFolder;
    projectDirectory: string;
    projectPath: string;
}

export namespace ConfigurationManager {
    export const group = "githubLocalActions";
    export const searchPrefix = "@ext:sanjulaganepola.github-local-actions";

    export async function initialize(): Promise<void> {
        const actCommand = get<string>(Section.actCommand);

        if (!actCommand) {
            await setGlobal(Section.actCommand, Act.defaultActCommand);
        }

        const workspaceFolders = workspace.workspaceFolders ?? [];

        for (const workspaceFolder of workspaceFolders) {
            const projectDirectories = getProjectDirectories(workspaceFolder);

            if (!projectDirectories || projectDirectories.length === 0) {
                await setProjectDirectories(
                    workspaceFolder,
                    WorkflowsManager.defaultProjectDirectories,
                );
            }
        }

        let dockerDesktopPath = get<string>(Section.dockerDesktopPath);

        if (!dockerDesktopPath) {
            switch (process.platform) {
                case Platform.windows:
                    dockerDesktopPath =
                        "C:/Program Files/Docker/Docker/Docker Desktop.exe";
                    break;
                case Platform.mac:
                    dockerDesktopPath = "/Applications/Docker.app";
                    break;
                default:
                    return;
            }

            await setGlobal(Section.dockerDesktopPath, dockerDesktopPath);
        }
    }

    export function getSearchTerm(section: Section): string {
        return `${searchPrefix} ${group}.${section}`;
    }

    export function get<T>(section: Section, scope?: Uri): T | undefined {
        return workspace.getConfiguration(group, scope).get(section) as T;
    }

    export async function setGlobal(section: Section, value: unknown): Promise<void> {
        await workspace
            .getConfiguration(group)
            .update(section, value, ConfigurationTarget.Global);
    }

    export async function setWorkspaceFolder(
        workspaceFolder: WorkspaceFolder,
        section: Section,
        value: unknown,
    ): Promise<void> {
        await workspace
            .getConfiguration(group, workspaceFolder.uri)
            .update(section, value, ConfigurationTarget.WorkspaceFolder);
    }

    /**
     * Keep this function for existing callers.
     *
     * Important:
     * - projectDirectory must NOT use this generic setter.
     * - projectDirectory should be written through setProjectDirectories(),
     *   because it is workspace-folder scoped.
     */
    export async function set(section: Section, value: unknown): Promise<void> {
        if (section === Section.projectDirectory) {
            const workspaceFolder = await pickWorkspaceFolder();

            if (!workspaceFolder) {
                return;
            }

            await setProjectDirectories(workspaceFolder, value as string[]);
            return;
        }

        await setGlobal(section, value);
    }

    export function getProjectDirectories(
        workspaceFolder: WorkspaceFolder,
    ): string[] {
        const config = workspace.getConfiguration(group, workspaceFolder.uri);
        const inspected = config.inspect<string[]>(Section.projectDirectory);

        const rawProjectDirectories =
            inspected?.workspaceFolderValue ??
            inspected?.workspaceValue ??
            WorkflowsManager.defaultProjectDirectories;

        const normalizedProjectDirectories = unique(
            rawProjectDirectories
                .map(normalizeProjectDirectory)
                .filter((value): value is string => Boolean(value)),
        );

        return normalizedProjectDirectories.length > 0
            ? normalizedProjectDirectories
            : WorkflowsManager.defaultProjectDirectories;
    }

    export async function setProjectDirectories(
        workspaceFolder: WorkspaceFolder,
        projectDirectories: string[],
    ): Promise<void> {
        const normalizedProjectDirectories = unique(
            projectDirectories
                .map(normalizeProjectDirectory)
                .filter((value): value is string => Boolean(value)),
        );

        await setWorkspaceFolder(
            workspaceFolder,
            Section.projectDirectory,
            normalizedProjectDirectories,
        );
    }

    export function getResolvedProjectDirectories(
        workspaceFolder: WorkspaceFolder,
    ): ResolvedProjectDirectory[] {
        return getProjectDirectories(workspaceFolder).map(projectDirectory => {
            return {
                workspaceFolder,
                projectDirectory,
                projectPath: resolveProjectDirectory(
                    workspaceFolder,
                    projectDirectory,
                ),
            };
        });
    }

    export function getAllResolvedProjectDirectories(): ResolvedProjectDirectory[] {
        const workspaceFolders = workspace.workspaceFolders ?? [];

        return workspaceFolders.flatMap(workspaceFolder =>
            getResolvedProjectDirectories(workspaceFolder),
        );
    }

    export function resolveProjectDirectory(
        workspaceFolder: WorkspaceFolder,
        projectDirectory: string,
    ): string {
        return path.resolve(
            workspaceFolder.uri.fsPath,
            normalizeProjectDirectory(projectDirectory) ?? ".",
        );
    }

    export function normalizeProjectDirectory(value: string): string | undefined {
        const trimmed = (value || "").trim().replace(/\\/g, "/");

        if (!trimmed || trimmed === "./") {
            return ".";
        }

        if (path.posix.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
            return undefined;
        }

        const normalized = path.posix.normalize(trimmed);

        if (normalized === ".") {
            return ".";
        }

        if (normalized === ".." || normalized.startsWith("../")) {
            return undefined;
        }

        return normalized.replace(/\/+$/g, "");
    }

    export function getWorkspaceFolderForUri(uri: Uri): WorkspaceFolder | undefined {
        const workspaceFolders = workspace.workspaceFolders ?? [];

        const matchingWorkspaceFolders = workspaceFolders
            .filter(workspaceFolder =>
                isPathInsideOrEqual(uri.fsPath, workspaceFolder.uri.fsPath),
            )
            .sort(
                (a, b) =>
                    b.uri.fsPath.length - a.uri.fsPath.length,
            );

        return matchingWorkspaceFolders[0];
    }

    export async function addProjectDirectory(uri: Uri): Promise<void> {
        const directoryUri = await toDirectoryUri(uri);
        const workspaceFolder = getWorkspaceFolderForUri(directoryUri);

        if (!workspaceFolder) {
            window.showErrorMessage(
                "Project folder must be inside one of the opened workspace folders.",
            );
            return;
        }

        const projectDirectory = toRelativeProjectDirectory(
            workspaceFolder,
            directoryUri,
        );

        if (!projectDirectory) {
            window.showErrorMessage(
                "Project folder must be inside the selected workspace folder.",
            );
            return;
        }

        const currentProjectDirectories = getProjectDirectories(workspaceFolder);

        if (currentProjectDirectories.includes(projectDirectory)) {
            window.showInformationMessage(
                `Project directory "${projectDirectory}" is already configured for "${workspaceFolder.name}".`,
            );
            return;
        }

        await setProjectDirectories(workspaceFolder, [
            ...currentProjectDirectories,
            projectDirectory,
        ]);

        window.showInformationMessage(
            `Added "${projectDirectory}" to "${workspaceFolder.name}".`,
        );
    }

    export async function removeProjectDirectory(
        workspaceFolder: WorkspaceFolder,
        projectDirectory: string,
    ): Promise<void> {
        const normalizedProjectDirectory = normalizeProjectDirectory(projectDirectory);

        if (!normalizedProjectDirectory) {
            return;
        }

        const currentProjectDirectories = getProjectDirectories(workspaceFolder);

        const nextProjectDirectories = currentProjectDirectories.filter(
            currentProjectDirectory =>
                currentProjectDirectory !== normalizedProjectDirectory,
        );

        await setProjectDirectories(workspaceFolder, nextProjectDirectories);

        window.showInformationMessage(
            `Removed "${normalizedProjectDirectory}" from "${workspaceFolder.name}".`,
        );
    }

    export function toRelativeProjectDirectory(
        workspaceFolder: WorkspaceFolder,
        uri: Uri,
    ): string | undefined {
        const relativePath = path.relative(
            workspaceFolder.uri.fsPath,
            uri.fsPath,
        );

        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            return undefined;
        }

        return normalizeProjectDirectory(relativePath || ".");
    }

    export async function pickWorkspaceFolder(): Promise<WorkspaceFolder | undefined> {
        const workspaceFolders = workspace.workspaceFolders ?? [];

        if (workspaceFolders.length === 0) {
            window.showErrorMessage("No workspace folder opened.");
            return undefined;
        }

        if (workspaceFolders.length === 1) {
            return workspaceFolders[0];
        }

        const selected = await window.showQuickPick(
            workspaceFolders.map(workspaceFolder => ({
                label: workspaceFolder.name,
                description: workspaceFolder.uri.fsPath,
                workspaceFolder,
            })),
            {
                title: "Select Workspace Folder",
                placeHolder: "Workspace Folder",
            },
        );

        return selected?.workspaceFolder;
    }

    async function toDirectoryUri(uri: Uri): Promise<Uri> {
        try {
            const stat = await workspace.fs.stat(uri);

            if (stat.type === FileType.Directory) {
                return uri;
            }
        } catch {
            // Fall through and use dirname.
        }

        return Uri.file(path.dirname(uri.fsPath));
    }

    function isPathInsideOrEqual(targetPath: string, parentPath: string): boolean {
        const relativePath = path.relative(parentPath, targetPath);

        return (
            relativePath === "" ||
            (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
        );
    }

    function unique(values: string[]): string[] {
        return [...new Set(values)];
    }
}