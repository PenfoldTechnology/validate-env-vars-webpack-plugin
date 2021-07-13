process.env.DEBUG = "*";

const fs = require("fs");
const path = require("path");
const ValidateEnvVarsPlugin = require(".");

const TMP_PATH = path.resolve(__dirname, "tmp");

function tmpPath(...args) {
  return path.resolve(TMP_PATH, ...args);
}

function webpack(opts) {
  return new Promise((resolve, reject) => {
    require("webpack")(opts, (err, stats) =>
      err ? reject(err) : resolve(stats)
    );
  });
}

describe("ValidateEnvVarsPlugin", () => {
  beforeEach(() => {
    try {
      fs.rmdirSync(TMP_PATH);
    } catch (err) {}
    try {
      fs.mkdirSync(TMP_PATH);
    } catch (err) {}
  });

  afterAll(() => {
    fs.rmdirSync(TMP_PATH, { recursive: true });
    fs.rmdirSync(path.resolve(__dirname, "dist"), { recursive: true });
  });

  it("is instantiable", () => {
    const instantiate = () => {
      new ValidateEnvVarsPlugin();
    };
    expect(instantiate).not.toThrow();
  });

  it("JS: error for unrecognised env var inside includePaths", async () => {
    const tmpFile = tmpPath("index.js");
    fs.writeFileSync(
      tmpFile,
      `process.env.ENV_VAR_1; function a() { process.env.ENV_VAR_2; }`
    );

    const stats = await webpack({
      entry: tmpFile,
      plugins: [
        new ValidateEnvVarsPlugin({
          includePaths: [TMP_PATH],
          knownEnvVars: ["ENV_VAR_1"],
        }),
      ],
    });

    expect(stats.compilation.errors.length).toEqual(1);
    expect(stats.compilation.errors[0].message).toEqual(
      "Unrecognised environment variable: ENV_VAR_2"
    );
  });

  it("JS: no error for unrecognised env var outside includePaths", async () => {
    const tmpFile = tmpPath("index.js");
    fs.writeFileSync(tmpFile, `process.env.ENV_VAR;`);

    const stats = await webpack({
      entry: tmpFile,
      plugins: [
        new ValidateEnvVarsPlugin({
          includePaths: ["/not_tmp"],
          knownEnvVars: [],
        }),
      ],
    });

    expect(stats.compilation.errors).toEqual([]);
  });

  it("TS: error for unrecognised env var", async () => {
    fs.writeFileSync(
      tmpPath("tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "commonjs",
        },
      })
    );

    const tmpFileIndex = tmpPath("index.ts");
    fs.writeFileSync(
      tmpFileIndex,
      `console.log(process.env.ENV_VAR_1 as string); require("./dep.ts")()`
    );

    const tmpFileDep = tmpPath("dep.ts");
    fs.writeFileSync(
      tmpFileDep,
      `module.exports = () => process.env.ENV_VAR_2 as string;`
    );

    const stats = await webpack({
      entry: tmpFileIndex,
      resolve: {
        extensions: [".ts"],
      },
      module: {
        rules: [
          {
            test: /\.ts$/,
            loader: "ts-loader",
          },
        ],
      },
      plugins: [
        new ValidateEnvVarsPlugin({
          includePaths: [TMP_PATH],
          knownEnvVars: ["ENV_VAR_1"],
        }),
      ],
    });

    expect(stats.compilation.errors.length).toEqual(1);
    expect(stats.compilation.errors[0].message).toEqual(
      "Unrecognised environment variable: ENV_VAR_2"
    );
  });
});
