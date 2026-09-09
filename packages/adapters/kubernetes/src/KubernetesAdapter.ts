/**
 * Kubernetes adapter.
 *
 * Parses k8s YAML manifests from a directory (or set of directories) into the
 * normalized `KubernetesManifests` contract.
 *
 * Supports multi-document YAML files (separated by `---`) and the common
 * resource kinds: Deployment, Service, ConfigMap, Secret, Ingress, etc.
 *
 * Walks these directories by default:
 *   - k8s/
 *   - .k8s/
 *   - manifests/
 *   - kubernetes/
 *   - helm/templates/ (if helm is used)
 *
 * Each .yml / .yaml file in these directories is parsed; multi-doc files
 * produce multiple resources.
 */

import * as path from "node:path";
import { parseAllDocuments } from "yaml";
import {
  AdapterParseError,
  type KubernetesContainer,
  type KubernetesContainerPort,
  type KubernetesEnvVar,
  type KubernetesProbe,
  type KubernetesResource,
  type KubernetesResourceKind,
  type KubernetesResourceSpec,
  type KubernetesManifests
} from "@nodeforge/contracts";

const SCAN_DIRS = ["k8s", ".k8s", "manifests", "kubernetes", "helm/templates"];

export class KubernetesAdapter {
  /**
   * Detect Kubernetes manifests in `workspaceRoot`. Returns a
   * `KubernetesManifests` with all resources found across the standard
   * scan directories. If no manifests exist, returns an empty result
   * (not undefined — the absence is communicated via `resources.length === 0`).
   */
  async detect(workspaceRoot: string): Promise<KubernetesManifests> {
    const fs = await import("node:fs/promises");
    const resources: KubernetesResource[] = [];
    let fileCount = 0;

    for (const dir of SCAN_DIRS) {
      const absDir = path.join(workspaceRoot, dir);
      let entries: string[] = [];
      try {
        entries = await fs.readdir(absDir);
      } catch (err) {
        if (!isEnoent(err)) throw err;
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
        const filePath = path.join(absDir, entry);
        const raw = await fs.readFile(filePath, "utf8");
        fileCount++;
        const fileResources = parseManifestFile(raw, filePath);
        resources.push(...fileResources);
      }
    }

    return {
      root: workspaceRoot,
      resources,
      fileCount
    };
  }

  /**
   * Returns true if any standard k8s scan directory exists in `workspaceRoot`.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    for (const dir of SCAN_DIRS) {
      try {
        const stat = await fs.stat(path.join(workspaceRoot, dir));
        if (stat.isDirectory()) return true;
      } catch {
        // continue
      }
    }
    // Also check for kustomization.yaml at root.
    try {
      await fs.access(path.join(workspaceRoot, "kustomization.yaml"));
      return true;
    } catch {
      // continue
    }
    return false;
  }
}

/**
 * Parse a multi-document YAML manifest file into `KubernetesResource[]`.
 *
 * Exported for testing.
 */
export function parseManifestFile(source: string, filePath: string): KubernetesResource[] {
  const docs = parseAllDocuments(source);
  const resources: KubernetesResource[] = [];
  for (const doc of docs) {
    const obj = doc.toJS();
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    const resource = parseResource(obj as Record<string, unknown>, filePath);
    if (resource) resources.push(resource);
  }
  return resources;
}

function parseResource(obj: Record<string, unknown>, filePath: string): KubernetesResource | undefined {
  const kind = obj["kind"];
  const apiVersion = obj["apiVersion"];
  if (typeof kind !== "string" || typeof apiVersion !== "string") {
    return undefined;
  }

  const metadata = (obj["metadata"] ?? {}) as {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };

  if (typeof metadata.name !== "string") {
    return undefined;
  }

  // For ConfigMaps and Secrets, `data` is at the root level, not under `spec`.
  let spec = parseSpec(obj["spec"], kind);
  if (kind === "ConfigMap") {
    const data = obj["data"];
    if (data && typeof data === "object") {
      spec = {
        ...spec,
        configMapData: Object.fromEntries(
          Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, String(v)])
        )
      };
    } else if (!spec) {
      spec = { configMapData: {} };
    }
  }

  return {
    kind: mapKind(kind),
    apiVersion,
    name: metadata.name,
    namespace: metadata.namespace,
    labels: metadata.labels,
    annotations: metadata.annotations,
    spec
  };
}

function mapKind(kind: string): KubernetesResourceKind {
  const known: KubernetesResourceKind[] = [
    "Deployment", "Service", "ConfigMap", "Secret", "Ingress", "Pod",
    "Namespace", "Job", "CronJob", "StatefulSet", "DaemonSet",
    "HorizontalPodAutoscaler", "PersistentVolume", "PersistentVolumeClaim",
    "ServiceAccount", "ClusterRole", "ClusterRoleBinding", "Role", "RoleBinding",
    "CustomResourceDefinition"
  ];
  if ((known as string[]).includes(kind)) {
    return kind as KubernetesResourceKind;
  }
  return "unknown";
}

function parseSpec(raw: unknown, kind: string): KubernetesResourceSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const spec = raw as Record<string, unknown>;

  if (kind === "Deployment" || kind === "StatefulSet" || kind === "DaemonSet") {
    return parseDeploymentSpec(spec);
  }
  if (kind === "Service") {
    return parseServiceSpec(spec);
  }
  if (kind === "Ingress") {
    return parseIngressSpec(spec);
  }
  if (kind === "Job" || kind === "CronJob") {
    return {
      completions: typeof spec["completions"] === "number" ? spec["completions"] : undefined,
      parallelism: typeof spec["parallelism"] === "number" ? spec["parallelism"] : undefined
    };
  }
  return undefined;
}

function parseDeploymentSpec(spec: Record<string, unknown>): KubernetesResourceSpec {
  const replicas = typeof spec["replicas"] === "number" ? spec["replicas"] : undefined;
  const template = (spec["template"] ?? {}) as Record<string, unknown>;
  const podSpec = (template["spec"] ?? {}) as Record<string, unknown>;
  const containersRaw = Array.isArray(podSpec["containers"]) ? podSpec["containers"] : [];
  const containers = containersRaw.map((c) => parseContainer(c as Record<string, unknown>));
  return { replicas, containers };
}

function parseContainer(raw: Record<string, unknown>): KubernetesContainer {
  const portsRaw = Array.isArray(raw["ports"]) ? raw["ports"] : [];
  const envRaw = Array.isArray(raw["env"]) ? raw["env"] : [];
  const resources = raw["resources"] as
    | { requests?: Record<string, string>; limits?: Record<string, string> }
    | undefined;

  return {
    name: typeof raw["name"] === "string" ? raw["name"] : "unknown",
    image: typeof raw["image"] === "string" ? raw["image"] : "unknown",
    ports: portsRaw.map((p) => parsePort(p as Record<string, unknown>)),
    env: envRaw.map((e) => parseEnvVar(e as Record<string, unknown>)),
    resources,
    livenessProbe: parseProbe(raw["livenessProbe"]),
    readinessProbe: parseProbe(raw["readinessProbe"]),
    command: Array.isArray(raw["command"]) ? raw["command"].map(String) : undefined,
    args: Array.isArray(raw["args"]) ? raw["args"].map(String) : undefined,
    volumeMounts: Array.isArray(raw["volumeMounts"])
      ? (raw["volumeMounts"] as Array<Record<string, unknown>>).map((m) => ({
          name: String(m["name"] ?? ""),
          mountPath: String(m["mountPath"] ?? ""),
          readOnly: m["readOnly"] === true
        }))
      : undefined
  };
}

function parsePort(raw: Record<string, unknown>): KubernetesContainerPort {
  return {
    name: typeof raw["name"] === "string" ? raw["name"] : undefined,
    containerPort: typeof raw["containerPort"] === "number" ? raw["containerPort"] : 0,
    hostPort: typeof raw["hostPort"] === "number" ? raw["hostPort"] : undefined,
    protocol: raw["protocol"] === "UDP" ? "UDP" : "TCP"
  };
}

function parseEnvVar(raw: Record<string, unknown>): KubernetesEnvVar {
  const name = typeof raw["name"] === "string" ? raw["name"] : "unknown";
  if (typeof raw["value"] === "string") {
    return { name, value: raw["value"] };
  }
  const valueFrom = raw["valueFrom"] as
    | {
        configMapKeyRef?: { name?: string; key?: string };
        secretKeyRef?: { name?: string; key?: string };
        fieldRef?: { fieldPath?: string };
      }
    | undefined;
  if (valueFrom?.configMapKeyRef) {
    return {
      name,
      valueFrom: {
        kind: "configMap",
        name: valueFrom.configMapKeyRef.name ?? "",
        key: valueFrom.configMapKeyRef.key ?? ""
      }
    };
  }
  if (valueFrom?.secretKeyRef) {
    return {
      name,
      valueFrom: {
        kind: "secret",
        name: valueFrom.secretKeyRef.name ?? "",
        key: valueFrom.secretKeyRef.key ?? ""
      }
    };
  }
  if (valueFrom?.fieldRef) {
    return {
      name,
      valueFrom: {
        kind: "fieldRef",
        fieldPath: valueFrom.fieldRef.fieldPath ?? ""
      }
    };
  }
  return { name };
}

function parseProbe(raw: unknown): KubernetesProbe | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const probe = raw as {
    httpGet?: { path?: string; port?: number | string };
    tcpSocket?: { port?: number | string };
    exec?: { command?: string[] };
    grpc?: { port?: number };
    initialDelaySeconds?: number;
    periodSeconds?: number;
    timeoutSeconds?: number;
    failureThreshold?: number;
  };
  let kind: KubernetesProbe["kind"];
  if (probe.httpGet) kind = "http";
  else if (probe.tcpSocket) kind = "tcp";
  else if (probe.exec) kind = "exec";
  else if (probe.grpc) kind = "grpc";
  else return undefined;
  return {
    kind,
    path: probe.httpGet?.path,
    port: probe.httpGet?.port ?? probe.tcpSocket?.port ?? probe.grpc?.port,
    command: probe.exec?.command,
    initialDelaySeconds: probe.initialDelaySeconds,
    periodSeconds: probe.periodSeconds,
    timeoutSeconds: probe.timeoutSeconds,
    failureThreshold: probe.failureThreshold
  };
}

function parseServiceSpec(spec: Record<string, unknown>): KubernetesResourceSpec {
  const type = spec["type"];
  const portsRaw = Array.isArray(spec["ports"]) ? spec["ports"] : [];
  return {
    serviceType: (["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"].includes(String(type))
      ? type
      : "ClusterIP") as KubernetesResourceSpec["serviceType"],
    servicePorts: portsRaw.map((p) => {
      const port = p as { name?: string; port?: number; targetPort?: number | string; protocol?: string };
      return {
        name: port.name,
        port: typeof port.port === "number" ? port.port : 0,
        targetPort: port.targetPort,
        protocol: port.protocol === "UDP" ? "UDP" : "TCP"
      };
    })
  };
}

function parseIngressSpec(spec: Record<string, unknown>): KubernetesResourceSpec {
  const rulesRaw = Array.isArray(spec["rules"]) ? spec["rules"] : [];
  return {
    ingressRules: rulesRaw.map((r) => {
      const rule = r as {
        host?: string;
        http?: {
          paths?: Array<{
            path?: string;
            pathType?: string;
            backend?: { service?: { name?: string; port?: { number?: number } } };
          }>;
        };
      };
      return {
        host: rule.host,
        paths: (rule.http?.paths ?? []).map((p) => ({
          path: p.path ?? "/",
          pathType: (["Prefix", "Exact", "ImplementationSpecific"].includes(String(p.pathType))
            ? p.pathType
            : "Prefix") as "Prefix" | "Exact" | "ImplementationSpecific",
          serviceName: p.backend?.service?.name,
          servicePort: p.backend?.service?.port?.number
        }))
      };
    })
  };
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT";
}

// Suppress unused-import lint — we want `filePath` available for future
// source-location tracking but don't currently use it.
void path;
