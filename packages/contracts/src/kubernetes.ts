/**
 * Kubernetes contracts — produced by `packages/adapters/kubernetes`.
 *
 * Represents the common subset of Kubernetes manifests that Node.js
 * backend projects actually use.
 */

export type KubernetesResourceKind =
  | "Deployment"
  | "Service"
  | "ConfigMap"
  | "Secret"
  | "Ingress"
  | "Pod"
  | "Namespace"
  | "Job"
  | "CronJob"
  | "StatefulSet"
  | "DaemonSet"
  | "HorizontalPodAutoscaler"
  | "PersistentVolume"
  | "PersistentVolumeClaim"
  | "ServiceAccount"
  | "ClusterRole"
  | "ClusterRoleBinding"
  | "Role"
  | "RoleBinding"
  | "CustomResourceDefinition"
  | "unknown";

export interface KubernetesContainerPort {
  /** Port name. */
  name?: string;
  /** Container port number. */
  containerPort: number;
  /** Host port mapping (rarely set in manifests). */
  hostPort?: number;
  /** Protocol. Defaults to TCP. */
  protocol?: "TCP" | "UDP";
}

export interface KubernetesEnvVar {
  name: string;
  /** Literal value, if `value:` is set. */
  value?: string;
  /** Reference to a configmap or secret, if `valueFrom:` is set. */
  valueFrom?:
    | { kind: "configMap"; name: string; key: string }
    | { kind: "secret"; name: string; key: string }
    | { kind: "fieldRef"; fieldPath: string };
}

export interface KubernetesContainer {
  /** Container name. */
  name: string;
  /** Container image, e.g. `myapp:latest`. */
  image: string;
  /** Ports. */
  ports: KubernetesContainerPort[];
  /** Environment variables. */
  env: KubernetesEnvVar[];
  /** Resource requests + limits. */
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
  /** Probe config. */
  livenessProbe?: KubernetesProbe;
  readinessProbe?: KubernetesProbe;
  /** Volume mounts. */
  volumeMounts?: Array<{
    name: string;
    mountPath: string;
    readOnly?: boolean;
  }>;
  /** Command (entrypoint override). */
  command?: string[];
  /** Args. */
  args?: string[];
}

export interface KubernetesProbe {
  /** Type of probe. */
  kind: "http" | "tcp" | "exec" | "grpc";
  /** Path for HTTP probes. */
  path?: string;
  /** Port for HTTP/TCP probes. */
  port?: number | string;
  /** Command for exec probes. */
  command?: string[];
  /** Initial delay in seconds. */
  initialDelaySeconds?: number;
  /** Period in seconds. */
  periodSeconds?: number;
  /** Timeout in seconds. */
  timeoutSeconds?: number;
  /** Failure threshold. */
  failureThreshold?: number;
}

export interface KubernetesResource {
  /** Resource kind. */
  kind: KubernetesResourceKind;
  /** API version, e.g. `apps/v1` or `v1`. */
  apiVersion: string;
  /** Resource name. */
  name: string;
  /** Namespace. Defaults to "default" if unspecified. */
  namespace?: string;
  /** Labels. */
  labels?: Record<string, string>;
  /** Annotations. */
  annotations?: Record<string, string>;
  /** Deployment-specific: replicas + containers. */
  spec?: KubernetesResourceSpec;
}

export interface KubernetesResourceSpec {
  /** For Deployments/StatefulSets/DaemonSets: replica count. */
  replicas?: number;
  /** For Deployments/StatefulSets/DaemonSets: containers. */
  containers?: KubernetesContainer[];
  /** For Services: type + ports. */
  serviceType?: "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName";
  servicePorts?: Array<{
    name?: string;
    port: number;
    targetPort?: number | string;
    protocol?: "TCP" | "UDP";
  }>;
  /** For ConfigMaps: data. */
  configMapData?: Record<string, string>;
  /** For Ingress: rules + tls. */
  ingressRules?: Array<{
    host?: string;
    paths: Array<{
      path: string;
      pathType?: "Prefix" | "Exact" | "ImplementationSpecific";
      serviceName?: string;
      servicePort?: number | string;
    }>;
  }>;
  /** For Jobs: completion + parallelism. */
  completions?: number;
  parallelism?: number;
}

/**
 * Combined Kubernetes intelligence for a workspace.
 */
export interface KubernetesManifests {
  /** Root directory scanned for manifests. */
  root: string;
  /** All resources found, in source order. */
  resources: KubernetesResource[];
  /** Number of manifests scanned (files, not resources). */
  fileCount: number;
}
