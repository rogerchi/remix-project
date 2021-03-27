import * as fs from 'fs-extra'; // eslint-disable-line
import * as path from 'path'; // eslint-disable-line
import {
  TypeScriptAppProject,
  TypeScriptProjectOptions,
  // Component,
  FileBase,
  FileBaseOptions,
  IResolver,
  // JsonFile,
  TextFile,
} from 'projen'; // eslint-disable-line
import { TaskCategory } from 'projen/lib/tasks';
import { PostCss } from 'projen/lib/web';

/**
 * Which deployment provider to use
 */
export enum RemixDeploymentProvider {
  EXPRESS = 'express',
  VERCEL = 'vercel',
  // ARCHITECT = 'architect',
}

export interface RemixAppProjectOptions extends TypeScriptProjectOptions {
  readonly remixVersion?: string;
  readonly depolymentProvider?: RemixDeploymentProvider;
  readonly appDirectory?: string;
  readonly browserBuildDirectory?: string;
  readonly publicPath?: string;
  readonly serverBuildDirectory?: string;
  readonly devServerPort?: number;
  readonly tailwind?: boolean;
}

export class RemixAppProject extends TypeScriptAppProject {
  public readonly deploymentProvider: RemixDeploymentProvider;
  public readonly appDirectory: string;
  public readonly browserBuildDirectory: string;
  public readonly publicPath: string;
  public readonly serverBuildDirectory: string;
  public readonly devServerPort: number;
  public readonly tailwind: boolean;
  public readonly remixVersion: string;
  public readonly remixConfigFile: FileBase;

  constructor(options: RemixAppProjectOptions) {
    super({ ...options, sampleCode: false });

    const defaultRemixAppProjectOptions = {
      remixVersion: '0.13.1',
      depolymentProvider: RemixDeploymentProvider.EXPRESS,
      appDirectory: 'app',
      browserBuildDirectory: 'public/build',
      publicPath: '/build/',
      serverBuildDirectory: 'build',
      devServerPort: 8002,
      tailwind: false,
    };

    this.deploymentProvider =
      options.depolymentProvider ??
      defaultRemixAppProjectOptions.depolymentProvider;
    this.appDirectory =
      options.appDirectory ?? defaultRemixAppProjectOptions.appDirectory;
    this.browserBuildDirectory =
      options.browserBuildDirectory ??
      defaultRemixAppProjectOptions.browserBuildDirectory;
    this.publicPath =
      options.publicPath ?? defaultRemixAppProjectOptions.publicPath;
    this.serverBuildDirectory =
      options.serverBuildDirectory ??
      defaultRemixAppProjectOptions.serverBuildDirectory;
    this.devServerPort =
      options.devServerPort ?? defaultRemixAppProjectOptions.devServerPort;
    this.tailwind = options.tailwind ?? defaultRemixAppProjectOptions.tailwind;
    this.remixVersion =
      options.remixVersion ?? defaultRemixAppProjectOptions.remixVersion;

    this.remixConfigFile = new RemixConfigFile(this, 'remix.config.js', {
      appDirectory: this.appDirectory,
      browserBuildDirectory: this.browserBuildDirectory,
      publicPath: this.publicPath,
      serverBuildDirectory: this.serverBuildDirectory,
      devServerPort: this.devServerPort,
    });

    this.gitignore.exclude('# Remix', `/${this.browserBuildDirectory}`);
    this.gitignore.exclude('# Remix', `/${this.serverBuildDirectory}`);

    if (process.env.REMIX_RUN_LICENSE) {
      new TextFile(this, '.npmrc', {
        committed: false,
        readonly: false,
        lines: [
          `//npm.remix.run/:_authToken=${process.env.REMIX_RUN_LICENSE}`,
          '@remix-run:registry=https://npm.remix.run',
        ],
      });
      this.addRemixDeps();
    } else if (fs.existsSync(path.join('.npmrc'))) {
      this.addRemixDeps();
    } else {
      throw new Error('Environment variable REMIX_RUN_LICENSE not set');
    }

    this.addDevDeps('@types/react', '@types/react-dom');

    if (this.deploymentProvider === RemixDeploymentProvider.EXPRESS) {
      this.addDeps(
        `@remix-run/express@${this.remixVersion}`,
        'express',
        'morgan',
      );
      this.addDevDeps('pm2');
      new Pm2ConfigFile(this);
      this.addTask('build', {
        description: 'Builds the project',
        category: TaskCategory.BUILD,
        exec: 'remix build',
      });
      this.addTask('dev', {
        description: 'Start dev server',
        category: TaskCategory.BUILD,
        exec: 'pm2-dev pm2.config.js',
      });
      this.addTask('start', {
        description: 'Start server',
        category: TaskCategory.RELEASE,
        exec: 'node server.js',
      });
    }

    if (this.deploymentProvider === RemixDeploymentProvider.VERCEL) {
      this.addDeps(
        `@remix-run/vercel@${this.remixVersion}`,
        '@vercel/node@1.8.3',
      );
      this.addDevDeps('vercel', 'concurrently');
      this.addTask('predeploy', {
        description: 'Builds the project',
        category: TaskCategory.BUILD,
        exec: 'remix build',
      });
      this.addTask('deploy', {
        description: 'Deploy to vercel',
        category: TaskCategory.RELEASE,
        exec: 'vercel',
      });
      this.addTask('start', {
        description: 'Start server',
        category: TaskCategory.RELEASE,
        exec: 'concurrently "remix run" "vercel dev"',
      });
    }

    if (this.tailwind) {
      new PostCss(this, { tailwind: true });
    }
  }
  private addRemixDeps() {
    this.addDeps(
      `@remix-run/cli@${this.remixVersion}`,
      `@remix-run/data@${this.remixVersion}`,
      `@remix-run/react@${this.remixVersion}`,
      'react',
      'react-dom',
      'react-router@^6.0.0-beta.0',
      'react-router-dom@^6.0.0-beta.0',
    );
  }
}

class Pm2ConfigFile extends FileBase {
  constructor(project: RemixAppProject) {
    super(project, 'pm2.config.js');
  }
  protected synthesizeContent(_: IResolver): string | undefined {
    return `
module.exports = {
  apps: [
    {
      name: "Express",
      script: "server.js",
      watch: ["remix.config.js", "app"],
      watch_options: {
        followSymlinks: false,
      },
      env: {
        NODE_ENV: "development",
      },
    },
    {
      name: "Remix",
      script: "remix run",
      ignore_watch: ["."],
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
    `;
  }
}

interface RemixConfigFileOptions extends FileBaseOptions {
  appDirectory: string;
  browserBuildDirectory: string;
  publicPath: string;
  serverBuildDirectory: string;
  devServerPort: number;
}

class RemixConfigFile extends FileBase {
  public readonly options: RemixConfigFileOptions;
  constructor(
    project: RemixAppProject,
    filePath: string,
    options: RemixConfigFileOptions,
  ) {
    super(project, filePath, options);
    this.options = options;
  }
  protected synthesizeContent(_: IResolver): string | undefined {
    return createRemixConfig(this.options);
  }
}

function createRemixConfig(options: RemixConfigFileOptions) {
  return `
module.exports = {
  /**
   * The path to the "app" directory, relative to remix.config.js. Defaults to
   * "app". All code in this directory is part of your app and will be compiled
   * by Remix.
   *
   */
  appDirectory: '${options.appDirectory}',

  /**
   * A hook for defining custom routes based on your own file conventions. This
   * is not required, but may be useful if you have custom/advanced routing
   * requirements.
   */
  // routes(defineRoutes) {
  //   return defineRoutes(route => {
  //     route(
  //       // The URL path for this route.
  //       "/pages/one",
  //       // The path to this route's component file, relative to "appDirectory".
  //       "pages/one",
  //       // Options:
  //       {
  //         // The path to this route's data module, relative to "dataDirectory".
  //         loader: "...",
  //         // The path to this route's styles file, relative to "appDirectory".
  //         styles: "..."
  //       }
  //     );
  //   });
  // },

  /**
   * The path to the browser build, relative to remix.config.js. Defaults to
   * "public/build". The browser build contains all public JavaScript and CSS
   * files that are created when building your routes.
   */
  browserBuildDirectory: '${options.browserBuildDirectory}',

  /**
   * The URL prefix of the browser build with a trailing slash. Defaults to
   * "/build/".
   */
  publicPath: '${options.publicPath}',

  /**
   * The path to the server build directory, relative to remix.config.js.
   * Defaults to "build". The server build is a collection of JavaScript modules
   * that are created from building your routes. They are used on the server to
   * generate HTML.
   */
  serverBuildDirectory: '${options.serverBuildDirectory}',

  /**
   * The port to use when running "remix run". Defaults to 8002.
   */
  devServerPort: ${options.devServerPort}
}; 
`;
}
