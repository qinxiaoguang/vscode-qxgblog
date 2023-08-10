import * as vscode from 'vscode'
import path = require('path')

export class GlobalCtx {
    private _extensionContext: vscode.ExtensionContext | null = null

    get extCtx(): vscode.ExtensionContext {
        if (this._extensionContext == null) throw Error('extension context not exist')
        return this._extensionContext
    }

    set extCtx(v: vscode.ExtensionContext) {
        this._extensionContext = v
    }
}

export const globalCtx = new GlobalCtx()
