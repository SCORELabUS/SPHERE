# SPHERE Agents

## Project Structure

- **api/** — Express + MongoDB + Redis backend (TypeScript)
- **frontend/** — React + Vite + TailwindCSS v4 frontend
- Package manager: **pnpm** (not npm/yarn)

## Developer Commands

```bash
pnpm run install    # Install dependencies for both packages
pnpm run dev        # Run API + Vite dev servers concurrently (from root)
pnpm run dev:setup  # Run MongoDB and Redis containers locally with Docker Compose. Also seeds MongoDB with test data. It must be run BEFORE dev commands.
pnpm run test       # Run API tests (vitest) then reseed MongoDB
pnpm run build      # Build both frontend and api
```

## Running Single Test / Package

```bash
cd api && npx vitest --run --test-name-pattern "<pattern>"
```

## Prerequisites (required for dev and tests)

- **MongoDB** — must be running with a seeded database
- **MiniZinc** — required for analytics/pricing optimization; must have `gecode` solver available

  If analytics return 500, verify with:
  ```bash
  minizinc --solvers  # gecode must appear in output
  ```

## Important Quirks

- `test` script runs `seed:mongo-local:small` **after** tests to reset state
- Tests run sequentially (`fileParallelism: false` in vitest.config.ts)
- API entry point: `api/src/main/backend.ts`
- Migrations auto-run via `npx migrate up` in `dev:api` script
- API uses `ts-migrate-mongoose` for MongoDB migrations

## API Documentation

- `/api/docs/sphere-api-docs.yaml` contains the OpenAPI specification for the API. Use it as the primary reference for understanding available endpoints, request and response schemas, authentication requirements, and general API behavior.

## Test distribution

- /api/src/test/unit-tests/** – tests related to individual utility functions, services, and repositories. These tests should be focused on isolated logic and should mock external dependencies.
- /api/src/test/auth.test.ts – tests related to authentication flows, including login, token generation, and token validation
- /api/src/test/cache.test.ts – tests related to caching mechanisms
- /api/src/test/user.test.ts – tests related to user management, authentication, and authorization
- /api/src/test/organization.test.ts – tests related to organization management and organization-user interactions
- /api/src/test/collection.test.ts — tests related to collection management and collection-pricing interactions
- /api/src/test/pricing.test.ts — tests related to pricing management and pricing-analytics

In addition, test utilities are organized in `/api/src/test/utils/` with subfolders for auth, users, organizations, collections and pricings.

## Lint Config

- API: `api/eslint.config.ts` (TypeScript-eslint, semi required)
- Frontend: `frontend/eslint.config.js`

## Instructions for Adding New API Endpoints

1. Define the endpoint in the OpenAPI spec (`/api/docs/sphere-api-docs.yaml`). This will serve as the source of truth for the endpoint's contract, including request/response schemas and authentication requirements.
2. Implement the endpoint in its corresponder router (different routets can be found in `api/src/main/routers/`). Follow the RESTful conventions to name the endpoints and ensure that the implementation adheres to the contract defined in the OpenAPI spec.
3. Add any necessary permissions of the endpoint in `api/src/main/config/permissions.ts`. This will ensure that the endpoint is properly secured and only accessible to authorized users.
4. Add a method in the appropiate controller (found in `api/src/main/controllers/`) to parse the request body and parameters to the appropriate data structures. The controller should interact with the necessary services to fulfill the request and return the appropriate response.
5. If needed, add any necessary business logic in the services layer (found in `api/src/main/services/`). This layer should contain the core logic of the application and should be decoupled from the controllers and routers to ensure separation of concerns. If needed, you can use repositories here to communicate with the database. Nontheless, if you can fulfill the requirements of the endpoint without adding any new logic to the services layer, you can directly call the necessary service methods from the controller.
6. If the endpoint requires any changes to persist in the database or requires retrieving information from it, add any necessary database queries in the appropriate repository (found in `api/src/main/repositories/mongoose/`).
7. Write tests for the new endpoint in the appropriate test file under `api/src/test/
8. Ensure that the tests cover various scenarios, including successful requests, validation errors, and unauthorized access. Use the test utilities in `api/src/test/utils/` to help set up test data and mock dependencies as needed.
9. Run the tests to verify that the new endpoint works as expected and does not introduce any regressions. Use `pnpm run test` from the root directory to execute all tests, or run specific tests using `npx vitest --run --test-name-pattern "<pattern>"` from the `api` directory.

IMPORTANT NOTES if adding a new entity to the database schema:

- You must create a new mongoose schema in `api/src/main/repositories/mongoose/models`
- You must add any necessary migrations in `api/src/main/migrations/`. Remember to run the migrations using `npx migrate up` after implementing the new endpoint to ensure that the database schema is updated accordingly.
- You must update the seeders located in `api/src/main/database/seeders/mongo/` to reflect the changes
- You must register the new repository and service in the awilix container located in `api/src/main/config/container.ts` to ensure that they can be properly injected into the controllers and other services as needed.

## Instructions for Adding New Frontend Pages/Components

The frontend organizes its functionality in modules, which are located in `frontend/src/modules/`. Each module corresponds to a specific feature or section of the application and contains its own components, pages, and styles. When adding new pages or components, you should determine which module they belong to based on their functionality and the existing structure of the application. In particular, each module may have the following subfolders:

- pages/: contains the main pages of the module, which are typically associated with specific routes in the application. Pages are responsible for rendering the overall layout and structure of a particular section of the application and may include multiple components to display data and handle user interactions.
- components/: contains reusable components that are specific to the module. These components can be used across different pages within the same module and are designed to encapsulate specific functionality or UI elements related to the module's feature set. IMPORTANT: If you wanna reuse a component across different modules, you should place it in the `frontend/src/modules/core/components/` folder instead of the module's components folder.
- utils/: contains utility functions that are specific to the module. These functions can be used across different components and pages within the same module and are designed to encapsulate specific logic related to the module's feature set. IMPORTANT: If you wanna reuse a utility function across different modules, you should place it in the `frontend/src/modules/core/utils/` folder instead of the module's utils folder.
- api/: contains functions that handle API calls related to the module's feature set. These functions are responsible for making HTTP requests to the backend API and processing the responses. They can be used across different components and pages within the same module to interact with the backend and retrieve or manipulate data as needed. IMPORTANT: remember to check wheter an API function that fulfills your needs already exists before creating a new one, even in a different module. If it does, you should reuse it instead of creating a new one.
- contexts/: contains React contexts that are specific to the module. These contexts can be used to manage state and share data across different components and pages within the same module. They are designed to encapsulate specific logic related to the module's feature set and can help improve the organization and maintainability of the codebase.
- hooks/: contains custom React hooks that are specific to the module. These hooks can be used to encapsulate reusable logic related to the module's feature set and can help improve the organization and maintainability of the codebase. They can be used across different components and pages within the same module to handle common functionality such as form handling, data fetching, or state management.
- layouts/: contains layout components that are specific to the module. These components are responsible for defining the overall structure and layout of the pages within the module and can be used to ensure a consistent look and feel across different sections of the application.

When adding new pages or components you should always follow the style depicted in `./DESIGN.md` and make sure to keep the code organized and maintainable by placing it in the appropriate module and subfolder based on its functionality and purpose. Additionally, remember to update the routing configuration if you are adding new pages that need to be accessible via specific routes in the application.

If you need to add any new color to the palette, you should add it to the `frontend/src/main/styles/tailwind.css` file to ensure that it can be used consistently across the application and is available for use in the TailwindCSS classes throughout the codebase. In addition, you should ALWAYS include a dark mode variant for any new colors you add by extending the class `.dark` in the same file. This will ensure that the new colors are properly displayed in both light and dark modes, providing a better user experience for users who prefer dark mode.

IMPORTANT RULE: EVERY CLICKABLE COMPONENT IN THE UI MUST HAVE A "cursor-pointer" CLASS TO INDICATE THAT IT IS INTERACTIVE. This is a crucial aspect of the user experience, as it provides a visual cue to users that an element is clickable and can be interacted with. By adding the "cursor-pointer" class to all clickable components, you can improve the usability of the application and make it more intuitive for users to navigate and interact with the various features and functionalities available.