import { ExtensionContext, WorkspaceFolder } from "vscode";
import { StorageKey } from "./storageManager";

export class SecretManager {
    private context: ExtensionContext;
    private extensionKey: string = 'githubLocalActions';
    private cache = new Map<string, string | undefined>();
    private pendingGets = new Map<string, Promise<string | undefined>>();

    constructor(context: ExtensionContext) {
        this.context = context;
    }

    async get(workspaceFolder: WorkspaceFolder, storageKey: StorageKey, key: string): Promise<string | undefined> {
        const secretKey = this.getSecretKey(workspaceFolder, storageKey, key);

        if (this.cache.has(secretKey)) {
            return this.cache.get(secretKey);
        }

        const pending = this.pendingGets.get(secretKey);
        if (pending) {
            return pending;
        }

        const getPromise = Promise.resolve(this.context.secrets.get(secretKey))
                .then(value => {
                    this.cache.set(secretKey, value);
                    return value;
                })
                .finally(() => {
                    this.pendingGets.delete(secretKey);
                });

        this.pendingGets.set(secretKey, getPromise);
        return getPromise;
    }

    async store(workspaceFolder: WorkspaceFolder, storageKey: StorageKey, key: string, value: string): Promise<void> {
        const secretKey = this.getSecretKey(workspaceFolder, storageKey, key);
        await this.context.secrets.store(secretKey, value);
        this.cache.set(secretKey, value);
        this.pendingGets.delete(secretKey);
    }

    async delete(workspaceFolder: WorkspaceFolder, storageKey: StorageKey, key: string): Promise<void> {
        const secretKey = this.getSecretKey(workspaceFolder, storageKey, key);
        await this.context.secrets.delete(secretKey);
        this.cache.delete(secretKey);
        this.pendingGets.delete(secretKey);
    }

    clearCache(): void {
        this.cache.clear();
        this.pendingGets.clear();
    }

    private getSecretKey(workspaceFolder: WorkspaceFolder, storageKey: StorageKey, key: string): string {
        return `${this.extensionKey}.${workspaceFolder.uri.fsPath}.${storageKey}.${key}`;
    }
}
