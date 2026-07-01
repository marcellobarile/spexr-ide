import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrSearchClient, DescriptionUpdate, DescriptionJobStatus } from "../../common/search-protocol.js";

export const SpexrSearchClientToken = Symbol("SpexrSearchClientDispatcher");

/**
 * Singleton client registered on the search RPC proxy. The backend pushes
 * per-file description progress and whole-workspace job progress here; widgets
 * subscribe to the events.
 */
@injectable()
export class SpexrSearchClientDispatcher implements SpexrSearchClient {
  private readonly descEmitter = new Emitter<DescriptionUpdate>();
  readonly onDescriptionUpdate$: Event<DescriptionUpdate> = this.descEmitter.event;

  private readonly jobEmitter = new Emitter<DescriptionJobStatus>();
  readonly onDescriptionJobProgress$: Event<DescriptionJobStatus> = this.jobEmitter.event;

  onDescriptionUpdate(update: DescriptionUpdate): void {
    this.descEmitter.fire(update);
  }

  onDescriptionJobProgress(status: DescriptionJobStatus): void {
    this.jobEmitter.fire(status);
  }
}
