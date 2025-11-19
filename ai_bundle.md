## C:\MyCode\Orgo\docker-compose.yml

```
version: "3.8"

services:
  reverse-proxy:
    image: nginx:latest
    container_name: nginx_container
    ports:
      - 80:80
    depends_on:
      - postgres
    volumes:
      - ./packages/config/nginx.conf:/etc/nginx/nginx.conf
    extra_hosts:
      - "host.docker.internal:host-gateway"

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=mydb
      - POSTGRES_USER=test
      - POSTGRES_PASSWORD=test
    volumes:
      - db_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  db_data:

```

## C:\MyCode\Orgo\package-scripts.js

```
const path = require("path");

const apiPath = path.resolve(__dirname, "apps/api");
const webPath = path.resolve(__dirname, "apps/web");

const ciApiPath = path.resolve(__dirname, "out/apps/api");
const ciWebPath = path.resolve(__dirname, "out/apps/web");

module.exports = {
  scripts: {
    prepare: {
      default: `nps prepare.web prepare.api`,
      web: `yarn`,
      api: `nps prepare.docker prisma.migrate.dev`,
      docker: "docker compose up -d",
      ci: {
        web: `npx turbo prune --scope=web && cd out && yarn install --frozen-lockfile`,
        api: `npx turbo prune --scope=api && cd out && yarn install --frozen-lockfile && nps prisma.generate`,
      },
    },
    test: {
      default: `nps test.web test.api`,
      web: `cd ${webPath} && yarn test`,
      api: `cd ${apiPath} && yarn test`,
      ci: {
        default: `nps test.ci.web test.ci.api`,
        web: `cd ${ciWebPath} && yarn test:ci`,
        api: `cd ${ciApiPath} && yarn test:ci`,
      },
      watch: {
        default: `nps test.watch.web test.watch.api`,
        web: `cd ${webPath} && yarn test:watch`,
        api: `cd ${apiPath} && yarn test:watch`,
      },
    },
    prisma: {
      generate: `cd ${apiPath} && npx prisma generate`,
      studio: `cd ${apiPath} && npx prisma studio`,
      migrate: {
        dev: `cd ${apiPath} && npx prisma migrate dev`,
      },
    },
    build: {
      default: "npx turbo run build",
      ci: {
        web: "cd out && npm run build",
        api: "cd out && npm run build",
      },
    },
    docker: {
      build: {
        default: "nps docker.build.web docker.build.api",
        web: `docker build -t web . -f ${webPath}/Dockerfile`,
        api: `docker build -t api . -f ${apiPath}/Dockerfile`,
      },
    },
    dev: "npx turbo run dev",
  },
};

```

## C:\MyCode\Orgo\package.json

```
{
  "name": "turborepo-basic-shared",
  "version": "0.0.0",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "lint": "turbo run lint",
    "format": "prettier --write \"**/*.{ts,tsx,md}\""
  },
  "devDependencies": {
    "prettier": "^3.0.0",
    "prisma": "^5.1.0",
    "turbo": "1.10.12"
  },
  "engines": {
    "npm": ">=7.0.0",
    "node": ">=14.0.0"
  },
  "packageManager": "yarn@1.22.17"
}

```

## C:\MyCode\Orgo\README.md

```
# Turborepo (NestJS + Prisma + NextJS + Tailwind + Typescript + Jest) Starter

This is fullstack turborepo starter. It comes with the following features. 

- ✅ Turborepo 
- ✅ Nestjs 
    - ✅ Env Config with Validation  
    - ✅ Prisma 
- ✅ NextJS 
    - ✅ Tailwind 
    - ✅ Redux Toolkit Query 
- ✅ Testing using Jest 
- ✅ Github Actions 
- ✅ Reverse Proxy using Nginx 
- ✅ Docker Integration 
- ✅ Postgres Database 
- ✅ Package scripts using NPS 

## What's inside?

This turborepo uses [Yarn](https://classic.yarnpkg.com/lang/en/) as a package manager. It includes the following packages/apps:

### Apps and Packages

- `api`: a [NestJS](https://nestjs.com/) app
- `web`: a [Next.js](https://nextjs.org) app
- `ui`: a stub React component library used by `web`.
- `config`: `eslint`, `nginx` and `tailwind` (includes `eslint-config-next` and `eslint-config-prettier`)
- `tsconfig`: `tsconfig.json`s used throughout the monorepo

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

### Utilities

This turborepo has some additional tools already setup for you:

- [Node Package Scripts](https://github.com/sezna/nps#readme) for automation scripts
- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting

## Setup
This starter kit is using turborepo and yarn workspaces for monorepo workflow.

### Prerequisites 
- Install nps by running 
```
npm i -g nps
```
- Make sure docker and docker-compose are
 installed. Refer to docs for your operating system.

### Configure Environment
- Frontend 
    - `cd apps/web && cp .env.example .env`
- Backend 
    - `cd apps/api && cp .env.example .env`

### Install Dependencies
Make sure you are at root of the project and just run 

```
nps prepare
```
### Build

To build all apps and packages, run the following command at the root of project:

```
nps build
```

### Develop

To develop all apps and packages, run the following command at the root of project:

```
nps dev
```
The app should be running at `http://localhost` with reverse proxy configured.


## Other available commands
Run `nps` in the terminal to see list of all available commands. 

```

## C:\MyCode\Orgo\turbo.json

```
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false
    },
    "test:ci": {
      "cache": false
    }
  }
}

```

## C:\MyCode\Orgo\apps\api\.env.example

```

DATABASE_URL="postgresql://test:test@localhost:5432/mydb?schema=public"
```

## C:\MyCode\Orgo\apps\api\Dockerfile

```
FROM node:16-alpine AS builder
RUN apk update
# Set working directory
WORKDIR /app
RUN yarn global add turbo
COPY . .
RUN turbo prune --scope=api --docker

# Add lockfile and package.json's of isolated subworkspace
FROM node:16-alpine AS installer
RUN apk update
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/yarn.lock ./yarn.lock
COPY --from=builder /app/turbo.json ./turbo.json
COPY --from=builder /app/apps/api/prisma ./prisma
RUN yarn install --frozen-lockfile
RUN yarn prisma generate 


FROM node:16-alpine AS sourcer
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=builder /app/out/full/ .
COPY .gitignore .gitignore
RUN yarn turbo run build --scope=api --include-dependencies --no-deps

FROM node:16-alpine as runner
WORKDIR /app
COPY --from=sourcer /app/ .
CMD [ "node", "apps/api/dist/main.js" ]

```

## C:\MyCode\Orgo\apps\api\nest-cli.json

```
{
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}

```

## C:\MyCode\Orgo\apps\api\package.json

```
{
  "name": "api",
  "version": "0.0.1",
  "description": "",
  "author": "",
  "private": true,
  "license": "UNLICENSED",
  "scripts": {
    "prebuild": "rimraf dist",
    "build": "nest build",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "dev": "nest build --webpack --webpackPath webpack-hmr.config.js --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "test": "jest",
    "test:watch": "jest --watch --runInBand",
    "test:cov": "jest --coverage",
    "test:debug": "node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand",
    "test:e2e": "jest --config ./test/jest-e2e.json --runInBand",
    "test:ci": "jest --ci --runInBand"
  },
  "dependencies": {
    "@nestjs/common": "^10.1.3",
    "@nestjs/config": "^3.0.0",
    "@nestjs/core": "^10.1.3",
    "@nestjs/platform-express": "^10.1.3",
    "@nestjs/swagger": "^7.1.6",
    "@prisma/client": "^5.1.0",
    "joi": "^17.9.2",
    "reflect-metadata": "^0.1.13",
    "rimraf": "^5.0.1",
    "rxjs": "^7.8.1",
    "swagger-ui-express": "^5.0.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.1.11",
    "@nestjs/schematics": "^10.0.1",
    "@nestjs/testing": "^10.1.3",
    "@types/express": "^4.17.17",
    "@types/jest": "^29.5.3",
    "@types/node": "^20.4.5",
    "@types/supertest": "^2.0.12",
    "@typescript-eslint/eslint-plugin": "^6.2.1",
    "@typescript-eslint/parser": "^6.2.1",
    "eslint": "^8.46.0",
    "eslint-config-prettier": "^8.9.0",
    "eslint-plugin-prettier": "^5.0.0",
    "jest": "^29.6.2",
    "prettier": "^3.0.0",
    "prisma": "^5.1.0",
    "run-script-webpack-plugin": "^0.2.0",
    "source-map-support": "^0.5.21",
    "supertest": "^6.3.3",
    "ts-jest": "^29.1.1",
    "ts-loader": "^9.4.4",
    "ts-node": "^10.9.1",
    "tsconfig": "*",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.1.6",
    "webpack": "^5.88.2",
    "webpack-node-externals": "^3.0.0"
  },
  "jest": {
    "moduleFileExtensions": [
      "js",
      "json",
      "ts"
    ],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "collectCoverageFrom": [
      "**/*.(t|j)s"
    ],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
}

```

## C:\MyCode\Orgo\apps\api\README.md

```
<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo_text.svg" width="320" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Installation

```bash
$ npm install
```

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Test

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://kamilmysliwiec.com)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](LICENSE).

```

## C:\MyCode\Orgo\apps\api\tsconfig.build.json

```
{
  "extends": "./tsconfig.json",
  "exclude": [
    "node_modules",
    "../../node_modules",
    "test",
    "dist",
    "**/*spec.ts"
  ]
}

```

## C:\MyCode\Orgo\apps\api\tsconfig.json

```
{
  "extends": "tsconfig/nestjs.json",
  "compilerOptions": {
    "outDir": "./dist",
    "baseUrl": "./"
  }
}

```

## C:\MyCode\Orgo\apps\api\webpack-hmr.config.js

```
/* eslint-disable @typescript-eslint/no-var-requires */
const nodeExternals = require('webpack-node-externals');
const { RunScriptWebpackPlugin } = require('run-script-webpack-plugin');

module.exports = function (options, webpack) {
  return {
    ...options,
    entry: ['webpack/hot/poll?100', options.entry],
    externals: [
      nodeExternals({
        allowlist: ['webpack/hot/poll?100'],
        modulesDir: '../../node_modules',
      }),
    ],
    plugins: [
      ...options.plugins,
      new webpack.HotModuleReplacementPlugin(),
      new webpack.WatchIgnorePlugin({
        paths: [/\.js$/, /\.d\.ts$/],
      }),
      new RunScriptWebpackPlugin({ name: options.output.filename }),
    ],
  };
};

```

## C:\MyCode\Orgo\apps\api\prisma\schema.prisma

```
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}

```

## C:\MyCode\Orgo\apps\api\prisma\migrations\20220307034109_initial_migrate\migration.sql

```
-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

```

## C:\MyCode\Orgo\apps\api\src\app.controller.ts

```
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async getHello(): Promise<{ message: string }> {
    return await this.appService.getHello();
  }
}

```

## C:\MyCode\Orgo\apps\api\src\app.module.ts

```
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validationSchemaForEnv } from './config/environment-variables';
import { PersistenceModule } from './persistence/persistence.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: validationSchemaForEnv,
    }),
    PersistenceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

```

## C:\MyCode\Orgo\apps\api\src\app.service.ts

```
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  async getHello(): Promise<{ message: string }> {
    return { message: 'Hello World' };
  }
}

```

## C:\MyCode\Orgo\apps\api\src\main.ts

```
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

declare const module: any;
async function bootstrap() {
  const logger = new Logger('EntryPoint');
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Leaves Tracker')
    .setDescription('Api Docs for leaves tracker')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const PORT = 5002;

  await app.listen(PORT);

  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }
  logger.log(`Server running on http://localhost:${PORT}`);
}
bootstrap();

```

## C:\MyCode\Orgo\apps\api\src\config\environment-variables.ts

```
import * as Joi from 'joi';

export interface EnvironmentVariables {
  DATABASE_URL: string;
}

export const validationSchemaForEnv = Joi.object<EnvironmentVariables, true>({
  DATABASE_URL: Joi.string().required(),
});

```

## C:\MyCode\Orgo\apps\api\src\persistence\persistence.module.ts

```
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PersistenceModule {}

```

## C:\MyCode\Orgo\apps\api\src\persistence\prisma\prisma.service.ts

```
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}

```

## C:\MyCode\Orgo\apps\web\.env.example

```
```

## C:\MyCode\Orgo\apps\web\Dockerfile

```
FROM node:16-alpine AS builder
RUN apk update
# Set working directory
WORKDIR /app
RUN yarn global add turbo
COPY . .
# Only Take packages that are needed to compile this app
RUN turbo prune --scope=web --docker

# Add lockfile and package.json's of isolated subworkspace
FROM node:16-alpine AS installer
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/yarn.lock ./yarn.lock
COPY --from=builder /app/turbo.json ./turbo.json
RUN yarn install --frozen-lockfile


FROM node:16-alpine AS sourcer
RUN apk update
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=builder /app/out/full/ .
COPY .gitignore .gitignore
RUN yarn turbo run build --scope=web --include-dependencies --no-deps

FROM node:16-alpine as runner
WORKDIR /app
COPY --from=sourcer /app/ .
WORKDIR /app/apps/web/
CMD [ "npm", "start" ]

```

## C:\MyCode\Orgo\apps\web\next.config.js

```
const withTM = require("next-transpile-modules")(["ui"]);

module.exports = withTM({
  reactStrictMode: true,
});

```

## C:\MyCode\Orgo\apps\web\package.json

```
{
  "name": "web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:ci": "jest --ci"
  },
  "dependencies": {
    "@reduxjs/toolkit": "^1.9.5",
    "next": "13.4.12",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "react-redux": "^8.1.2",
    "ui": "*"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^5.17.0",
    "@testing-library/react": "^14.0.0",
    "@testing-library/user-event": "14.4.3",
    "@types/node": "^20.4.5",
    "@types/react": "18.2.18",
    "autoprefixer": "^10.4.14",
    "config": "*",
    "eslint": "8.46.0",
    "jest": "^29.6.2",
    "jest-environment-jsdom": "^29.6.2",
    "next-transpile-modules": "10.0.1",
    "postcss": "^8.4.27",
    "tailwindcss": "^3.3.3",
    "tsconfig": "*",
    "typescript": "^5.1.6"
  }
}

```

## C:\MyCode\Orgo\apps\web\postcss.config.js

```
module.exports = require("config/postcss.config");

```

## C:\MyCode\Orgo\apps\web\README.md

```
## Getting Started

First, run the development server:

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.js`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/api-routes/introduction) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.js`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/api-routes/introduction) instead of React pages.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_source=github.com&utm_medium=referral&utm_campaign=turborepo-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

```

## C:\MyCode\Orgo\apps\web\tailwind.config.js

```
module.exports = require("config/tailwind.config");

```

## C:\MyCode\Orgo\apps\web\tsconfig.json

```
{
  "extends": "tsconfig/nextjs.json",
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", "jest.setup.js"],
  "exclude": ["node_modules"]
}

```

## C:\MyCode\Orgo\apps\web\pages\_app.tsx

```
import type { AppProps } from "next/app";
import { Provider } from "react-redux";
import store from "../src/store";
import "../src/styles/global.css";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <Provider store={store}>
      <Component {...pageProps} />;
    </Provider>
  );
}

export default MyApp;

```

## C:\MyCode\Orgo\apps\web\pages\index.tsx

```
import { Button } from "ui";
import { useHelloQuery } from "../src/store/services/api";

export default function Web() {
  const { data } = useHelloQuery();

  return (
    <div>
      <h1>{data?.message}</h1>
      <Button />
    </div>
  );
}

```

## C:\MyCode\Orgo\apps\web\src\screens\auth\login\login.test.tsx

```
import { render } from "@testing-library/react";
import { LoginScreen } from "./login";

test("render login component", () => {
  render(<LoginScreen />);
});

```

## C:\MyCode\Orgo\apps\web\src\screens\auth\login\login.tsx

```
import { Button } from "ui";

export function LoginScreen() {
  return (
    <div>
      Login Screen <Button />
    </div>
  );
}

```

## C:\MyCode\Orgo\apps\web\src\store\index.ts

```
import { configureStore } from "@reduxjs/toolkit";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";

import { api } from "./services/api";

export function makeStore() {
  return configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
    },

    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
  });
}

const store = makeStore();

export type RootState = ReturnType<typeof store.getState>;

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();

export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export default store;

```

## C:\MyCode\Orgo\apps\web\src\store\services\api.ts

```
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

export const api = createApi({
  reducerPath: "baseApi",
  baseQuery: fetchBaseQuery({
    baseUrl: "api",
  }),
  tagTypes: [],
  endpoints: (builder) => ({
    hello: builder.query<{ message: string }, void>({
      query: () => ({
        url: "/",
      }),
    }),
  }),
});

export const { useHelloQuery } = api;

```

## C:\MyCode\Orgo\apps\web\src\styles\global.css

```
@tailwind base;
@tailwind components;
@tailwind utilities;

```

## C:\MyCode\Orgo\packages\config\nginx.conf

```
events {

}

http {

    server {
        listen 80;
        server_name localhost;

        location /api/ {
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_pass http://host.docker.internal:5002/;

            proxy_http_version 1.1;
            proxy_set_header Connection "upgrade";
            proxy_set_header Upgrade $http_upgrade;
        }

        location /_next/webpack-hmr {
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header Host $host;


            proxy_pass http://host.docker.internal:3000;

            proxy_http_version 1.1;
            proxy_set_header Connection "upgrade";
            proxy_set_header Upgrade $http_upgrade;
        }

        location / {
            proxy_pass http://host.docker.internal:3000;
        }

    }

}

```

## C:\MyCode\Orgo\packages\config\package.json

```
{
  "name": "config",
  "version": "0.0.0",
  "main": "index.js",
  "license": "MIT",
  "files": [
    "eslint-preset.js"
  ],
  "dependencies": {
    "eslint-config-next": "^13.4.12",
    "eslint-config-prettier": "^8.9.0",
    "eslint-plugin-react": "7.33.1"
  }
}

```

## C:\MyCode\Orgo\packages\config\postcss.config.js

```
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

```

## C:\MyCode\Orgo\packages\config\tailwind.config.js

```
module.exports = {
  content: [
    "../../packages/ui/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

```

## C:\MyCode\Orgo\packages\tsconfig\base.json

```
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Default",
  "compilerOptions": {
    "composite": false,
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "inlineSources": false,
    "isolatedModules": true,
    "moduleResolution": "node",
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "preserveWatchOutput": true,
    "skipLibCheck": true,
    "strict": true
  },
  "exclude": ["node_modules"]
}

```

## C:\MyCode\Orgo\packages\tsconfig\nestjs.json

```
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "es2017",
    "sourceMap": true,
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": false,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false
  }
}

```

## C:\MyCode\Orgo\packages\tsconfig\nextjs.json

```
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Next.js",
  "extends": "./base.json",
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "incremental": true,
    "esModuleInterop": true,
    "module": "esnext",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve"
  },
  "include": ["src", "next-env.d.ts"],
  "exclude": ["node_modules"]
}

```

## C:\MyCode\Orgo\packages\tsconfig\package.json

```
{
  "name": "tsconfig",
  "version": "0.0.0",
  "private": true,
  "main": "index.js",
  "files": [
    "base.json",
    "nextjs.json",
    "react-library.json"
  ]
}

```

## C:\MyCode\Orgo\packages\tsconfig\react-library.json

```
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "React Library",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2015"],
    "module": "ESNext",
    "target": "ES6",
    "jsx": "react-jsx"
  }
}

```

## C:\MyCode\Orgo\packages\tsconfig\README.md

```
# `tsconfig`

These are base shared `tsconfig.json`s from which all other `tsconfig.json`'s inherit from.

```

## C:\MyCode\Orgo\packages\ui\index.tsx

```
export * from "./components/Button/Button";

```

## C:\MyCode\Orgo\packages\ui\package.json

```
{
  "name": "ui",
  "version": "0.0.0",
  "main": "./index.tsx",
  "types": "./index.tsx",
  "license": "MIT",
  "devDependencies": {
    "@types/react": "^18.2.18",
    "@types/react-dom": "^18.2.7",
    "config": "*",
    "tsconfig": "*",
    "typescript": "^5.1.6"
  }
}

```

## C:\MyCode\Orgo\packages\ui\tsconfig.json

```
{
  "extends": "tsconfig/react-library.json",
  "include": ["."],
  "exclude": ["dist", "build", "node_modules"]
}

```

## C:\MyCode\Orgo\packages\ui\components\Button\Button.tsx

```
export const Button = () => {
  return <button className="text-lg bg-red-500">boo</button>;
};

```

