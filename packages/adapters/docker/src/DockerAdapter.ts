/**
 * Docker adapter.
 *
 * Parses a `Dockerfile` and `docker-compose.yml` into the normalized
 * `DockerConfig` contract.
 *
 * The Dockerfile parser handles the standard instruction set (FROM, WORKDIR,
 * ENV, EXPOSE, RUN, COPY, CMD, ENTRYPOINT, HEALTHCHECK) plus multi-stage builds
 * (`FROM ... AS <name>` and `COPY --from=<stage>`).
 *
 * The docker-compose parser uses the `yaml` library to parse the YAML into
 * a plain object, then walks the `services`, `volumes`, and `networks` keys
 * to build the structured output.
 */

import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AdapterParseError,
  type DockerCompose,
  type DockerComposeService,
  type DockerConfig,
  type DockerEnvVar,
  type Dockerfile,
  type DockerImage,
  type DockerPort,
  type DockerVolume
} from "@nodeforge/contracts";

export class DockerAdapter {
  /**
   * Detect the Docker configuration for `workspaceRoot`. Returns a `DockerConfig`
   * with `dockerfile` and/or `compose` populated if those files exist.
   */
  async detect(workspaceRoot: string): Promise<DockerConfig> {
    const fs = await import("node:fs/promises");
    const dockerfilePath = path.join(workspaceRoot, "Dockerfile");
    const composeCandidates = [
      "docker-compose.yml",
      "docker-compose.yaml",
      "compose.yml",
      "compose.yaml"
    ];

    let dockerfile: Dockerfile | undefined;
    let compose: DockerCompose | undefined;

    // Parse Dockerfile
    try {
      const raw = await fs.readFile(dockerfilePath, "utf8");
      dockerfile = parseDockerfile(raw, dockerfilePath);
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }

    // Parse docker-compose.yml
    for (const candidate of composeCandidates) {
      const composePath = path.join(workspaceRoot, candidate);
      try {
        const raw = await fs.readFile(composePath, "utf8");
        compose = parseDockerCompose(raw, composePath);
        break;
      } catch (err) {
        if (!isEnoent(err)) throw err;
      }
    }

    return { dockerfile, compose };
  }

  /**
   * Returns true if a Dockerfile or docker-compose.yml exists in `workspaceRoot`.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    const candidates = [
      "Dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      "compose.yml",
      "compose.yaml"
    ];
    for (const c of candidates) {
      try {
        await fs.access(path.join(workspaceRoot, c));
        return true;
      } catch {
        // continue
      }
    }
    return false;
  }
}

/**
 * Parse a Dockerfile source string into a `Dockerfile` object.
 *
 * Exported for testing.
 */
export function parseDockerfile(source: string, filePath: string): Dockerfile {
  const lines = source.split(/\r?\n/);
  let baseImage: DockerImage | undefined;
  let stageName: string | undefined;
  let workdir: string | undefined;
  let user: string | undefined;
  const exposedPorts: number[] = [];
  const env: DockerEnvVar[] = [];
  const runCommands: string[] = [];
  const copies: Dockerfile["copies"] = [];
  let cmd: string[] | undefined;
  let entrypoint: string[] | undefined;
  let healthcheck: Dockerfile["healthcheck"] | undefined;

  // Track continuation lines (backslash at end).
  const logicalLines: string[] = [];
  let buffer = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    if (buffer) buffer += " ";
    if (trimmed.endsWith("\\")) {
      buffer += trimmed.slice(0, -1).trim();
    } else {
      buffer += trimmed;
      if (buffer.trim()) logicalLines.push(buffer);
      buffer = "";
    }
  }
  if (buffer.trim()) logicalLines.push(buffer);

  for (const line of logicalLines) {
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx === -1) continue;
    const instruction = line.slice(0, spaceIdx).toUpperCase();
    const args = line.slice(spaceIdx + 1).trim();

    switch (instruction) {
      case "FROM": {
        // FROM <image>[:<tag>] [AS <stage>]
        const asMatch = /\s+AS\s+(\S+)/i.exec(args);
        const imagePart = asMatch ? args.slice(0, asMatch.index).trim() : args;
        baseImage = parseImageRef(imagePart);
        stageName = asMatch ? asMatch[1] : undefined;
        break;
      }
      case "WORKDIR":
        workdir = args;
        break;
      case "USER":
        user = args;
        break;
      case "EXPOSE": {
        // EXPOSE 3000/tcp 8080
        for (const part of args.split(/\s+/)) {
          const portStr = part.split("/")[0]!;
          const port = parseInt(portStr, 10);
          if (Number.isFinite(port)) exposedPorts.push(port);
        }
        break;
      }
      case "ENV": {
        // ENV KEY=value [KEY2=value2 ...]  OR  ENV KEY value
        const eqMatch = /^(\S+)=(.*)$/.exec(args);
        if (eqMatch) {
          // Multiple KEY=value pairs on a single line are valid in Docker.
          // Split on spaces followed by an identifier=.
          const pairs = args.match(/(\S+?=\S+)/g) ?? [args];
          for (const pair of pairs) {
            const idx = pair.indexOf("=");
            const name = pair.slice(0, idx);
            const value = pair.slice(idx + 1);
            env.push(makeEnvVar(name, stripQuotes(value)));
          }
        } else {
          const parts = args.split(/\s+/);
          if (parts.length >= 2) {
            env.push(makeEnvVar(parts[0]!, parts.slice(1).join(" ")));
          }
        }
        break;
      }
      case "RUN":
        runCommands.push(args);
        break;
      case "COPY": {
        // COPY [--from=<stage>] src dst
        let fromStage: string | undefined;
        let rest = args;
        const fromMatch = /--from=(\S+)/.exec(rest);
        if (fromMatch) {
          fromStage = fromMatch[1];
          rest = rest.replace(fromMatch[0], "").trim();
        }
        const tokens = rest.split(/\s+/).filter(Boolean);
        if (tokens.length >= 2) {
          copies.push({
            sources: tokens.slice(0, -1),
            destination: tokens[tokens.length - 1]!,
            fromStage
          });
        }
        break;
      }
      case "CMD": {
        cmd = parseStringArray(args);
        break;
      }
      case "ENTRYPOINT": {
        entrypoint = parseStringArray(args);
        break;
      }
      case "HEALTHCHECK": {
        healthcheck = parseHealthcheck(args);
        break;
      }
    }
  }

  if (!baseImage) {
    throw new AdapterParseError("docker", "Dockerfile has no FROM instruction");
  }

  return {
    path: filePath,
    baseImage,
    stageName,
    workdir,
    user,
    exposedPorts,
    env,
    runCommands,
    copies,
    cmd,
    entrypoint,
    healthcheck
  };
}

/**
 * Parse a docker-compose.yml source string into a `DockerCompose` object.
 *
 * Exported for testing.
 */
export function parseDockerCompose(source: string, filePath: string): DockerCompose {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (err) {
    throw new AdapterParseError("docker", `Failed to parse YAML: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AdapterParseError("docker", "docker-compose.yml is not an object");
  }

  const root = parsed as {
    version?: string;
    services?: Record<string, unknown>;
    volumes?: Record<string, unknown> | string[];
    networks?: Record<string, unknown> | string[];
  };

  const services: DockerComposeService[] = [];
  if (root.services && typeof root.services === "object") {
    for (const [name, svc] of Object.entries(root.services)) {
      if (svc && typeof svc === "object") {
        services.push(parseService(name, svc as Record<string, unknown>));
      }
    }
  }

  let volumes: string[] = [];
  if (root.volumes) {
    if (Array.isArray(root.volumes)) {
      volumes = root.volumes.filter((v): v is string => typeof v === "string");
    } else if (typeof root.volumes === "object") {
      volumes = Object.keys(root.volumes);
    }
  }

  let networks: string[] = [];
  if (root.networks) {
    if (Array.isArray(root.networks)) {
      networks = root.networks.filter((v): v is string => typeof v === "string");
    } else if (typeof root.networks === "object") {
      networks = Object.keys(root.networks);
    }
  }

  return {
    path: filePath,
    version: root.version,
    services,
    volumes,
    networks
  };
}

function parseService(name: string, svc: Record<string, unknown>): DockerComposeService {
  const ports = parsePorts(svc["ports"]);
  const volumes = parseVolumes(svc["volumes"]);
  const environment = parseEnv(svc["environment"]);
  const dependsOn = parseDependsOn(svc["depends_on"]);
  const networks = parseNetworks(svc["networks"]);

  let build: DockerComposeService["build"];
  const buildRaw = svc["build"];
  if (typeof buildRaw === "string") {
    build = buildRaw;
  } else if (buildRaw && typeof buildRaw === "object") {
    const b = buildRaw as {
      context?: string;
      dockerfile?: string;
      args?: Record<string, string>;
    };
    build = {
      context: b.context,
      dockerfile: b.dockerfile,
      args: b.args
    };
  }

  const healthcheckRaw = svc["healthcheck"] as
    | { test?: string[] | string; interval?: string; timeout?: string; retries?: number }
    | undefined;

  return {
    name,
    image: typeof svc["image"] === "string" ? svc["image"] : undefined,
    build,
    ports,
    volumes,
    environment,
    dependsOn,
    restart: typeof svc["restart"] === "string" ? svc["restart"] : undefined,
    healthcheck: healthcheckRaw
      ? {
          test: Array.isArray(healthcheckRaw.test)
            ? healthcheckRaw.test
            : healthcheckRaw.test
              ? [healthcheckRaw.test]
              : [],
          interval: healthcheckRaw.interval,
          timeout: healthcheckRaw.timeout,
          retries: healthcheckRaw.retries
        }
      : undefined,
    networks
  };
}

function parsePorts(raw: unknown): DockerPort[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p): DockerPort => {
    if (typeof p === "number") {
      return { container: p };
    }
    if (typeof p === "string") {
      // "8080:80", "8080:80/tcp", "127.0.0.1:8080:80"
      const parts = p.split(":");
      const protocol = parts[parts.length - 1]!.includes("/")
        ? (parts[parts.length - 1]!.split("/")[1] as "tcp" | "udp")
        : undefined;
      const cleanParts = parts.map((x) => x.split("/")[0]!);
      if (cleanParts.length === 1) {
        return { container: parseInt(cleanParts[0]!, 10), protocol };
      }
      if (cleanParts.length === 2) {
        return {
          host: parseInt(cleanParts[0]!, 10),
          container: parseInt(cleanParts[1]!, 10),
          protocol
        };
      }
      // 127.0.0.1:8080:80 — skip host ip
      return {
        host: parseInt(cleanParts[1]!, 10),
        container: parseInt(cleanParts[2]!, 10),
        protocol
      };
    }
    if (p && typeof p === "object") {
      const obj = p as { published?: number | string; target?: number; protocol?: "tcp" | "udp" };
      return {
        container: obj.target ?? 0,
        host: typeof obj.published === "number" ? obj.published : undefined,
        protocol: obj.protocol
      };
    }
    return { container: 0 };
  });
}

function parseVolumes(raw: unknown): DockerVolume[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v): DockerVolume | undefined => {
      if (typeof v === "string") {
        // "host:container:ro" or "named:container"
        const parts = v.split(":");
        if (parts.length >= 2) {
          const source = parts[0]!;
          const target = parts[1]!;
          const mode = parts[2] === "ro" ? "ro" : "rw";
          return { source, target, mode };
        }
      }
      if (v && typeof v === "object") {
        const obj = v as { source?: string; target?: string; read_only?: boolean };
        if (obj.source && obj.target) {
          return { source: obj.source, target: obj.target, mode: obj.read_only ? "ro" : "rw" };
        }
      }
      return undefined;
    })
    .filter((v): v is DockerVolume => v !== undefined);
}

function parseEnv(raw: unknown): DockerEnvVar[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    // ["KEY=value", "KEY2=value2"]
    return raw
      .filter((v): v is string => typeof v === "string")
      .map((v) => {
        const idx = v.indexOf("=");
        const name = idx === -1 ? v : v.slice(0, idx);
        const value = idx === -1 ? "" : v.slice(idx + 1);
        return makeEnvVar(name, value);
      });
  }
  if (typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) =>
      makeEnvVar(k, v === null ? "" : String(v))
    );
  }
  return [];
}

function parseDependsOn(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string");
  }
  if (typeof raw === "object") {
    return Object.keys(raw as Record<string, unknown>);
  }
  return [];
}

function parseNetworks(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string");
  }
  if (typeof raw === "object") {
    return Object.keys(raw as Record<string, unknown>);
  }
  return [];
}

function parseImageRef(ref: string): DockerImage {
  // node:20-slim  →  { baseImage: "node", tag: "20-slim" }
  // node           →  { baseImage: "node" }
  // registry.io/foo:bar → { baseImage: "registry.io/foo", tag: "bar" }
  const lastColon = ref.lastIndexOf(":");
  const lastSlash = ref.lastIndexOf("/");
  if (lastColon > lastSlash && lastColon !== -1) {
    return {
      baseImage: ref.slice(0, lastColon),
      tag: ref.slice(lastColon + 1)
    };
  }
  return { baseImage: ref };
}

function parseStringArray(args: string): string[] | undefined {
  const trimmed = args.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    // JSON array form: ["node", "dist/index.js"]
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v));
      }
    } catch {
      // fall through
    }
  }
  // Shell form: split on whitespace
  return args.split(/\s+/).filter(Boolean);
}

function parseHealthcheck(args: string): Dockerfile["healthcheck"] {
  // HEALTHCHECK [--interval=30s --timeout=3s --start-period=5s --retries=3] CMD ...
  // Also: HEALTHCHECK NONE
  const flagRegex = /--(\w[\w-]*)=(\S+)/g;
  const flags: Record<string, string> = {};
  let m: RegExpExecArray | null;
  let lastEnd = 0;
  while ((m = flagRegex.exec(args)) !== null) {
    flags[m[1]!.replace(/-/g, "")] = m[2]!;
    lastEnd = m.index + m[0].length;
  }
  let cmdPart = args.slice(lastEnd).trim();

  // HEALTHCHECK NONE — no probe.
  if (cmdPart.toUpperCase() === "NONE") {
    return {
      test: ["NONE"],
      interval: flags.interval,
      timeout: flags.timeout,
      startPeriod: flags.startperiod,
      retries: flags.retries ? parseInt(flags.retries, 10) : undefined
    };
  }

  // Strip the CMD / CMD-SHELL prefix.
  // Docker uses: HEALTHCHECK CMD command  OR  HEALTHCHECK CMD ["arg1", "arg2"]
  const cmdMatch = /^CMD-SHELL\s+/i.exec(cmdPart);
  if (cmdMatch) {
    cmdPart = cmdPart.slice(cmdMatch[0].length);
  } else {
    const cmdPrefix = /^CMD\s+/i.exec(cmdPart);
    if (cmdPrefix) {
      cmdPart = cmdPart.slice(cmdPrefix[0].length);
    }
  }

  const test = parseStringArray(cmdPart) ?? [];

  return {
    test,
    interval: flags.interval,
    timeout: flags.timeout,
    startPeriod: flags.startperiod,
    retries: flags.retries ? parseInt(flags.retries, 10) : undefined
  };
}

function makeEnvVar(name: string, value: string): DockerEnvVar {
  return {
    name,
    value,
    isInterpolated: /\$\{|\$\w/.test(value)
  };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT";
}
