import "reflect-metadata";
import { Container, type interfaces } from "inversify";

/**
 * Build a fresh root container. Each subsystem registers via a `ContainerModule`,
 * which keeps bindings co-located with their implementation.
 */
export function createSpexrContainer(modules: interfaces.ContainerModule[] = []): Container {
  const container = new Container({
    defaultScope: "Singleton",
    autoBindInjectable: false,
    skipBaseClassChecks: true,
  });
  for (const m of modules) {
    container.load(m);
  }
  return container;
}

export type { Container, interfaces } from "inversify";
