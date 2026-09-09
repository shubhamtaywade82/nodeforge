/**
 * Tests for the Docker adapter.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { DockerAdapter, parseDockerfile, parseDockerCompose } from "../src/DockerAdapter.js";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-docker");

describe("parseDockerfile", () => {
  it("parses FROM, WORKDIR, ENV, EXPOSE, CMD", () => {
    const src = [
      "FROM node:20-slim",
      "WORKDIR /app",
      "ENV NODE_ENV=production PORT=3000",
      "EXPOSE 3000",
      'CMD ["node", "dist/index.js"]',
      ""
    ].join("\n");
    const df = parseDockerfile(src, "/test/Dockerfile");
    expect(df.baseImage.baseImage).toBe("node");
    expect(df.baseImage.tag).toBe("20-slim");
    expect(df.workdir).toBe("/app");
    expect(df.env).toHaveLength(2);
    expect(df.env[0]!.name).toBe("NODE_ENV");
    expect(df.env[0]!.value).toBe("production");
    expect(df.env[1]!.name).toBe("PORT");
    expect(df.env[1]!.value).toBe("3000");
    expect(df.exposedPorts).toEqual([3000]);
    expect(df.cmd).toEqual(["node", "dist/index.js"]);
  });

  it("parses multi-stage builds with AS and COPY --from", () => {
    const src = [
      "FROM node:20-slim AS builder",
      "COPY . .",
      "RUN npm run build",
      "FROM node:20-slim",
      "COPY --from=builder /app/dist ./dist",
      ""
    ].join("\n");
    const df = parseDockerfile(src, "/test/Dockerfile");
    // stageName tracks the LAST FROM (the production stage, which has no AS)
    expect(df.stageName).toBeUndefined();
    // The second COPY has --from=builder
    expect(df.copies[1]!.fromStage).toBe("builder");
    expect(df.copies[1]!.sources).toEqual(["/app/dist"]);
    expect(df.copies[1]!.destination).toBe("./dist");
  });

  it("parses ENV in KEY value form", () => {
    const src = ["FROM node:20", "ENV DEBUG true", ""].join("\n");
    const df = parseDockerfile(src, "/test/Dockerfile");
    expect(df.env[0]!.name).toBe("DEBUG");
    expect(df.env[0]!.value).toBe("true");
  });

  it("parses HEALTHCHECK with flags", () => {
    const src = [
      "FROM node:20",
      "HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD curl -f http://localhost:3000/health",
      ""
    ].join("\n");
    const df = parseDockerfile(src, "/test/Dockerfile");
    expect(df.healthcheck).toBeDefined();
    expect(df.healthcheck!.interval).toBe("30s");
    expect(df.healthcheck!.timeout).toBe("3s");
    expect(df.healthcheck!.startPeriod).toBe("5s");
    expect(df.healthcheck!.retries).toBe(3);
    expect(df.healthcheck!.test[0]).toBe("curl");
  });

  it("handles continuation lines", () => {
    const src = [
      "FROM node:20",
      "RUN apt-get update && \\",
      "    apt-get install -y curl git",
      ""
    ].join("\n");
    const df = parseDockerfile(src, "/test/Dockerfile");
    expect(df.runCommands).toHaveLength(1);
    expect(df.runCommands[0]).toContain("apt-get update");
    expect(df.runCommands[0]).toContain("apt-get install -y curl git");
  });

  it("throws AdapterParseError for Dockerfile without FROM", () => {
    expect(() => parseDockerfile("WORKDIR /app\n", "/test/Dockerfile")).toThrow(/no FROM/);
  });

  it("detects interpolated env values", () => {
    const src = [
      "FROM node:20",
      "ENV DATABASE_URL=postgres://user:${DB_PASSWORD}@host:5432/db",
      ""
    ].join("\n");
    const df = parseDockerfile(src, "/test/Dockerfile");
    expect(df.env[0]!.isInterpolated).toBe(true);
  });
});

describe("parseDockerCompose", () => {
  it("parses services, volumes, networks", () => {
    const yaml = [
      'version: "3.9"',
      "services:",
      "  api:",
      "    image: myapp:latest",
      '    ports: ["3000:3000"]',
      "    environment:",
      "      - NODE_ENV=production",
      "    depends_on: [db]",
      "    networks: [appnet]",
      "  db:",
      "    image: postgres:16",
      '    ports: ["5432:5432"]',
      "volumes:",
      "  pgdata:",
      "networks:",
      "  appnet:"
    ].join("\n");
    const compose = parseDockerCompose(yaml, "/test/docker-compose.yml");
    expect(compose.version).toBe("3.9");
    expect(compose.services).toHaveLength(2);
    expect(compose.services[0]!.name).toBe("api");
    expect(compose.services[0]!.image).toBe("myapp:latest");
    expect(compose.services[0]!.ports[0]).toEqual({
      host: 3000,
      container: 3000,
      protocol: undefined
    });
    expect(compose.services[0]!.environment[0]!.name).toBe("NODE_ENV");
    expect(compose.services[0]!.dependsOn).toEqual(["db"]);
    expect(compose.services[0]!.networks).toEqual(["appnet"]);
    expect(compose.volumes).toEqual(["pgdata"]);
    expect(compose.networks).toEqual(["appnet"]);
  });

  it("parses build config with context and dockerfile", () => {
    const yaml = [
      "services:",
      "  api:",
      "    build:",
      "      context: .",
      "      dockerfile: Dockerfile",
      "      args:",
      "        NODE_VERSION: '20'"
    ].join("\n");
    const compose = parseDockerCompose(yaml, "/test/docker-compose.yml");
    const svc = compose.services[0]!;
    expect(svc.build).toEqual({
      context: ".",
      dockerfile: "Dockerfile",
      args: { NODE_VERSION: "20" }
    });
  });

  it("parses volume mounts with mode", () => {
    const yaml = [
      "services:",
      "  api:",
      "    volumes:",
      "      - ./logs:/app/logs",
      "      - ./config:/app/config:ro"
    ].join("\n");
    const compose = parseDockerCompose(yaml, "/test/docker-compose.yml");
    const vols = compose.services[0]!.volumes;
    expect(vols).toHaveLength(2);
    expect(vols[0]).toEqual({ source: "./logs", target: "/app/logs", mode: "rw" });
    expect(vols[1]).toEqual({ source: "./config", target: "/app/config", mode: "ro" });
  });

  it("parses healthcheck", () => {
    const yaml = [
      "services:",
      "  api:",
      "    healthcheck:",
      "      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']",
      "      interval: 30s",
      "      timeout: 3s",
      "      retries: 3"
    ].join("\n");
    const compose = parseDockerCompose(yaml, "/test/docker-compose.yml");
    const hc = compose.services[0]!.healthcheck!;
    expect(hc.test).toEqual(["CMD", "curl", "-f", "http://localhost:3000/health"]);
    expect(hc.interval).toBe("30s");
    expect(hc.retries).toBe(3);
  });
});

describe("DockerAdapter (integration against fixture)", () => {
  it("detects both Dockerfile and docker-compose.yml", async () => {
    const adapter = new DockerAdapter();
    const config = await adapter.detect(FIXTURE);

    expect(config.dockerfile).toBeDefined();
    expect(config.dockerfile!.baseImage.baseImage).toBe("node");
    expect(config.dockerfile!.baseImage.tag).toBe("20-slim");
    // stageName is undefined because the final FROM (production stage) has no AS
    expect(config.dockerfile!.stageName).toBeUndefined();
    // But the first stage (builder) is referenced via COPY --from
    const builderCopy = config.dockerfile!.copies.find((c) => c.fromStage === "builder");
    expect(builderCopy).toBeDefined();
    expect(config.dockerfile!.workdir).toBe("/app");
    expect(config.dockerfile!.exposedPorts).toEqual([3000]);
    expect(config.dockerfile!.cmd).toEqual(["node", "dist/index.js"]);
    expect(config.dockerfile!.healthcheck).toBeDefined();
    expect(config.dockerfile!.healthcheck!.interval).toBe("30s");

    expect(config.compose).toBeDefined();
    expect(config.compose!.version).toBe("3.9");
    expect(config.compose!.services.length).toBe(3);
    const api = config.compose!.services.find((s) => s.name === "api")!;
    expect(api.build).toEqual({ context: ".", dockerfile: "Dockerfile", args: undefined });
    expect(api.ports).toEqual(expect.arrayContaining([expect.objectContaining({ host: 3000, container: 3000 })]));
    expect(api.dependsOn).toEqual(expect.arrayContaining(["db", "cache"]));
    expect(config.compose!.volumes).toEqual(["pgdata"]);
    expect(config.compose!.networks).toEqual(["appnet"]);
  });

  it("detects config presence via hasConfig", async () => {
    expect(await DockerAdapter.hasConfig(FIXTURE)).toBe(true);
    expect(await DockerAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });
});
