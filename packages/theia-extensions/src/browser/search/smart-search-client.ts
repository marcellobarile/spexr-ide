import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrSearchClient, DescriptionUpdate } from "../../common/search-protocol.js";

export const SpexrSearchClientToken = Symbol("SpexrSearchClientDispatcher");

/**
 * Singleton client registered on the search RPC proxy. The backend pushes
 * description progress here; the widget (created lazily) subscribes to the event.
 */
@injectable()
export class SpexrSearchClientDispatcher implements SpexrSearchClient {
  private readonly emitter = new Emitter<DescriptionUpdate>();
  readonly onDescriptionUpdate$: Event<DescriptionUpdate> = this.emitter.event;

  onDescriptionUpdate(update: DescriptionUpdate): void {
    this.emitter.fire(update);
  }
}
