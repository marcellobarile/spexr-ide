import { WebSocketConnectionProvider } from "@theia/core/lib/browser/messaging/ws-connection-provider";
import {
  AGENT_SESSION_SERVICE_PATH,
  type SpexrAgentService,
} from "../../common/agent-protocol.js";

/**
 * Symbol used to inject the backend `SpexrAgentService` proxy in the frontend.
 *
 * Bind it to a `WebSocketConnectionProvider.createProxy(...)` call in the
 * frontend module so consumers remain transport-agnostic.
 */
export const SpexrAgentServiceProxy = Symbol("SpexrAgentServiceProxy");

export { AGENT_SESSION_SERVICE_PATH, WebSocketConnectionProvider };
export type { SpexrAgentService };
