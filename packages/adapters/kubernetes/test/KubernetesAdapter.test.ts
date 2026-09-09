/**
 * Tests for the Kubernetes adapter.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { KubernetesAdapter, parseManifestFile } from "../src/KubernetesAdapter.js";

const FIXTURE = path.resolve(__dirname, "../../../test-fixtures/node-ts-docker");

describe("parseManifestFile", () => {
  it("parses a single Deployment manifest", () => {
    const yaml = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: api",
      "  namespace: production",
      "spec:",
      "  replicas: 3",
      "  template:",
      "    spec:",
      "      containers:",
      "        - name: api",
      "          image: myapp:latest",
      "          ports:",
      "            - containerPort: 3000",
      "          env:",
      "            - name: NODE_ENV",
      "              value: production"
    ].join("\n");
    const resources = parseManifestFile(yaml, "/test/deploy.yml");
    expect(resources).toHaveLength(1);
    const r = resources[0]!;
    expect(r.kind).toBe("Deployment");
    expect(r.apiVersion).toBe("apps/v1");
    expect(r.name).toBe("api");
    expect(r.namespace).toBe("production");
    expect(r.spec?.replicas).toBe(3);
    expect(r.spec?.containers).toHaveLength(1);
    expect(r.spec?.containers![0]!.name).toBe("api");
    expect(r.spec?.containers![0]!.image).toBe("myapp:latest");
    expect(r.spec?.containers![0]!.ports[0]!.containerPort).toBe(3000);
    expect(r.spec?.containers![0]!.env[0]!.name).toBe("NODE_ENV");
    expect(r.spec?.containers![0]!.env[0]!.value).toBe("production");
  });

  it("parses multi-document YAML", () => {
    const yaml = [
      "apiVersion: v1",
      "kind: Service",
      "metadata:",
      "  name: api-service",
      "spec:",
      "  type: ClusterIP",
      "  ports:",
      "    - port: 80",
      "      targetPort: 3000",
      "---",
      "apiVersion: v1",
      "kind: ConfigMap",
      "metadata:",
      "  name: app-config",
      "data:",
      "  log-level: info"
    ].join("\n");
    const resources = parseManifestFile(yaml, "/test/multi.yml");
    expect(resources).toHaveLength(2);
    expect(resources[0]!.kind).toBe("Service");
    expect(resources[0]!.spec?.serviceType).toBe("ClusterIP");
    expect(resources[0]!.spec?.servicePorts![0]!.port).toBe(80);
    expect(resources[1]!.kind).toBe("ConfigMap");
    expect(resources[1]!.spec?.configMapData).toEqual({ "log-level": "info" });
  });

  it("parses env var references to secrets and configmaps", () => {
    const yaml = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: app",
      "spec:",
      "  template:",
      "    spec:",
      "      containers:",
      "        - name: app",
      "          image: app:latest",
      "          env:",
      "            - name: DB_URL",
      "              valueFrom:",
      "                secretKeyRef:",
      "                  name: db-secret",
      "                  key: url",
      "            - name: LOG_LEVEL",
      "              valueFrom:",
      "                configMapKeyRef:",
      "                  name: app-config",
      "                  key: log-level"
    ].join("\n");
    const r = parseManifestFile(yaml, "/test/deploy.yml")[0]!;
    const env = r.spec!.containers![0]!.env;
    expect(env[0]!.valueFrom?.kind).toBe("secret");
    expect(env[0]!.valueFrom!.kind === "secret" && env[0]!.valueFrom!.name).toBe("db-secret");
    expect(env[1]!.valueFrom?.kind).toBe("configMap");
  });

  it("parses resource requests and limits", () => {
    const yaml = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: app",
      "spec:",
      "  template:",
      "    spec:",
      "      containers:",
      "        - name: app",
      "          image: app:latest",
      "          resources:",
      "            requests:",
      "              cpu: 100m",
      "              memory: 128Mi",
      "            limits:",
      "              cpu: 500m",
      "              memory: 512Mi"
    ].join("\n");
    const r = parseManifestFile(yaml, "/test/deploy.yml")[0]!;
    const res = r.spec!.containers![0]!.resources!;
    expect(res.requests).toEqual({ cpu: "100m", memory: "128Mi" });
    expect(res.limits).toEqual({ cpu: "500m", memory: "512Mi" });
  });

  it("parses HTTP liveness and readiness probes", () => {
    const yaml = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: app",
      "spec:",
      "  template:",
      "    spec:",
      "      containers:",
      "        - name: app",
      "          image: app:latest",
      "          livenessProbe:",
      "            httpGet:",
      "              path: /health",
      "              port: 3000",
      "            initialDelaySeconds: 30",
      "            periodSeconds: 10",
      "            failureThreshold: 3",
      "          readinessProbe:",
      "            httpGet:",
      "              path: /ready",
      "              port: 3000"
    ].join("\n");
    const r = parseManifestFile(yaml, "/test/deploy.yml")[0]!;
    const c = r.spec!.containers![0]!;
    expect(c.livenessProbe!.kind).toBe("http");
    expect(c.livenessProbe!.path).toBe("/health");
    expect(c.livenessProbe!.port).toBe(3000);
    expect(c.livenessProbe!.initialDelaySeconds).toBe(30);
    expect(c.livenessProbe!.failureThreshold).toBe(3);
    expect(c.readinessProbe!.path).toBe("/ready");
  });

  it("parses Ingress rules", () => {
    const yaml = [
      "apiVersion: networking.k8s.io/v1",
      "kind: Ingress",
      "metadata:",
      "  name: api-ingress",
      "spec:",
      "  rules:",
      "    - host: api.example.com",
      "      http:",
      "        paths:",
      "          - path: /",
      "            pathType: Prefix",
      "            backend:",
      "              service:",
      "                name: api-service",
      "                port:",
      "                  number: 80"
    ].join("\n");
    const r = parseManifestFile(yaml, "/test/ingress.yml")[0]!;
    expect(r.kind).toBe("Ingress");
    expect(r.spec!.ingressRules).toHaveLength(1);
    const rule = r.spec!.ingressRules![0]!;
    expect(rule.host).toBe("api.example.com");
    expect(rule.paths[0]!.path).toBe("/");
    expect(rule.paths[0]!.serviceName).toBe("api-service");
    expect(rule.paths[0]!.servicePort).toBe(80);
  });

  it("ignores documents without apiVersion/kind", () => {
    const yaml = ["foo: bar", "baz: qux"].join("\n");
    const resources = parseManifestFile(yaml, "/test/empty.yml");
    expect(resources).toEqual([]);
  });
});

describe("KubernetesAdapter (integration against fixture)", () => {
  it("detects all resources in the fixture k8s directory", async () => {
    const adapter = new KubernetesAdapter();
    const result = await adapter.detect(FIXTURE);

    expect(result.fileCount).toBeGreaterThanOrEqual(1);
    expect(result.resources.length).toBeGreaterThanOrEqual(5);

    const kinds = result.resources.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["Deployment", "Service", "ConfigMap", "Secret", "Ingress"]));

    // Deployment check
    const deploy = result.resources.find((r) => r.kind === "Deployment")!;
    expect(deploy.name).toBe("api-deployment");
    expect(deploy.namespace).toBe("production");
    expect(deploy.spec?.replicas).toBe(3);
    expect(deploy.spec?.containers).toHaveLength(1);
    const container = deploy.spec!.containers![0]!;
    expect(container.name).toBe("api");
    expect(container.image).toBe("myapp:latest");
    expect(container.ports[0]!.containerPort).toBe(3000);
    expect(container.ports[0]!.name).toBe("http");
    expect(container.resources!.requests).toEqual({ cpu: "100m", memory: "128Mi" });
    expect(container.livenessProbe!.path).toBe("/health");

    // Service check
    const svc = result.resources.find((r) => r.kind === "Service")!;
    expect(svc.spec?.serviceType).toBe("ClusterIP");
    expect(svc.spec?.servicePorts![0]!.port).toBe(80);

    // Ingress check
    const ing = result.resources.find((r) => r.kind === "Ingress")!;
    expect(ing.spec!.ingressRules![0]!.host).toBe("api.example.com");
  });

  it("detects config presence via hasConfig", async () => {
    expect(await KubernetesAdapter.hasConfig(FIXTURE)).toBe(true);
    // The parent of the fixture (test-fixtures dir) doesn't have a k8s dir
    expect(await KubernetesAdapter.hasConfig(path.dirname(FIXTURE))).toBe(false);
  });
});
