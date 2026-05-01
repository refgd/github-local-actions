import * as path from "path";
import { Uri, window, workspace, WorkspaceFolder } from "vscode";
import { act } from "./extension";
import { GitHubManager } from "./githubManager";
import { SecretManager } from "./secretManager";
import { StorageKey, StorageManager } from "./storageManager";
import { Workflow } from "./workflowsManager";

export interface Settings {
    secrets: Setting[];
    secretFiles: CustomSetting[];
    variables: Setting[];
    variableFiles: CustomSetting[];
    inputs: Setting[];
    inputFiles: CustomSetting[];
    runners: Setting[];
    payloadFiles: CustomSetting[];
    options: CustomSetting[];
    // environments: Setting[];
}

export interface Setting {
    key: string,
    value: string,
    password: boolean,
    selected: boolean,
    visible: Visibility,
    mode: Mode
}

// This is either a secret/variable/input/payload file or an option
export interface CustomSetting {
    name: string,
    path: string,
    selected: boolean,
    notEditable?: boolean,
    default?: string,
    description?: string,
}

export enum Visibility {
    show = 'show',
    hide = 'hide'
}

export enum Mode {
    generate = 'generate',
    manual = 'manual'
}

export enum SettingFileName {
    secretFile = '.secrets',
    envFile = '.env',
    variableFile = '.vars',
    inputFile = '.input',
    payloadFile = 'payload.json'
}

export class SettingsManager {
    storageManager: StorageManager;
    secretManager: SecretManager;
    githubManager: GitHubManager;

    static secretsRegExp: RegExp = /\${{\s*secrets\.(.*?)\s*}}/g;
    static variablesRegExp: RegExp = /\${{\s*vars\.(.*?)(?:\s*==\s*(.*?))?\s*}}/g;
    static inputsRegExp: RegExp = /\${{\s*(?:inputs|github\.event\.inputs)\.(.*?)(?:\s*==\s*(.*?))?\s*}}/g;
    static runnersRegExp: RegExp = /runs-on:\s*(.+)/g;

    constructor(storageManager: StorageManager, secretManager: SecretManager) {
        this.storageManager = storageManager;
        this.secretManager = secretManager;
        this.githubManager = new GitHubManager();
    }

    async getSettings(workspaceFolder: WorkspaceFolder, isUserSelected: boolean): Promise<Settings> {
        const defaultSecrets: Setting[] = [
            {
                key: 'GITHUB_TOKEN',
                value: '',
                password: true,
                selected: false,
                visible: Visibility.hide,
                mode: Mode.manual
            }
        ];

        // 关键优化：workflow 只加载一次；其它 storage 读取并行执行。
        const workflows = await act.workflowsManager.getWorkflows(workspaceFolder);

        const [
            secrets,
            secretFiles,
            variables,
            variableFiles,
            inputs,
            inputFiles,
            runners,
            payloadFiles,
            options,
        ] = await Promise.all([
            this.getSetting(workspaceFolder, workflows, SettingsManager.secretsRegExp, StorageKey.Secrets, true, Visibility.hide, defaultSecrets),
            this.getCustomSettings(workspaceFolder, StorageKey.SecretFiles),
            this.getSetting(workspaceFolder, workflows, SettingsManager.variablesRegExp, StorageKey.Variables, false, Visibility.show),
            this.getCustomSettings(workspaceFolder, StorageKey.VariableFiles),
            this.getSetting(workspaceFolder, workflows, SettingsManager.inputsRegExp, StorageKey.Inputs, false, Visibility.show),
            this.getCustomSettings(workspaceFolder, StorageKey.InputFiles),
            this.getSetting(workspaceFolder, workflows, SettingsManager.runnersRegExp, StorageKey.Runners, false, Visibility.show),
            this.getCustomSettings(workspaceFolder, StorageKey.PayloadFiles),
            this.getCustomSettings(workspaceFolder, StorageKey.Options),
        ]);

        return {
            secrets: secrets.filter(secret => !isUserSelected || (secret.selected && (secret.value || secret.mode === Mode.generate))),
            secretFiles: secretFiles.filter(secretFile => !isUserSelected || secretFile.selected),
            variables: variables.filter(variable => !isUserSelected || (variable.selected && variable.value)),
            variableFiles: variableFiles.filter(variableFile => !isUserSelected || variableFile.selected),
            inputs: inputs.filter(input => !isUserSelected || (input.selected && input.value)),
            inputFiles: inputFiles.filter(inputFile => !isUserSelected || inputFile.selected),
            runners: runners.filter(runner => !isUserSelected || (runner.selected && runner.value)),
            payloadFiles: payloadFiles.filter(payloadFile => !isUserSelected || payloadFile.selected),
            options: options.filter(option => !isUserSelected || (option.selected && (option.path || option.notEditable))),
            // environments: await this.getEnvironments(workspaceFolder, workflows)
        };
    }

    async getSetting(
        workspaceFolder: WorkspaceFolder,
        workflows: Workflow[],
        regExp: RegExp,
        storageKey: StorageKey,
        password: boolean,
        visible: Visibility,
        defaultSettings: Setting[] = []
    ): Promise<Setting[]> {
        const settings = this.dedupeSettings([
            ...defaultSettings.map(setting => ({ ...setting })),
            ...this.findSettingsInWorkflows(workflows, regExp, password, visible),
        ]);

        const existingSettings = await this.storageManager.get<{ [path: string]: Setting[] }>(storageKey) || {};
        const workspaceSettings = existingSettings[workspaceFolder.uri.fsPath] || [];

        if (workspaceSettings.length === 0) {
            return settings;
        }

        // 只对当前已发现的 setting 做 merge，不在读取时写回 storage，避免 refresh 触发写放大。
        return Promise.all(settings.map(async setting => {
            const existingSetting = workspaceSettings.find(item => item.key === setting.key);
            if (!existingSetting) {
                return setting;
            }

            const value = storageKey === StorageKey.Secrets
                ? await this.secretManager.get(workspaceFolder, storageKey, setting.key) || ''
                : existingSetting.value;

            return {
                key: setting.key,
                value,
                password: existingSetting.password,
                selected: existingSetting.selected,
                visible: existingSetting.visible,
                mode: existingSetting.mode || Mode.manual,
            };
        }));
    }

    async getCustomSettings(workspaceFolder: WorkspaceFolder, storageKey: StorageKey): Promise<CustomSetting[]> {
        const existingCustomSettings = await this.storageManager.get<{ [path: string]: CustomSetting[] }>(storageKey) || {};
        return existingCustomSettings[workspaceFolder.uri.fsPath] || [];
    }

    async getEnvironments(workspaceFolder: WorkspaceFolder, workflows?: Workflow[]): Promise<Setting[]> {
        const environments: Setting[] = [];
        const resolvedWorkflows = workflows || await act.workflowsManager.getWorkflows(workspaceFolder);

        for (const workflow of resolvedWorkflows) {
            if (!workflow.yaml) {
                continue;
            }

            const jobs = workflow.yaml?.jobs;
            if (jobs) {
                for (const details of Object.values<any>(jobs)) {
                    if (details.environment) {
                        const existingEnvironment = environments.find(environment => environment.key === details.environment);
                        if (!existingEnvironment) {
                            environments.push({
                                key: details.environment,
                                value: '',
                                password: false,
                                selected: false,
                                visible: Visibility.show,
                                mode: Mode.manual
                            });
                        }
                    }
                }
            }
        }

        return environments;
    }

    async createSettingFile(workspaceFolder: WorkspaceFolder, storageKey: StorageKey, settingFileName: string, content: string) {
        const settingFileUri = Uri.file(path.join(workspaceFolder.uri.fsPath, settingFileName));

        try {
            await workspace.fs.stat(settingFileUri);
            window.showErrorMessage(`A file or folder named ${settingFileName} already exists at ${workspaceFolder.uri.fsPath}. Please choose another name.`);
        } catch (error: any) {
            try {
                await workspace.fs.writeFile(settingFileUri, new TextEncoder().encode(content));
                await this.locateSettingFile(workspaceFolder, storageKey, [settingFileUri]);
                const document = await workspace.openTextDocument(settingFileUri);
                await window.showTextDocument(document);
            } catch (error: any) {
                window.showErrorMessage(`Failed to create ${settingFileName}. Error: ${error}`);
            }
        }
    }

    async locateSettingFile(workspaceFolder: WorkspaceFolder, storageKey: StorageKey, settingFilesUris: Uri[]) {
        const settingFilesPaths = (await act.settingsManager.getCustomSettings(workspaceFolder, storageKey)).map(settingFile => settingFile.path);
        const existingSettingFileNames: string[] = [];

        for (const uri of settingFilesUris) {
            const settingFileName = path.parse(uri.fsPath).name;

            if (settingFilesPaths.includes(uri.fsPath)) {
                existingSettingFileNames.push(settingFileName);
            } else {
                const newSettingFile: CustomSetting = {
                    name: path.parse(uri.fsPath).base,
                    path: uri.fsPath,
                    selected: false
                };
                await act.settingsManager.editCustomSetting(workspaceFolder, newSettingFile, storageKey);
            }
        }

        if (existingSettingFileNames.length > 0) {
            window.showErrorMessage(`The following file(s) have already been added: ${existingSettingFileNames.join(', ')}`);
        }
    }

    async editCustomSetting(workspaceFolder: WorkspaceFolder, newCustomSetting: CustomSetting, storageKey: StorageKey, forceAppend: boolean = false) {
        const existingCustomSettings = await this.storageManager.get<{ [path: string]: CustomSetting[] }>(storageKey) || {};
        if (existingCustomSettings[workspaceFolder.uri.fsPath]) {
            const index = existingCustomSettings[workspaceFolder.uri.fsPath]
                .findIndex(customSetting =>
                    storageKey === StorageKey.Options ?
                        customSetting.name === newCustomSetting.name :
                        customSetting.path === newCustomSetting.path
                );
            if (index > -1 && !forceAppend) {
                existingCustomSettings[workspaceFolder.uri.fsPath][index] = newCustomSetting;
            } else {
                existingCustomSettings[workspaceFolder.uri.fsPath].push(newCustomSetting);
            }
        } else {
            existingCustomSettings[workspaceFolder.uri.fsPath] = [newCustomSetting];
        }

        await this.storageManager.update(storageKey, existingCustomSettings);
    }

    async removeCustomSetting(workspaceFolder: WorkspaceFolder, existingCustomSetting: CustomSetting, storageKey: StorageKey) {
        const existingCustomSettings = await this.storageManager.get<{ [path: string]: CustomSetting[] }>(storageKey) || {};
        if (existingCustomSettings[workspaceFolder.uri.fsPath]) {
            const index = existingCustomSettings[workspaceFolder.uri.fsPath].findIndex(customSetting =>
                storageKey === StorageKey.Options ?
                    (customSetting.name === existingCustomSetting.name && customSetting.path === existingCustomSetting.path) :
                    customSetting.path === existingCustomSetting.path
            );
            if (index > -1) {
                existingCustomSettings[workspaceFolder.uri.fsPath].splice(index, 1);
            }
        }

        await this.storageManager.update(storageKey, existingCustomSettings);
    }

    async deleteSettingFile(workspaceFolder: WorkspaceFolder, settingFile: CustomSetting, storageKey: StorageKey) {
        try {
            await workspace.fs.delete(Uri.file(settingFile.path));
        } catch (error: any) {
            try {
                await workspace.fs.stat(Uri.file(settingFile.path));
                window.showErrorMessage(`Failed to delete file. Error ${error}`);
                return;
            } catch (error: any) { }
        }

        await this.removeCustomSetting(workspaceFolder, settingFile, storageKey);
    }

    async editSetting(workspaceFolder: WorkspaceFolder, newSetting: Setting, storageKey: StorageKey) {
        const value = newSetting.value;
        const settingToStore: Setting = { ...newSetting };

        if (storageKey === StorageKey.Secrets) {
            // secret 值只进 SecretStorage，不写入普通 storage。
            settingToStore.value = '';
        }

        const existingSettings = await this.storageManager.get<{ [path: string]: Setting[] }>(storageKey) || {};
        if (existingSettings[workspaceFolder.uri.fsPath]) {
            const index = existingSettings[workspaceFolder.uri.fsPath].findIndex(setting => setting.key === settingToStore.key);
            if (index > -1) {
                existingSettings[workspaceFolder.uri.fsPath][index] = settingToStore;
            } else {
                existingSettings[workspaceFolder.uri.fsPath].push(settingToStore);
            }
        } else {
            existingSettings[workspaceFolder.uri.fsPath] = [settingToStore];
        }

        await this.storageManager.update(storageKey, existingSettings);
        if (storageKey === StorageKey.Secrets) {
            if (value === '') {
                await this.secretManager.delete(workspaceFolder, storageKey, settingToStore.key);
            } else {
                await this.secretManager.store(workspaceFolder, storageKey, settingToStore.key, value);
            }
        }
    }

    private findSettingsInWorkflows(workflows: Workflow[], regExp: RegExp, password: boolean, visible: Visibility): Setting[] {
        const settings: Setting[] = [];

        for (const workflow of workflows) {
            if (!workflow.fileContent) {
                continue;
            }

            settings.push(...this.findInWorkflow(workflow.fileContent, regExp, password, visible));
        }

        return settings;
    }

    private dedupeSettings(settings: Setting[]): Setting[] {
        const seen = new Set<string>();
        const result: Setting[] = [];

        for (const setting of settings) {
            if (seen.has(setting.key)) {
                continue;
            }

            seen.add(setting.key);
            result.push(setting);
        }

        return result;
    }

    private findInWorkflow(content: string, regExp: RegExp, password: boolean, visible: Visibility): Setting[] {
        const results: Setting[] = [];

        // RegExp 是 static 单例，matchAll 会读取 lastIndex；这里复制一份，避免并发/重复调用状态污染。
        const safeRegExp = new RegExp(regExp.source, regExp.flags);
        const matches = content.matchAll(safeRegExp);

        for (const match of matches) {
            if (!match[1]) {
                continue;
            }

            results.push({
                key: match[1].trim(),
                value: '',
                password,
                selected: false,
                visible,
                mode: Mode.manual
            });
        }

        return results;
    }
}
