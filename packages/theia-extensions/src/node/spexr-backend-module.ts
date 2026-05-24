import { ContainerModule } from "@theia/core/shared/inversify";
import { ConnectionHandler, RpcConnectionHandler } from "@theia/core/lib/common/messaging";
import { AGENT_SESSION_SERVICE_PATH } from "../common/agent-protocol.js";
import { SpexrAgentBackendService } from "./spexr-agent-backend-service.js";

/**
 * Backend Inversify module for the spexr agent service.
 *
 * Registers a singleton `SpexrAgentBackendService` and exposes it over RPC.
 * The client push-channel (state/message/error callbacks) has been removed
 * along with the SDK session; only profile detection and launch-context
 * building remain.
 */
export default new ContainerModule((bind) => {
  bind(SpexrAgentBackendService).toSelf().inSingletonScope();

  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrAgentBackendService);
      return new RpcConnectionHandler(AGENT_SESSION_SERVICE_PATH, () => service);
    })
    .inSingletonScope();
});
