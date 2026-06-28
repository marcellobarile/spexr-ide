import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { CommandService } from "@theia/core/lib/common/command";
import { OpenerService, open } from "@theia/core/lib/browser/opener-service";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import type { SearchHit, IndexStatus, SpexrSearchService } from "../../common/search-protocol.js";
import { SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE } from "../preferences/spexr-preferences.js";
import { SpexrSearchServiceProxy } from "./smart-search-service.js";
import { formatScore, scoreColor, statusLabel, debounce, CATEGORY_LABELS, CATEGORY_ORDER } from "./smart-search-format.js";

const INDEXING_MESSAGES = [
  "Scanning your workspace…",
  "Reading source files…",
  "Computing embeddings…",
  "Vectorizing the codebase…",
  "Still going… your codebase must be huge",
  "Training a neural net would've been faster",
  "Still here. Embedding every byte.",
  "Did you open the whole monorepo? Respect.",
  "Have you tried a smaller project?",
  "Still working. No, seriously.",
  "Your files are very… thorough.",
  "Somewhere, a GPU is crying.",
  "Almost there. Probably.",
  "You could've written a parser by now.",
  "We don't stop until every token suffers.",
  "This is fine. Everything is fine.",
  "404: patience not found. But we're still indexing.",
  "Bold of you to commit this many files.",
  "The model is learning about your architecture choices.",
  "At this point we're basically best friends.",
];

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

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  private query = "";
  private hits: SearchHit[] = [];
  /** path → AI description text once resolved. */
  private aiDescriptions = new Map<string, string>();
  /** paths with an in-flight describeFile request (pulsing icon). */
  private aiPending = new Set<string>();
  private status: IndexStatus = { state: "idle", indexed: 0, total: 0 };
  private statusTimer?: ReturnType<typeof setInterval>;
  private indexingStart: number | undefined;
  private collapsedCategories = new Set<string>();

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
    return this.workspace.tryGetRoots()[0]?.resource.path.toString();
  }

  private pollStatus(): void {
    const tick = async (): Promise<void> => {
      const root = this.root();
      if (!root) return;
      this.status = await this.service.getIndexStatus(root);
      if (this.status.state === "indexing") {
        if (this.indexingStart === undefined) this.indexingStart = Date.now();
      } else {
        this.indexingStart = undefined;
      }
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
      this.aiDescriptions.clear();
      this.aiPending.clear();
      this.update();
      return;
    }
    this.hits = await this.service.search(root, q);
    this.aiDescriptions.clear();
    this.aiPending.clear();
    this.update();
    this.requestAiDescriptions(root);
  }

  private static readonly AI_TOP_N = 10;

  private aiEnabled(): boolean {
    return this.preferences.get<boolean>(SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE, true);
  }

  private requestAiDescriptions(root: string): void {
    if (!this.aiEnabled()) return;
    for (const hit of this.hits.slice(0, SmartSearchWidget.AI_TOP_N)) {
      if (this.aiDescriptions.has(hit.path) || this.aiPending.has(hit.path)) continue;
      this.aiPending.add(hit.path);
      void this.service.describeFile(root, hit.path).then((text) => {
        this.aiPending.delete(hit.path);
        if (text) this.aiDescriptions.set(hit.path, text);
        this.update();
      });
    }
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
    const rootResource = this.workspace.tryGetRoots()[0]?.resource;
    if (!rootResource) return;
    const uri = rootResource.resolve(hit.path);
    void open(this.openerService, uri);
    void this.commands.executeCommand("navigator.reveal", uri).catch(() => undefined);
  };

  private renderIndexingProgress(): React.ReactNode {
    const { indexed, total } = this.status;
    const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;
    const elapsed = this.indexingStart !== undefined ? Date.now() - this.indexingStart : 0;
    const msgIndex = Math.floor(elapsed / 10000) % INDEXING_MESSAGES.length;
    const msg = INDEXING_MESSAGES[msgIndex];
    return (
      <div className="spexr-smart-search__progress">
        <div className="spexr-smart-search__progress-track">
          <div
            className="spexr-smart-search__progress-fill"
            style={{ width: `${Math.max(pct, total === 0 ? 8 : 2)}%` }}
          />
        </div>
        <div className="spexr-smart-search__progress-meta">
          <span className="spexr-smart-search__progress-count">
            {total > 0 ? `${indexed} / ${total}` : "Indexing…"}
          </span>
          <span className="spexr-smart-search__progress-msg">{msg}</span>
        </div>
      </div>
    );
  }

  private renderHit(hit: SearchHit): React.ReactNode {
    return (
      <li key={hit.path} className="spexr-smart-search__hit" title={hit.path} onClick={() => this.openHit(hit)}>
        <div className="spexr-smart-search__hit-head">
          <span className="spexr-smart-search__hit-name">{basename(hit.path)}</span>
          <span className="spexr-smart-search__hit-score" style={{ color: scoreColor(hit.score) }}>{formatScore(hit.score)}</span>
        </div>
        {this.renderDesc(hit)}
        <div className="spexr-smart-search__hit-path">{dirname(hit.path)}</div>
      </li>
    );
  }

  private renderDesc(hit: SearchHit): React.ReactNode {
    const ai = this.aiDescriptions.get(hit.path);
    const pending = this.aiPending.has(hit.path);
    const text = ai ?? hit.description;
    if (!text && !pending) return null;
    const showIcon = this.aiEnabled() && (pending || ai !== undefined);
    const iconClass =
      "spexr-smart-search__ai-icon" + (pending ? " spexr-smart-search__ai-icon--pulsing" : "");
    const iconTitle = pending
      ? "L'AI sta generando una descrizione del file…"
      : "Descrizione generata dall'AI";
    return (
      <div className="spexr-smart-search__hit-desc">
        {showIcon && <span className={iconClass} title={iconTitle}>✦</span>}
        {text}
      </div>
    );
  }

  private toggleCategory = (cat: string): void => {
    if (this.collapsedCategories.has(cat)) {
      this.collapsedCategories.delete(cat);
    } else {
      this.collapsedCategories.add(cat);
    }
    this.update();
  };

  private renderResults(): React.ReactNode {
    if (this.hits.length === 0) {
      return <ul className="spexr-smart-search__results"><li className="spexr-smart-search__empty">No results</li></ul>;
    }
    const groups = new Map<string, SearchHit[]>();
    for (const hit of this.hits) {
      const cat = hit.category || "other";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(hit);
    }
    const ordered = [
      ...CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!] as [string, SearchHit[]]),
      ...[...groups.entries()].filter(([c]) => !CATEGORY_ORDER.includes(c)),
    ];
    return (
      <ul className="spexr-smart-search__results">
        {ordered.map(([cat, catHits]) => {
          const collapsed = this.collapsedCategories.has(cat);
          return (
            <React.Fragment key={cat}>
              <li
                className="spexr-smart-search__group-header"
                onClick={() => this.toggleCategory(cat)}
              >
                <span className={`spexr-smart-search__group-chevron${collapsed ? "" : " spexr-smart-search__group-chevron--open"}`}>›</span>
                {CATEGORY_LABELS[cat] ?? cat}
                <span className="spexr-smart-search__group-count">{catHits.length}</span>
              </li>
              {!collapsed && catHits.map((hit) => this.renderHit(hit))}
            </React.Fragment>
          );
        })}
      </ul>
    );
  }

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
        {this.status.state === "indexing"
          ? this.renderIndexingProgress()
          : this.status.state === "ready"
            ? <div className="spexr-smart-search__status--ready"><span className="spexr-smart-search__led" /><span>Ready</span></div>
            : <div className="spexr-smart-search__status">{statusLabel(this.status)}</div>
        }
        {this.query.trim().length > 0 && this.renderResults()}
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
