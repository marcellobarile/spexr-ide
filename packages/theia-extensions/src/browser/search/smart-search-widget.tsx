import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import URI from "@theia/core/lib/common/uri";
import { CommandService } from "@theia/core/lib/common/command";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import type { SearchHit, IndexStatus, SpexrSearchService } from "../../common/search-protocol.js";
import { SpexrSearchServiceProxy } from "./smart-search-service.js";
import { formatScore, statusLabel, debounce } from "./smart-search-format.js";

/** Search input + ranked results, shown above the file-tree navigator. */
@injectable()
export class SmartSearchWidget extends ReactWidget {
  static readonly ID = "spexr.view.smart-search";

  @inject(SpexrSearchServiceProxy)
  private readonly service!: SpexrSearchService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(OpenerService)
  private readonly openerService!: OpenerService;

  @inject(CommandService)
  private readonly commands!: CommandService;

  private query = "";
  private hits: SearchHit[] = [];
  private status: IndexStatus = { state: "idle", indexed: 0, total: 0 };
  private statusTimer?: ReturnType<typeof setInterval>;

  private readonly runSearch = debounce((q: string) => void this.doSearch(q), 250);

  @postConstruct()
  protected init(): void {
    this.id = SmartSearchWidget.ID;
    this.title.label = "Search";
    this.title.caption = "Smart Search";
    this.title.closable = false;
    this.addClass("spexr-smart-search");
    this.pollStatus();
    this.update();
  }

  private root(): string | undefined {
    return this.workspace.tryGetRoots()[0]?.resource.toString();
  }

  private pollStatus(): void {
    const tick = async (): Promise<void> => {
      const root = this.root();
      if (!root) return;
      this.status = await this.service.getIndexStatus(root);
      this.update();
    };
    void tick();
    this.statusTimer = setInterval(() => void tick(), 1000);
  }

  override dispose(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.runSearch.cancel();
    super.dispose();
  }

  private async doSearch(q: string): Promise<void> {
    const root = this.root();
    if (!root || q.trim().length === 0) {
      this.hits = [];
      this.update();
      return;
    }
    this.hits = await this.service.search(root, q);
    this.update();
  }

  private onInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.query = e.target.value;
    this.runSearch(this.query);
    this.update();
  };

  private onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.query = "";
      this.hits = [];
      this.runSearch.cancel();
      this.update();
    }
  };

  private openHit = (hit: SearchHit): void => {
    const root = this.root();
    if (!root) return;
    const uri = new URI(root).resolve(hit.path);
    void open(this.openerService, uri);
    void this.commands.executeCommand("navigator.reveal", uri).catch(() => undefined);
  };

  protected render(): React.ReactNode {
    return (
      <div className="spexr-smart-search__body">
        <input
          className="spexr-smart-search__input theia-input"
          placeholder="Search files by meaning…"
          value={this.query}
          onChange={this.onInput}
          onKeyDown={this.onKeyDown}
        />
        <div className="spexr-smart-search__status">{statusLabel(this.status)}</div>
        {this.query.trim().length > 0 && (
          <ul className="spexr-smart-search__results">
            {this.hits.length === 0 ? (
              <li className="spexr-smart-search__empty">No results</li>
            ) : (
              this.hits.map((hit) => (
                <li
                  key={hit.path}
                  className="spexr-smart-search__hit"
                  title={hit.path}
                  onClick={() => this.openHit(hit)}
                >
                  <div className="spexr-smart-search__hit-head">
                    <span className="spexr-smart-search__hit-name">{basename(hit.path)}</span>
                    <span className="spexr-smart-search__hit-score">{formatScore(hit.score)}</span>
                  </div>
                  <div className="spexr-smart-search__hit-path">{dirname(hit.path)}</div>
                  <div className="spexr-smart-search__hit-snippet">{hit.snippet}</div>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    );
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}
