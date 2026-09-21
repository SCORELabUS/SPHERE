# 🌐 SPHERE - SaaS Pricing Holistic Evaluation and Regulation Environment

SPHERE (SaaS Pricing Holistic Evaluation and Regulation Environment) is a comprehensive platform for intelligent pricing-driven solutions. Grouping a set advanced applications, datasets and tools, SPHERE offers a unified experience to model, analyze, and optimize SaaS pricing with ease.

## 🎥 Demo 

You can access the demo of the project [here](http://sphere.score.us.es/).

If you prefer to run your own instance of the project to ensure the privacy of your data, and leverage the latest features, follow the instructions below.

## 🐳 Running SPHERE with Docker

SPHERE provides a ready to use docker-compose file to run the project in a containerized environment. To run the project with docker, follow these steps:

### 1. Ensure you have docker and docker-compose installed

If you don't have docker and docker-compose installed on your machine, you can follow the instructions in the [official docker documentation](https://docs.docker.com/get-docker/) to install them.

### 2. Clone the repository and run SPHERE

To deploy your own instance of SPHERE, you just have to clone the repo, navigate to the `SPHERE/docker` directory, and launch the docker-compose file. To do so, run the following commands:

```bash
git clone https://github.com/Alex-GF/SPHERE.git
cd SPHERE/docker/testing
docker compose up -d
```

🎉 After running these commands, the project should be up and running! You can access the frontend through [http://localhost/](http://localhost/)

## 🚀 Installation Guide for Developers

To set up and run this project, follow these steps:

#### ⚙️ Prerequisites

Ensure you have **NodeJS** and **npm** installed, as the latter is the package manager of the project. If you haven't installed it yet, please refer to the official [Node.js and npm installation guide](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) before proceeding.

In addition, this project relies on a **mongo** database to store the data. If you don't have one installed on your machine, or deployed in a docker container, you can follow the instructions in the [official mongoDB documentation](https://docs.mongodb.com/manual/installation/).

Finally, one of the dependencies of the project requires the **minizinc** CLI to be installed on your machine in order to solve some optimization problems related to analytics. You can find the installation instructions in the [official minizinc documentation](https://www.minizinc.org/doc-2.5.5/en/installation.html).

#### 📥 Steps to run the project as a developer

1. **Clone the Repository**  
   Start by cloning the project repository to your local machine:
   ```bash
   git clone https://github.com/Alex-GF/SPHERE.git
   ```
2. **Navigate to the Project Directory**  
   Change into the project folder:

   ```bash
   cd SPHERE
   ```

3. **📝 Configure Environment Variables**  
   To configure the variables of the project, you need to set up two environment files. One for the frontend, and the other for the backend.

   First, go to the `/api` directory

   ```bash
   cd api
   ```

   and create an `.env` file using the provided `.env.mongo.example` as a reference. The resulting `.env` file should look like this:

   ```plaintext
   DATABASE_TECHNOLOGY=mongoDB      # Technology used to store the data
   MONGO_PROTOCOL=mongodb           # Protocol used to connect to the database
   MONGO_HOST=localhost             # Host where the database is running
   MONGO_PORT=27017                 # Port where the database is running
   MONGO_INITDB_DATABASE=sphere_db  # Name of the database created for the project
   MONGO_INITDB_ROOT_USERNAME=root  # Root user of the database
   MONGO_INITDB_ROOT_PASSWORD=4dm1n # Password of the root user
   DATABASE_NAME=sphere_db          # Name of the database created for the project
   DATABASE_USERNAME=testUser       # User created to manage sphere_db
   DATABASE_PASSWORD=testUser       # Password of the user created for sphere_db
   SERVER_PORT=8080                 # Used for serving the API
   SERVER_HOST=http://localhost:8080       # Used for serving static files
   AVATARS_FOLDER=public/avatars    # Folder where the avatars will be stored
   BASE_URL_PATH=                   # Base path for the API (/api/v1 will be added to this path, so if you want to serve the API in the root path, leave this variable empty)
   ```

   :::info
   Currently, the only supported database is `mongoDB`.
   :::

   After setting this up, return to the root directory of the project and access the `frontend` project:

   ```bash
   cd ../frontend
   ```

   and create an `.env` file using the provided `.env.example` as a reference. The resulting `.env` file should look like this:

   ```plaintext
   VITE_API_URL=/api
   VITE_SECRET_KEY=app_secret
   ```

4. **🔧 Install Dependencies and Run the Project**  
   Once the `.env` files are set up, return to the main folder again, install the dependencies of both project by running the command `npm run install`, and start the project by running the command `npm run dev`:

   ```bash
   cd ..
   npm run install
   npm run dev
   ```

   🎉 After running these commands, the project should be up and running! This is the expected output:

   ```bash
   > sphere@0.2.0 dev
   > npm run dev:api & npm run dev:vite


   > sphere@0.2.0 dev:vite
   > cd frontend && npx vite


   > sphere@0.2.0 dev:api
   > cd api && npx tsx --tsconfig tsconfig.json --watch src/backend.ts --seed

   ⠼The CJS build of Vite\'s Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

   VITE v5.4.11  ready in 182 ms

   ➜  Local:   http://localhost:5173/
   ➜  Network: use --host to expose
   ➜  press h + enter to show help
   Trying to connect to mongodb://testUser:testUser@localhost:27017/sphere_db?authSource=sphere_db
   ==== Mongo seeding successfull ====
   ➜  API:     http://localhost:8080/
   ```

## Contributions

This project is part of the research activities of the [ISA Group](https://www.isa.us.es/3.0/). It is still under development and should be used with caution. We are not responsible for any damage caused by the use of this software. If you find any bugs or have any suggestions, please let us know by opening an issue in the [GitHub repository](https://github.com/Alex-GF/SPHERE/issues).

### Permanent links and SPACE

Pricing families and collections now have permanent links that survive renaming and moving. Public pricing manifests support SPACE synchronization. See [API, migration and rollout instructions](docs/permanent-links.md).
