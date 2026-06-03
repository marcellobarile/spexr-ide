import { ContainerModule } from "@theia/core/shared/inversify";
import { CommandContribution, MenuContribution } from "@theia/core";
import {
  bindViewContribution,
  FrontendApplicationContribution,
  WidgetFactory,
} from "@theia/core/lib/browser";
import { TabBarToolbarContribution } from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { ColorContribution } from "@theia/core/lib/browser/color-application-contribution";
import { PreferenceContribution } from "@theia/core/lib/common/preferences/preference-schema";
import { WebSocketConnectionProvider } from "@theia/core/lib/browser/messaging/ws-connection-provider";
import { SpexrCommandsContribution } from "./commands/spexr-commands-contribution.js";
import { SpexrSpecEditorToolbarContribution } from "./views/spec-editor-toolbar-contribution.js";
import { SpexrAgentTerminalToolbarContribution } from "./views/agent-terminal-toolbar-contribution.js";
import { SpexrSpecRelationsContribution } from "./spec/spec-relations-contribution.js";
import { SpexrSpecViewContribution, SPEC_VIEW_ID } from "./views/spec-view-contribution.js";
import { SpexrSpecWidget } from "./views/spec-widget.js";
import { SpexrMemoryViewContribution, MEMORY_VIEW_ID } from "./views/memory-view-contribution.js";
import { SpexrMemoryWidget } from "./views/memory-widget.js";
import {
  SpexrExpertsViewContribution,
  EXPERTS_VIEW_ID,
} from "./views/experts-view-contribution.js";
import { SpexrExpertsWidget } from "./views/experts-widget.js";
import {
  SpexrSpecResourcesViewContribution,
  SPEC_RESOURCES_VIEW_ID,
} from "./views/spec-resources-view-contribution.js";
import { SpexrSpecResourcesWidget } from "./views/spec-resources-widget.js";
import { SpexrSpecResourcesVisibilityContribution } from "./views/spec-resources-visibility-contribution.js";
import {
  SpexrSpecLintViewContribution,
  SPEC_LINT_VIEW_ID,
} from "./views/spec-lint-view-contribution.js";
import { SpexrSpecLintWidget } from "./views/spec-lint-widget.js";
import { SpexrSpecLintVisibilityContribution } from "./views/spec-lint-visibility-contribution.js";
import { SpexrSpecExternalReloadContribution } from "./views/spec-external-reload-contribution.js";
import {
  SpexrWelcomeViewContribution,
  WELCOME_VIEW_ID,
} from "./views/welcome-view-contribution.js";
import { SpexrWelcomeWidget } from "./views/welcome-widget.js";
import { SpexrShellLayoutContribution } from "./shell/spexr-shell-layout-contribution.js";
import { SpexrBootstrapContribution } from "./bootstrap/spexr-bootstrap-contribution.js";
import { SpexrThemeContribution } from "./theme/spexr-theme-contribution.js";
import { SpexrColorContribution } from "./theme/spexr-color-contribution.js";
import { ClaudeTerminalManager } from "./agent/claude-terminal-manager.js";
import {
  SpexrAgentServiceProxy,
  AGENT_SESSION_SERVICE_PATH,
} from "./agent/agent-service-proxy.js";
import { SpexrPreferenceContribution } from "./preferences/spexr-preferences.js";
import { PreferenceConfigurations } from "@theia/core/lib/common/preferences/preference-configurations";
import { SpexrPreferenceConfigurations } from "./preferences/spexr-preference-configurations.js";

/**
 * Frontend contributions for SPEXR. Theia handles DI via Inversify and
 * discovers contributions through these bindings.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  bindViewContribution(bind, SpexrSpecViewContribution);
  bind(SpexrSpecWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SPEC_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrSpecWidget),
    }))
    .inSingletonScope();

  bindViewContribution(bind, SpexrMemoryViewContribution);
  bind(SpexrMemoryWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: MEMORY_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrMemoryWidget),
    }))
    .inSingletonScope();

  bindViewContribution(bind, SpexrExpertsViewContribution);
  bind(SpexrExpertsWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: EXPERTS_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrExpertsWidget),
    }))
    .inSingletonScope();

  bindViewContribution(bind, SpexrSpecResourcesViewContribution);
  bind(SpexrSpecResourcesWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SPEC_RESOURCES_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrSpecResourcesWidget),
    }))
    .inSingletonScope();
  bind(SpexrSpecResourcesVisibilityContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecResourcesVisibilityContribution);

  bindViewContribution(bind, SpexrSpecLintViewContribution);
  bind(SpexrSpecLintWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SPEC_LINT_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrSpecLintWidget),
    }))
    .inSingletonScope();
  bind(SpexrSpecLintVisibilityContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecLintVisibilityContribution);

  bindViewContribution(bind, SpexrWelcomeViewContribution);
  bind(SpexrWelcomeWidget).toSelf();
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: WELCOME_VIEW_ID,
      createWidget: () => ctx.container.get(SpexrWelcomeWidget),
    }))
    .inSingletonScope();

  bind(SpexrShellLayoutContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrShellLayoutContribution);
  bind(FrontendApplicationContribution).to(SpexrBootstrapContribution).inSingletonScope();
  bind(FrontendApplicationContribution).to(SpexrThemeContribution).inSingletonScope();
  bind(ColorContribution).to(SpexrColorContribution).inSingletonScope();

  bind(ClaudeTerminalManager).toSelf().inSingletonScope();

  bind(SpexrAgentServiceProxy)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      return connection.createProxy(AGENT_SESSION_SERVICE_PATH);
    })
    .inSingletonScope();

  bind(SpexrCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(SpexrCommandsContribution);
  bind(MenuContribution).toService(SpexrCommandsContribution);

  bind(SpexrSpecEditorToolbarContribution).toSelf().inSingletonScope();
  bind(TabBarToolbarContribution).toService(SpexrSpecEditorToolbarContribution);

  bind(SpexrAgentTerminalToolbarContribution).toSelf().inSingletonScope();
  bind(TabBarToolbarContribution).toService(SpexrAgentTerminalToolbarContribution);

  bind(SpexrSpecRelationsContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecRelationsContribution);

  bind(SpexrSpecExternalReloadContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(SpexrSpecExternalReloadContribution);

  bind(SpexrPreferenceContribution).toSelf().inSingletonScope();
  bind(PreferenceContribution).toService(SpexrPreferenceContribution);

  bind(SpexrPreferenceConfigurations).toSelf().inSingletonScope();
  rebind(PreferenceConfigurations).toService(SpexrPreferenceConfigurations);
});
