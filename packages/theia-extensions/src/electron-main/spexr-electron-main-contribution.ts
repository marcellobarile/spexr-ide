import { injectable } from "@theia/core/shared/inversify";
import { app, BrowserWindow, dialog, ipcMain } from "@theia/core/electron-shared/electron";
import { ElectronMainApplicationContribution } from "@theia/core/lib/electron-main/electron-main-application";

const CHANNEL_SHOW_OPEN = "ShowOpenDialog";

interface SpexrOpenDialogOptions {
  readonly path?: string;
  readonly buttonLabel?: string;
  readonly filters?: { name: string; extensions: string[] }[];
  readonly title?: string;
  readonly maxWidth?: number;
  readonly modal?: boolean;
  readonly openFiles?: boolean;
  readonly openFolders?: boolean;
  readonly selectMany?: boolean;
}

/**
 * SPEXR main-process tweaks:
 *
 * 1. Auto-opens DevTools while the IDE skeleton is under active development.
 *    Remove (or guard with an env flag) once the UI stabilizes.
 *
 * 2. Overrides Theia's `ShowOpenDialog` IPC handler to add the macOS
 *    `createDirectory` property. Without it, Finder hides the "New Folder"
 *    button and users cannot create destination folders inline (folder picker
 *    flows for "New project" and "Create spec target").
 */
@injectable()
export class SpexrElectronMainContribution implements ElectronMainApplicationContribution {
  onStart(): void {
    this.openDevToolsOnLoad();
    app.whenReady().then(() => this.overrideOpenDialogHandler());
  }

  private openDevToolsOnLoad(): void {
    app.on("browser-window-created", (_event, window) => {
      window.webContents.once("did-finish-load", () => {
        window.webContents.openDevTools({ mode: "right" });
      });
    });
  }

  private overrideOpenDialogHandler(): void {
    try {
      ipcMain.removeHandler(CHANNEL_SHOW_OPEN);
    } catch (err) {
      console.warn("[spexr] could not remove default ShowOpenDialog handler", err);
    }
    ipcMain.handle(
      CHANNEL_SHOW_OPEN,
      async (event, options: SpexrOpenDialogOptions): Promise<string[]> => {
        const dialogOpts: Electron.OpenDialogOptions = {
          properties: this.toProperties(options),
        };
        if (options.path !== undefined) dialogOpts.defaultPath = options.path;
        if (options.buttonLabel !== undefined) dialogOpts.buttonLabel = options.buttonLabel;
        if (options.filters !== undefined) dialogOpts.filters = options.filters;
        if (options.title !== undefined) dialogOpts.title = options.title;
        if (options.modal) {
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win) {
            const result = await dialog.showOpenDialog(win, dialogOpts);
            return result.filePaths;
          }
        }
        const result = await dialog.showOpenDialog(dialogOpts);
        return result.filePaths;
      },
    );
  }

  private toProperties(options: SpexrOpenDialogOptions): Array<
    | "openFile"
    | "openDirectory"
    | "multiSelections"
    | "createDirectory"
    | "showHiddenFiles"
  > {
    const properties: Array<
      | "openFile"
      | "openDirectory"
      | "multiSelections"
      | "createDirectory"
      | "showHiddenFiles"
    > = [];
    if (options.openFiles) properties.push("openFile");
    if (options.openFolders) {
      properties.push("openDirectory");
      properties.push("createDirectory");
    }
    if (options.selectMany === true) properties.push("multiSelections");
    return properties;
  }
}
