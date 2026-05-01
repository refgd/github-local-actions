import { ExtensionContext, Uri, workspace } from "vscode";

export enum StorageKey {
    WorkspaceHistory = 'workspaceHistory',
    Secrets = 'secrets',
    SecretFiles = 'secretFiles',
    Variables = 'variables',
    VariableFiles = 'variableFiles',
    Inputs = 'inputs',
    InputFiles = 'inputFiles',
    Runners = 'runners',
    PayloadFiles = 'payloadFiles',
    Options = 'options'
}

export class StorageManager {
    private context: ExtensionContext;
    private extensionKey: string = 'githubLocalActions';
    private storageDirectoryPromise?: Promise<Uri>;
    private cache = new Map<StorageKey, unknown>();
    private pendingReads = new Map<StorageKey, Promise<unknown>>();

    constructor(context: ExtensionContext) {
        this.context = context;
    }

    private async getStorageDirectory(): Promise<Uri> {
        if (!this.storageDirectoryPromise) {
            this.storageDirectoryPromise = (async () => {
                const storageDirectory = Uri.joinPath(this.context.storageUri ?? this.context.globalStorageUri, "storageManager");
                await workspace.fs.createDirectory(storageDirectory).then(undefined, () => void 0);
                return storageDirectory;
            })();
        }

        return this.storageDirectoryPromise;
    }

    private async getStorageFile(storageKey: StorageKey): Promise<Uri> {
        const storageDirectory = await this.getStorageDirectory();
        return Uri.joinPath(storageDirectory, `${storageKey}.json`);
    }

    async get<T>(storageKey: StorageKey): Promise<T | undefined> {
        if (this.cache.has(storageKey)) {
            return this.cache.get(storageKey) as T;
        }

        const pending = this.pendingReads.get(storageKey);
        if (pending) {
            return pending as Promise<T | undefined>;
        }

        const readPromise = this.read<T>(storageKey)
            .then(value => {
                if (value !== undefined) {
                    this.cache.set(storageKey, value);
                }
                return value;
            })
            .finally(() => {
                this.pendingReads.delete(storageKey);
            });

        this.pendingReads.set(storageKey, readPromise);
        return readPromise;
    }

    async update(storageKey: StorageKey, value: any): Promise<void> {
        this.cache.set(storageKey, value);
        this.pendingReads.delete(storageKey);

        if ([StorageKey.Secrets, StorageKey.SecretFiles].includes(storageKey)) {
            await this.context.globalState.update(`${this.extensionKey}.${storageKey}`, value);
            return;
        }

        const data = JSON.stringify(value, null, 2);
        const storageFile = await this.getStorageFile(storageKey);
        await workspace.fs.writeFile(storageFile, Buffer.from(data));
    }

    clearCache(storageKey?: StorageKey): void {
        if (storageKey) {
            this.cache.delete(storageKey);
            this.pendingReads.delete(storageKey);
            return;
        }

        this.cache.clear();
        this.pendingReads.clear();
    }

    private async read<T>(storageKey: StorageKey): Promise<T | undefined> {
        if ([StorageKey.Secrets, StorageKey.SecretFiles].includes(storageKey)) {
            return this.context.globalState.get<T>(`${this.extensionKey}.${storageKey}`);
        }

        const storageFile = await this.getStorageFile(storageKey);
        return workspace.fs.readFile(storageFile).then(data => {
            if (data) {
                return JSON.parse(data.toString()) as T;
            }
            return undefined;
        }, (error) => {
            if (error?.code === 'FileNotFound') {
                return undefined;
            }
            throw error;
        });
    }
}
