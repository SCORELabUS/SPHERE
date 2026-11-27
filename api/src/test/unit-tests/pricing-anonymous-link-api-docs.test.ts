import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import express from 'express';

vi.mock('../../main/config/container', () => ({ default: { resolve: () => ({}) } }));

const { default: loadRoutes } = await import('../../main/routes/PricingAnonymousLinkRoutes');
const { ROUTE_PERMISSIONS } = await import('../../main/config/permissions');
const { matchPath } = await import('../../main/utils/routeMatcher');

/**
 * Keeps the anonymous link routes, their permission rules and the OpenAPI
 * specification in step: every route the router registers is documented with
 * its method and path parameters, has a rule, and the public ones document
 * their 404 and their fixed headers.
 */
const spec: any = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../docs/sphere-api-docs.yaml'), 'utf8'));
const resolveRef = (ref: string) => ref.replace(/^#\//, '').split('/').reduce((node: any, key: string) => node?.[key], spec);

const registered = (): Array<{ express: string; openapi: string; method: string }> => {
  const app = express();
  loadRoutes(app);
  // `app._router` is Express 4 internals, as in public-api-docs.test.ts.
  return (app as any)._router.stack
    .filter((layer: any) => layer.route)
    .flatMap((layer: any) => Object.keys(layer.route.methods).map(method => {
      const route = layer.route.path.replace(/^\/api\/v1/, '');
      return { express: route, openapi: route.replace(/:([A-Za-z]+)/g, '{$1}'), method };
    }));
};

describe('Anonymous link routes', () => {
  const routes = registered();

  it('registers exactly the management and public routes', () => {
    expect(routes.map(route => `${route.method.toUpperCase()} ${route.express}`).sort()).toEqual([
      'DELETE /pricing-anonymous-links/:linkId',
      'GET /anonymous-pricings/:token',
      'GET /anonymous-pricings/:token/configuration-space',
      'GET /anonymous-pricings/:token/yaml',
      'GET /pricing-anonymous-links',
      'POST /pricing-anonymous-links',
    ]);
  });

  it('documents every route with its method and path parameters', () => {
    for (const route of routes) {
      const operation = spec.paths[route.openapi]?.[route.method];
      expect(operation, `${route.method} ${route.openapi}`).toBeDefined();
      const declared = (operation.parameters ?? [])
        .map((parameter: any) => (parameter.$ref ? resolveRef(parameter.$ref) : parameter))
        .filter((parameter: any) => parameter.in === 'path')
        .map((parameter: any) => parameter.name)
        .sort();
      expect(declared, route.openapi).toEqual([...route.openapi.matchAll(/\{([A-Za-z]+)\}/g)].map(match => match[1]).sort());
    }
  });

  it('gives every route a permission rule: public for what a link shows, signed in for managing links', () => {
    for (const route of routes) {
      const concrete = route.express.replace(/:[A-Za-z]+/g, 'sample');
      const rule = ROUTE_PERMISSIONS.find(candidate =>
        candidate.methods.includes(route.method.toUpperCase() as any) && matchPath(candidate.path, concrete));
      expect(rule, `${route.method} ${route.express}`).toBeDefined();
      const isPublic = route.express.startsWith('/anonymous-pricings/');
      expect(Boolean(rule!.isPublic), route.express).toBe(isPublic);
      if (!isPublic) expect(rule!.allowedUserRoles).toEqual(['ADMIN', 'USER']);
    }
  });

  it('documents the 404 and the fixed headers of the public routes', () => {
    for (const route of routes.filter(candidate => candidate.express.startsWith('/anonymous-pricings/'))) {
      const responses = spec.paths[route.openapi].get.responses;
      for (const status of ['200', '404']) {
        const headers = Object.keys(responses[status]?.headers ?? {});
        expect(headers, `${route.openapi} ${status}`).toEqual(expect.arrayContaining(['Cache-Control', 'X-Robots-Tag', 'Referrer-Policy']));
      }
      expect(resolveRef(responses['200'].headers['Cache-Control'].$ref).schema.enum).toEqual(['no-store']);
    }
  });

  it('documents that a pricing can be unlisted where it is read and changed', () => {
    expect(spec.components.schemas.Pricing.properties.unlisted).toBeDefined();
    expect(spec.components.requestBodies.PricingUpdate.content['application/json'].schema.properties.unlisted).toBeDefined();
    const upload = spec.paths['/pricings/{organizationId}'].post.requestBody.content['multipart/form-data'].schema.properties;
    expect(upload.unlisted).toBeDefined();
  });
});
