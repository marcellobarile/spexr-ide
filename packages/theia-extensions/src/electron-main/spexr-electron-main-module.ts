import { ContainerModule } from "@theia/core/shared/inversify";
import { ElectronMainApplicationContribution } from "@theia/core/lib/electron-main/electron-main-application";
import { SpexrElectronMainContribution } from "./spexr-electron-main-contribution.js";

export default new ContainerModule((bind) => {
  bind(ElectronMainApplicationContribution).to(SpexrElectronMainContribution).inSingletonScope();
});
