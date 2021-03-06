/** @typedef {import("webpack/lib/Module")} Module */

/**
 * @callback BooleanCheckFunc
 * @param input {String} input string
 * @returns {Boolean}
 */

/**
 * @typedef AWSSecretsManagerSourceOptions
 * @property secretId {String}
 * @property [secretVersionStage] {String}
 * @property [secretVersionId] {String}
 * @property secretAccessKey {String}
 * @property accessKeyId {String}
 * @property [sessionToken] {String}
 * @property region {String}
 */

/**
 * @typedef KnownEnvVarsArg
 * @type AWSSecretsManagerSourceOptions|String[]
 */

const fs = require("fs");
const WebpackError = require("webpack/lib/WebpackError");
const walk = require("acorn-walk");
const debug = require("debug")("ValidateEnvVarsPlugin");

const PLUGIN_NAME = "ValidateEnvVars";

class BadArgsError extends Error {
  /**
   * @param message {String}
   */
  constructor(message) {
    super(message);
    this.name = "ValidateEnvVarsPluginBadArgsError";
  }
}

class UnrecognisedEnvVarError extends WebpackError {
  /**
   * @param envVar {String}
   * @param module {Module}
   */
  constructor(envVar, module) {
    super(`Unrecognised environment variable: ${envVar}`);
    this.name = "UnrecognisedEnvVarError";
    this.module = module;
    Error.captureStackTrace(this, this.constructor);
  }
}

function hasPartialProperties(object, properties) {
  return Object.keys(object).some((k) => properties.includes(k));
}

function hasAllProperties(object, properties) {
  const objKeys = Object.keys(object);
  return properties.every((k) => objKeys.includes(k));
}

function toQuotedStringList(arr) {
  return arr.map((value) => `'${value}'`).join(", ");
}

function createExternalSourceCheck(sourceName, sourceRequiredInputProperties) {
  return function (input) {
    if (Array.isArray(input) || typeof input !== "object") {
      return false;
    }

    const requiredPropsList = toQuotedStringList(sourceRequiredInputProperties);

    if (hasAllProperties(input, sourceRequiredInputProperties)) {
      const stringFieldWithoutLength = sourceRequiredInputProperties.find(
        (k) => !(typeof input[k] === "string") || !input[k].length
      );

      if (stringFieldWithoutLength) {
        throw new BadArgsError(
          `bad ${sourceName} source configuration (missing value for property '${stringFieldWithoutLength}')`
        );
      }

      return true;
    }

    if (hasPartialProperties(input, sourceRequiredInputProperties)) {
      throw new BadArgsError(
        `bad ${sourceName} source configuration (requires properties: ${requiredPropsList})`
      );
    }

    return false;
  };
}

const isAWSSecretsManagerSource = createExternalSourceCheck(
  "AWS SecretsManager",
  ["region", "secretId", "secretAccessKey", "accessKeyId"]
);

/**
 * @param sourceOptions {AWSSecretsManagerSourceOptions}
 * @returns {Promise<String[]>}
 */
function getAWSSecretsManagerEnvVarNames(sourceOptions) {
  const SecretsManager = new (require("aws-sdk").SecretsManager)({
    accessKeyId: sourceOptions.accessKeyId,
    secretAccessKey: sourceOptions.secretAccessKey,
    region: sourceOptions.region,
    ...(sourceOptions.sessionToken
      ? { sessionToken: sourceOptions.sessionToken }
      : null),
  });

  return new Promise((resolve, reject) => {
    SecretsManager.getSecretValue(
      {
        SecretId: sourceOptions.secretId,
        ...(sourceOptions.secretVersionId
          ? { VersionId: sourceOptions.secretVersionId }
          : null),
        ...(sourceOptions.secretVersionStage
          ? { VersionStage: sourceOptions.secretVersionStage }
          : null),
      },
      function (err, data) {
        if (err) {
          reject(err);
          return;
        }

        try {
          resolve(Object.keys(JSON.parse(data.SecretString)));
        } catch (err) {
          err.message = `${PLUGIN_NAME} failed parsing SecretString: ${err.message}`;
          reject(err);
        }
      }
    );
  });
}

class ValidateEnvVarsPlugin {
  /**
   * @param [knownEnvVars] {KnownEnvVarsArg}
   * @returns {Promise<String[]>}
   * @private
   */
  _processKnownEnvVars(knownEnvVars) {
    if (!knownEnvVars) {
      return Promise.resolve(Object.keys(process.env));
    }

    if (Array.isArray(knownEnvVars)) {
      const envVarNames = knownEnvVars.map((name) => {
        if (typeof name !== "string") {
          throw new BadArgsError(
            "bad env vars source configuration (got array, but expected all elements to be string)"
          );
        }

        return name.replace(/^process\.env\./, "");
      });

      return Promise.resolve(envVarNames);
    }

    if (typeof knownEnvVars === "string") {
      const envFilePath = /** @type String */ (knownEnvVars);

      if (!fs.existsSync(envFilePath)) {
        throw new BadArgsError(
          "bad env vars source configuration (got string, but no file exists at path)"
        );
      }

      const buffer = fs.readFileSync(envFilePath);
      const parsed = require("dotenv").parse(buffer);
      const envVarNames = Object.keys(parsed);

      return Promise.resolve(envVarNames);
    }

    if (isAWSSecretsManagerSource(knownEnvVars)) {
      return getAWSSecretsManagerEnvVarNames(knownEnvVars);
    }

    throw new BadArgsError(
      "bad env vars source configuration (refer to documentation)"
    );
  }

  /**
   * @param name {String} name of the input
   * @param arr {[String|RegExp]}
   * @param stringCheck {function(str: String, input: String): Boolean}
   * @returns {BooleanCheckFunc[]}
   * @private
   */
  _processStringOrRegexArrayInput(name, arr, stringCheck) {
    if (!arr) {
      return [];
    }

    if (!Array.isArray(arr)) {
      throw new BadArgsError(`expected ${name} to be String|RegExp[]`);
    }

    return arr.map((value) => {
      if (value instanceof RegExp) {
        return (input) => /** @type RegExp */ (value).test(input);
      } else if (typeof value === "string") {
        return (input) => stringCheck(value, input);
      } else {
        throw new BadArgsError(`expecting ${value} to be [String|RegExp]`);
      }
    });
  }

  /**
   * Determine if envVar is considered recognised, ie. do not produce error for it.
   * @param knownEnvVars {String[]}
   * @param envVar {String}
   * @param modulePath {String}
   * @returns {Boolean}
   * @private
   */
  _isRecognisedEnvVar(knownEnvVars, envVar, modulePath) {
    // Env vars that are in knownEnvVars are OK
    if (knownEnvVars.includes(envVar)) {
      debug(envVar, "in knownEnvVars");
      return true;
    }
    // Env vars we have seen before are OK
    if (this.foundUnrecognisedEnvVars.has(envVar)) {
      debug(envVar, "in foundUnrecognisedEnvVars");
      return true;
    }
    // Env vars not inside included paths are OK
    if (!this.includePaths.some((check) => check(modulePath))) {
      debug(envVar, "outside includePaths");
      return true;
    }
    // Env vars inside excluded paths are OK
    if (this.excludePaths.some((check) => check(modulePath))) {
      debug(envVar, "in excludePaths");
      return true;
    }
    // Env vars that satisfy an ignore check are OK
    if (this.ignoreEnvVars.some((check) => check(envVar))) {
      debug(envVar, "in ignoreEnvVars");
      return true;
    }
    // All other env vars are unrecognised
    debug(envVar, "unrecognised");
    return false;
  }

  /**
   * @param [options] {Object}
   * @param [options.knownEnvVars] {KnownEnvVarsArg} list of recognised env var names, default=derived from process.env
   * @param [options.knownEnvVarsTimeout] {Number} amount of time in ms to wait trying to resolve
   *     knownEnvVars before bailing, default=5000
   * @param [options.ignoreEnvVars] {[String|RegExp]} list of env var names to ignore
   * @param [options.includePaths] {String[]} list of file paths to include in the search
   * @param [options.excludePaths] {String[]} list of file paths to exclude from the search
   */
  constructor(options = {}) {
    /** @type Number */
    this.knownEnvVarsTimeout = 5000;
    /** @type Promise<String[]> */
    this.knownEnvVars = this._processKnownEnvVars(options.knownEnvVars);
    // Contains found env vars that are considered unrecognised, ie. are not defined by knownEnvVars
    /** @type Map<String, Module> */
    this.foundUnrecognisedEnvVars = new Map();
    /** @type BooleanCheckFunc[] */
    this.ignoreEnvVars = this._processStringOrRegexArrayInput(
      "ignoreEnvVars",
      options.ignoreEnvVars,
      (check, input) => check === input.replace(/^process\.env\./, "")
    );
    /** @type BooleanCheckFunc[] */
    this.includePaths = this._processStringOrRegexArrayInput(
      "includePaths",
      options.includePaths,
      (check, input) => input.startsWith(check)
    );
    /** @type BooleanCheckFunc[] */
    this.excludePaths = this._processStringOrRegexArrayInput(
      "excludePaths",
      options.excludePaths,
      (check, input) => input.startsWith(check)
    );
  }

  apply(compiler) {
    const _this = this;

    // Resolved value of this.knownEnvVars Promise
    let knownEnvVars;

    const tapParser = (parser) => {
      parser.hooks.program.tap(PLUGIN_NAME, (program) => {
        walk.simple(program, {
          MemberExpression(expression) {
            if (
              // Look for member expressions like `process.env.ENV_VAR`
              expression.object.type === "MemberExpression" &&
              expression.object.object.type === "Identifier" &&
              expression.object.object.name === "process" &&
              expression.object.property.type === "Identifier" &&
              expression.object.property.name === "env" &&
              // Ignore computed member expressions like `process.env[envVar]`
              !expression.computed
            ) {
              // Gets "ENV_VAR" from the example member expression above
              const name = expression.property.name;
              // Gets the the Module (file) that this expression was found in
              const module = parser.state.module;
              const { userRequest: modulePath } = module;

              if (!_this._isRecognisedEnvVar(knownEnvVars, name, modulePath)) {
                _this.foundUnrecognisedEnvVars.set(name, module);
              }
            }
          },
        });
      });
    };

    // Hold up compilation until we have resolved the knownEnvVars Promise
    compiler.hooks.beforeCompile.tapPromise(PLUGIN_NAME, () => {
      return new Promise((resolve) => {
        const bailTimeoutId = setTimeout(() => {
          throw new Error(PLUGIN_NAME + " timed out resolving known env vars");
        }, this.knownEnvVarsTimeout);

        this.knownEnvVars
          .then((envVars) => {
            knownEnvVars = envVars;
            resolve();
          })
          .catch((err) => {
            throw err;
          })
          .finally(() => {
            clearTimeout(bailTimeoutId);
          });
      });
    });

    compiler.hooks.compilation.tap(
      PLUGIN_NAME,
      (compilation, { normalModuleFactory }) => {
        normalModuleFactory.hooks.parser
          .for("javascript/auto")
          .tap(PLUGIN_NAME, tapParser);
        normalModuleFactory.hooks.parser
          .for("javascript/dynamic")
          .tap(PLUGIN_NAME, tapParser);
        normalModuleFactory.hooks.parser
          .for("javascript/esm")
          .tap(PLUGIN_NAME, tapParser);
      }
    );

    compiler.hooks.afterCompile.tap(PLUGIN_NAME, (compilation) => {
      const errors = Array.from(this.foundUnrecognisedEnvVars.entries()).map(
        ([name, module]) => new UnrecognisedEnvVarError(name, module)
      );
      compilation.errors.push(...errors);
    });
  }
}

module.exports = ValidateEnvVarsPlugin;
