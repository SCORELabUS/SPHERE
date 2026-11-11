import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import express from 'express';
import loadRoutes from '../../main/routes/PricingPullRequestRoutes';

/**
 * Keeps the OpenAPI specification in step with the pull request routes: every
 * route and method is documented with its path parameters, and every reference
 * it makes resolves.
 */
const spec: any = yaml.load(
  fs.readFileSync(path.resolve(__dirname, '../../../docs/sphere-api-docs.yaml'), 'utf8')
);

const registeredOperations = (): Array<{ route: string; method: string }> => {
  const app = express();
  loadRoutes(app);
  // `app._router` is Express 4 internals (SPHERE uses express ^4), as in public-api-docs.test.ts.
  return app._router.stack
    .filter((layer: any) => layer.route)
    .flatMap((layer: any) => {
      const route = layer.route.path.replace(/^\/api\/v1/, '').replace(/:([A-Za-z]+)/g, '{$1}');
      return Object.keys(layer.route.methods).map(method => ({ route, method }));
    });
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

describe('OpenAPI specification of the pricing pull requests', () => {
  const operations = registeredOperations();

  it('documents every route and method', () => {
    expect(operations.map(({ route, method }) => `${method} ${route}`).sort()).toEqual([
      'get /pricing-pull-requests',
      'get /pricing-pull-requests/fork-target',
      'get /pricing-pull-requests/{pullRequestId}',
      'post /pricing-pull-requests',
      'post /pricing-pull-requests/previews',
      'post /pricing-pull-requests/{pullRequestId}/close',
      'post /pricing-pull-requests/{pullRequestId}/merge',
      'post /pricing-pull-requests/{pullRequestId}/merge-preview',
      'post /pricing-pull-requests/{pullRequestId}/update',
      'put /pricing-pull-requests/{pullRequestId}',
    ]);
    for (const { route, method } of operations) {
      expect(spec.paths[route]?.[method], `${method} ${route}`).toBeDefined();
    }
  });

  it('declares every path parameter', () => {
    for (const { route, method } of operations) {
      const declared = [...(spec.paths[route].parameters ?? []), ...(spec.paths[route][method].parameters ?? [])]
        .map((parameter: any) => (parameter.$ref ? resolveRef(parameter.$ref) : parameter))
        .filter((parameter: any) => parameter.in === 'path')
        .map((parameter: any) => parameter.name)
        .sort();
      const expected = [...route.matchAll(/\{([A-Za-z]+)\}/g)].map(match => match[1]).sort();
      expect(declared, `${method} ${route}`).toEqual(expected);
    }
  });

  it('only references components that exist, and only a web session as security', () => {
    for (const { route, method } of operations) {
      const operation = { parameters: spec.paths[route].parameters, ...spec.paths[route][method] };
      for (const ref of collectRefs(operation)) {
        expect(resolveRef(ref), `${method} ${route} -> ${ref}`).toBeDefined();
      }
      expect(operation.security, `${method} ${route}`).toEqual([{ BearerAuth: [] }]);
      expect(operation.responses['401'], `${method} ${route}`).toBeDefined();
      expect(operation.responses['404'], `${method} ${route}`).toBeDefined();
    }
  });
});

describe('AGENTS.md on the pricing pull requests', () => {
  const agents = fs.readFileSync(path.resolve(__dirname, '../../../../AGENTS.md'), 'utf8');

  it('no longer says SPHERE has no pull requests', () => {
    expect(agents).not.toMatch(/SPHERE does not have/);
  });

  it('documents the routes, the variables and the tests', () => {
    expect(agents).toContain('## Pricing pull requests');
    expect(agents).toContain('/api/v1/pricing-pull-requests');
    for (const variable of [
      'PRICING_PR_MAX_OPEN_PER_AUTHOR',
      'PRICING_PR_MAX_OPEN_PER_PRICING',
      'PRICING_PR_MAX_CREATED_PER_DAY',
      'PRICING_PR_MAX_YAML_BYTES',
      'PRICING_PR_RATE_LIMIT_MAX_REQUESTS',
      'PRICING_PR_RATE_LIMIT_WINDOW_SECONDS',
    ]) {
      expect(agents, variable).toContain(variable);
    }
    expect(agents).toContain('/api/src/test/pricing-pull-requests.test.ts');
  });
});
