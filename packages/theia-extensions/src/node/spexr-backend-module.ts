import { ContainerModule } from "@theia/core/shared/inversify";
import { ConnectionHandler, RpcConnectionHandler } from "@theia/core/lib/common/messaging";
import { AGENT_SESSION_SERVICE_PATH } from "../common/agent-protocol.js";
import { GIT_SERVICE_PATH } from "../common/git-protocol.js";
import { SpexrAgentBackendService } from "./spexr-agent-backend-service.js";
import { SpexrGitBackendService } from "./spexr-git-backend-service.js";
import { SEARCH_SERVICE_PATH } from "../common/search-protocol.js";
import { EmbedderToken, TransformersEmbedder } from "./search/embedding-model.js";
import { SpexrSearchBackendService } from "./search/spexr-search-backend-service.js";

export default new ContainerModule((bind) => {
  bind(SpexrAgentBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrAgentBackendService);
      return new RpcConnectionHandler(AGENT_SESSION_SERVICE_PATH, () => service);
    })
    .inSingletonScope();

  bind(SpexrGitBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrGitBackendService);
      return new RpcConnectionHandler(GIT_SERVICE_PATH, () => service);
    })
    .inSingletonScope();

  bind(EmbedderToken).to(TransformersEmbedder).inSingletonScope();
  bind(SpexrSearchBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrSearchBackendService);
      return new RpcConnectionHandler(SEARCH_SERVICE_PATH, () => service);
    })
    .inSingletonScope();
});
