import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import express from 'express';
import loadRoutes from '../../main/routes/OrganizationMemberViewRoutes';
import { ROUTE_PERMISSIONS } from '../../main/config/permissions';

/**
 * Keeps the routes that read an organization as one of its members in step
 * with the OpenAPI specification and with the route permissions: every route
 * is documented with its path parameters and resolvable references, and only
 * owners and admins of the organization reach them.
 */
const spec: any = yaml.load(
  fs.readFileSync(path.resolve(__dirname, '../../../docs/sphere-api-docs.yaml'), 'utf8')
);

const registeredRoutes = (): Array<{ path: string; methods: string[] }> => {
  const app = express();
  loadRoutes(app);
  // `app._router` is Express 4 internals (SPHERE uses express ^4).
  return app._router.stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => ({
      path: layer.route.path.replace(/^\/api\/v1/, '').replace(/:([A-Za-z]+)/g, '{$1}'),
      methods: Object.keys(layer.route.methods),
    }));
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

describe('Organization member views: routes, OpenAPI and permissions', () => {
  const routes = registeredRoutes();

  it('registers the four read-only member views', () => {
    expect(routes.map(route => route.path).sort()).toEqual(
      ['collections', 'hierarchy', 'pricings', 'services'].map(
        part => `/orgs/{organizationId}/member-views/{userId}/${part}`
      )
    );
    for (const route of routes) expect(route.methods, route.path).toEqual(['get']);
  });

  it('documents every route with its path parameters and existing references', () => {
    for (const { path: route } of routes) {
      const operation = spec.paths[route]?.get;
      expect(operation, route).toBeDefined();
      const declared = (operation.parameters ?? [])
        .map((parameter: any) => (parameter.$ref ? resolveRef(parameter.$ref) : parameter))
        .filter((parameter: any) => parameter.in === 'path')
        .map((parameter: any) => parameter.name)
        .sort();
      expect(declared, route).toEqual(['organizationId', 'userId']);
      for (const ref of collectRefs(operation)) expect(resolveRef(ref), `${route} -> ${ref}`).toBeDefined();
      for (const requirement of operation.security ?? []) {
        for (const scheme of Object.keys(requirement)) {
          expect(spec.components.securitySchemes[scheme], `${route} -> ${scheme}`).toBeDefined();
        }
      }
      for (const status of ['200', '401', '403', '404']) expect(operation.responses[status], `${route} ${status}`).toBeDefined();
    }
  });

  it('lets only owners and admins through, before the rule for any member', () => {
    const memberViews = ROUTE_PERMISSIONS.findIndex(rule => rule.path === '/orgs/*/member-views/**');
    const anyMember = ROUTE_PERMISSIONS.findIndex(
      rule => rule.path === '/orgs/**' && rule.methods.includes('GET')
    );
    expect(memberViews).toBeGreaterThanOrEqual(0);
    expect(memberViews).toBeLessThan(anyMember);
    expect(ROUTE_PERMISSIONS[memberViews]).toMatchObject({
      methods: ['GET'],
      allowedOrganizationRoles: ['OWNER', 'ADMIN'],
    });
    expect(ROUTE_PERMISSIONS[memberViews].isPublic).toBeFalsy();
  });
});
