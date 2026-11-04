import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import express from 'express';
import loadRoutes from '../../main/routes/PermanentLinkRoutes';

/**
 * Keeps the OpenAPI specification in step with the permanent link and public
 * synchronization routes: every route is documented, and the documented
 * operations and their references resolve.
 */
const spec: any = yaml.load(
  fs.readFileSync(path.resolve(__dirname, '../../../docs/sphere-api-docs.yaml'), 'utf8')
);

const registeredRoutes = (): string[] => {
  const app = express();
  loadRoutes(app);
  // `app._router` is Express 4 internals (SPHERE uses express ^4). Express 5
  // removed it: use `app.router.stack` there when the dependency is upgraded.
  return app._router.stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => layer.route.path.replace(/^\/api\/v1/, '').replace(/:([A-Za-z]+)/g, '{$1}'));
};

const resolveRef = (ref: string) =>
  ref.replace(/^#\//, '').split('/').reduce((node: any, key: string) => node?.[key], spec);

const collectRefs = (node: any, refs: string[] = []): string[] => {
  if (Array.isArray(node)) node.forEach(item => collectRefs(item, refs));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
};

describe('OpenAPI specification of the public synchronization API', () => {
  const routes = registeredRoutes();

  it('documents every permanent link and public pricing route', () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
    for (const route of routes) {
      expect(spec.paths[route]?.get, route).toBeDefined();
    }
  });

  it('declares every path parameter of those routes', () => {
    for (const route of routes) {
      const declared = (spec.paths[route].get.parameters ?? [])
        .map((parameter: any) => (parameter.$ref ? resolveRef(parameter.$ref) : parameter))
        .filter((parameter: any) => parameter.in === 'path')
        .map((parameter: any) => parameter.name)
        .sort();
      const expected = [...route.matchAll(/\{([A-Za-z]+)\}/g)].map(match => match[1]).sort();
      expect(declared, route).toEqual(expected);
    }
  });

  it('only references components that exist and security schemes that are defined', () => {
    for (const route of routes) {
      const operation = spec.paths[route].get;
      for (const ref of collectRefs(operation)) {
        expect(resolveRef(ref), `${route} -> ${ref}`).toBeDefined();
      }
      for (const requirement of operation.security ?? []) {
        for (const scheme of Object.keys(requirement)) {
          expect(spec.components.securitySchemes[scheme], `${route} -> ${scheme}`).toBeDefined();
        }
      }
    }
  });

  it('documents the 404 used for hidden resources and the success media types', () => {
    const media = (route: string) => Object.keys(spec.paths[route].get.responses['200'].content);
    expect(media('/public/pricings/{pricingId}')).toEqual(['application/json']);
    expect(media('/public/pricings/{pricingId}/versions/{versionId}/yaml')).toEqual(['application/yaml']);
    expect(media('/public/pricings/{pricingId}/download')).toEqual(['application/zip']);
    for (const route of routes) {
      expect(spec.paths[route].get.responses['404'], route).toBeDefined();
    }
  });

  it('documents the private versions served to authorized callers and how they are cached', () => {
    const summary = spec.components.schemas.PublicPricingVersionSummary;
    expect(summary.properties.private?.type).toBe('boolean');
    expect(summary.required).not.toContain('private');

    const cacheControl = resolveRef('#/components/headers/PublicSyncCacheControl');
    expect(cacheControl.schema.enum).toEqual(['private, no-cache', 'private, no-store']);

    for (const route of routes) {
      const headers = spec.paths[route].get.responses['200'].headers ?? {};
      expect(headers['Cache-Control']?.$ref, route).toBe('#/components/headers/PublicSyncCacheControl');
      expect(headers.Vary?.$ref, route).toBe('#/components/headers/PublicSyncVary');
    }
  });
});
