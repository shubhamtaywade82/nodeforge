/**
 * Docker contracts — produced by `packages/adapters/docker`.
 *
 * Covers both `Dockerfile` parsing and `docker-compose.yml` parsing.
 */

export interface DockerImage {
  /** The base image, e.g. `node:20-slim`. */
  baseImage: string;
  /** Tag, if specified. e.g. `slim` from `node:20-slim`. */
  tag?: string;
}

export interface DockerPort {
  /** Container port. */
  container: number;
  /** Optional host port mapping. */
  host?: number;
  /** Protocol (tcp/udp). Defaults to tcp. */
  protocol?: "tcp" | "udp";
}

export interface DockerVolume {
  /** Host path or named volume. */
  source: string;
  /** Container path. */
  target: string;
  /** Mount mode. Defaults to "rw". */
  mode?: "rw" | "ro";
}

export interface DockerEnvVar {
  name: string;
  value: string;
  /** Whether the value references an env var via ${VAR} or $VAR syntax. */
  isInterpolated: boolean;
}

/**
 * Structured representation of a Dockerfile.
 *
 * The parser is intentionally simple — it doesn't handle every Dockerfile
 * feature (ARG inheritance, build stage aliases with AS, etc.) but covers
 * the common 90% of Node.js Dockerfiles.
 */
export interface Dockerfile {
  /** Absolute path to the Dockerfile. */
  path: string;
  /** Base image from the FROM instruction. */
  baseImage: DockerImage;
  /** Build stage name (if `FROM ... AS <name>` is used). */
  stageName?: string;
  /** Working directory from WORKDIR. */
  workdir?: string;
  /** User from USER instruction. */
  user?: string;
  /** Exposed ports from EXPOSE. */
  exposedPorts: number[];
  /** Environment variables from ENV. */
  env: DockerEnvVar[];
  /** Run commands (each RUN instruction). */
  runCommands: string[];
  /** COPY instructions. */
  copies: Array<{
    /** Source path(s). */
    sources: string[];
    /** Destination path. */
    destination: string;
    /** Whether this is a COPY --from=<stage>. */
    fromStage?: string;
  }>;
  /** CMD instruction (entrypoint args). */
  cmd?: string[];
  /** ENTRYPOINT instruction. */
  entrypoint?: string[];
  /** HEALTHCHECK instruction. */
  healthcheck?: {
    test: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    startPeriod?: string;
  };
}

/**
 * Structured representation of a `docker-compose.yml` service.
 */
export interface DockerComposeService {
  /** Service name. */
  name: string;
  /** Image, or `build` if built from a Dockerfile. */
  image?: string;
  build?:
    | string
    | {
        context?: string;
        dockerfile?: string;
        args?: Record<string, string>;
      };
  /** Container ports → host ports. */
  ports: DockerPort[];
  /** Volume mounts. */
  volumes: DockerVolume[];
  /** Environment variables. */
  environment: DockerEnvVar[];
  /** Depends on other services. */
  dependsOn: string[];
  /** Restart policy. */
  restart?: string;
  /** Healthcheck. */
  healthcheck?: {
    test: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
  };
  /** Network names. */
  networks: string[];
}

/**
 * Structured representation of a `docker-compose.yml` file.
 */
export interface DockerCompose {
  /** Absolute path to the compose file. */
  path: string;
  /** Compose file version (e.g. "3.8"). */
  version?: string;
  /** Services defined in the file. */
  services: DockerComposeService[];
  /** Named volumes. */
  volumes: string[];
  /** Networks. */
  networks: string[];
}

/**
 * Combined Docker intelligence — both Dockerfile and docker-compose info.
 */
export interface DockerConfig {
  /** Dockerfile info, if a Dockerfile exists. */
  dockerfile: Dockerfile | undefined;
  /** docker-compose info, if a compose file exists. */
  compose: DockerCompose | undefined;
}
